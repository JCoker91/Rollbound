import type { Ability, DamageType, ModSource, ModStat, Passive, Pos, Unit } from './types.ts';
import { alive, UPGRADE_STAT_BONUS } from './types.ts';
import { resistanceOf, resistMultiplier } from './elements.ts';
import { samePos, withinReach } from './formation.ts';

/**
 * How long a modifier runs when an ability does not say.
 *
 * Three turns, and that is ergonomics rather than generosity: buff on turn
 * one, act on two, act on three, reapply on four. One spare turn in the cycle
 * is what stops a support Performer spending every turn on upkeep. If a
 * modifier is too strong, cut its magnitude -- never its duration.
 */
export const DEFAULT_MODIFIER_TURNS = 3;
/** Measured from simulation: a living character acts ~70% of phases. */
const EXPECTED_ACT_RATE = 0.7;

/**
 * The mitigation a hit of this type meets: the matching defense stat, plus any
 * active guard buff.
 *
 * `true` meets none, and returns 0 rather than being special-cased at the call
 * site -- one place knows that True bypasses armour, and every caller that
 * reasons about mitigation gets it right for free.
 *
 * Modifiers name the track they move, so a shred can be pointed at one of them
 * while a general guard buff lists both. Offense has no such split: `attack`
 * drives physical hits, magical hits and healing alike, so one modifier to
 * Attack is worth the same to a blade, a staff and a healer.
 */
export function effectiveDefense(unit: Unit, type: DamageType = 'physical'): number {
  if (type === 'true') return 0;
  const stat: ModStat = type === 'magical' ? 'magicalDefense' : 'physicalDefense';
  return baseStat(unit, stat) + modifierTotal(unit, stat);
}

/**
 * A stat before modifiers: the sheet, grown by level and upgrade tiers.
 *
 * This is what a `targetBase` percentage reads, and keeping it separate from
 * the modified value is what stops two 20% buffs compounding into 44%.
 */
export function baseStat(unit: Unit, stat: ModStat): number {
  const raw =
    stat === 'attack'
      ? unit.def.attack
      : stat === 'magicalDefense'
        ? unit.def.magicalDefense
        : unit.def.physicalDefense;
  return Math.round(raw * statScale(unit));
}

/** Everything currently modifying one stat, buffs and shreds together. */
export function modifierTotal(unit: Unit, stat: ModStat): number {
  let total = 0;
  for (const m of unit.modifiers) if (m.stat === stat) total += m.amount;
  return total;
}

/**
 * A stat as it stands right now, modifiers included.
 *
 * What a `casterCurrent` percentage reads, and what the damage formula uses.
 * Floored at zero: a shred can take a defense to nothing but never past it,
 * because negative armour would turn mitigation inside out and start
 * amplifying damage.
 */
export function currentStat(unit: Unit, stat: ModStat): number {
  return Math.max(0, baseStat(unit, stat) + modifierTotal(unit, stat));
}

/**
 * Turn a percentage into the flat amount a `Modifier` stores.
 *
 * Done once, when the modifier lands, never re-read afterwards. That is what
 * makes stacking additive and expiry a subtraction -- and it is why a
 * `casterCurrent` buff is worth whatever the caster was worth *at that
 * moment*, which is the property the combo is built on.
 */
export function resolveModifierAmount(
  caster: Unit,
  target: Unit,
  stat: ModStat,
  percent: number,
  of: ModSource,
): number {
  const from = of === 'casterCurrent' ? currentStat(caster, stat) : baseStat(target, stat);
  const amount = (from * percent) / 100;
  // Away from zero, so a small buff is never rounded into nothing and a small
  // shred always bites at least a point.
  return amount < 0 ? -Math.max(1, Math.round(-amount)) : Math.max(1, Math.round(amount));
}

/** An ability's damage type. Attacks default to physical; see types.ts. */
export const damageTypeOf = (a: Ability): DamageType => a.damageType ?? 'physical';

/** Heals scale off the caster's ATK, same as damage, so support scales too. */
export function computeHeal(source: Unit, ability: Ability): number {
  return Math.round(unitAttack(source) * ability.power);
}

/**
 * Everything currently affecting this unit: its innate passives plus whichever
 * upgrade tiers it has bought this battle.
 */
export function activePassives(u: Unit): Passive[] {
  const bought = (u.def.upgrades ?? []).slice(0, u.upgrades).map((t) => t.passive);
  return [...(u.def.passives ?? []), ...bought];
}

/** Summed, so buying a passive you already have stacks rather than replacing it. */
const passive = (u: Unit, kind: Passive['kind']): number =>
  activePassives(u)
    .filter((p) => p.kind === kind)
    .reduce((n, p) => n + p.percent, 0);

/** Multiplier on attack, defense and max HP from bought upgrades. */
export const statScale = (u: Unit): number => 1 + u.upgrades * UPGRADE_STAT_BONUS;

export const unitAttack = (u: Unit): number => currentStat(u, 'attack');

export const unitMaxHp = (u: Unit): number => Math.round(u.def.maxHp * statScale(u));

/**
 * The defense value that halves incoming damage, at power scale 1.
 *
 * This constant is what makes `DEF / (anchor + DEF)` mean anything: it sets how
 * much armour is "a lot". Fixed, it silently expires -- see `computeDamage`.
 */
export const MITIGATION_ANCHOR = 100;

/*
 * Critical hits.
 *
 * Rolled where the hit LANDS (`applyAbility`), not inside `computeDamage`.
 * `computeDamage` has to stay pure: the forecast panel calls it to show what a
 * target would take before you commit, and a forecast that rolled its own dice
 * would be a different number from the one the attack deals. So the forecast
 * shows the ordinary hit and a crit is always upside.
 *
 * NOT a balance pass. A flat chance for everyone, no crit stat on the sheet
 * yet -- these are placeholders chosen to make the system observable, like the
 * rest of the numbers in the bestiary, and the natural next step is moving the
 * chance onto `CharacterDef` so a Performer can be built around it.
 */
export const CRIT_PERCENT = 12;
export const CRIT_MULTIPLIER = 1.5;

/** How large this unit's numbers are, relative to a level-1 sheet. */
export const powerScaleOf = (u: Unit): number => u.def.powerScale ?? 1;

/** Flat damage formula. Defense is diminishing-returns rather than subtractive. */
export function computeDamage(source: Unit, ability: Ability, target: Unit): number {
  const frenzy = source.hp * 2 <= unitMaxHp(source) ? passive(source, 'frenzy') : 0;
  const atk = unitAttack(source) * (1 + frenzy / 100);
  const base = atk * ability.power;
  // Mitigation is `K / (K + DEF)` -- diminishing returns, never negative damage,
  // never immunity, and each point of DEF buys a constant slice of effective HP.
  // Subtractive `ATK - DEF` has none of those properties: it needs clamping at
  // zero, creates hard thresholds where an attacker flips from useful to
  // useless, and makes many small hits worthless against armour.
  //
  // K is anchored to the ATTACKER's power scale, and that is the whole trick.
  // With a fixed K the formula quietly expires: stats grow with level but the
  // constant does not, so mitigation drifts from 0.69 to 0.24 between level 1
  // and 80 and the SAME fight stretches from 7.5 hits to 22. Scaling K with the
  // attacker keeps an even fight the same length at every level -- and because
  // DEF still carries the DEFENDER's scale, a level gap falls out of the same
  // expression for free: out-levelled attackers are resisted, over-levelled
  // ones cut through. No separate level-difference term is needed, and adding
  // one would count level twice.
  const anchor = MITIGATION_ANCHOR * powerScaleOf(source);
  const mitigated = base * (anchor / (anchor + effectiveDefense(target, damageTypeOf(ability))));
  const elemental = mitigated * resistMultiplier(elementResistance(target, ability.element));
  const resisted = elemental * (1 - passive(target, 'resilient') / 100);
  // The floor is there so a heavily mitigated hit still registers, but it must
  // not apply to genuine immunity: an attack labelled IMMUNE that deals 1 is a
  // lie, and the one-point difference is worth less than the label being true.
  if (elemental === 0) return 0;
  return Math.max(1, Math.round(resisted));
}

/**
 * A unit's resistance to one element, as a percentage.
 *
 * The wheel supplies the default and the sheet may override it. A runtime
 * modifier layer -- "+40% fire resistance for three turns" -- adds on top of
 * this and is where status effects will hook in; until statuses exist there is
 * nothing to add, so this is the whole calculation.
 */
export function elementResistance(unit: Unit, element: Ability['element']): number {
  if (!element) return 0;
  return resistanceOf(element, unit.def.resistances) + (unit.resistMods[element] ?? 0);
}

/** HP an attacker recovers from a lifesteal passive, if any. */
export function lifestealHeal(source: Unit, dealt: number): number {
  const pct = passive(source, 'lifesteal');
  return pct > 0 ? Math.max(1, Math.round((dealt * pct) / 100)) : 0;
}

/** Damage a melee attacker takes back from a thorns passive, if any. */
export function thornsDamage(target: Unit, ability: Ability, dealt: number): number {
  if (ability.range > 1) return 0;
  const pct = passive(target, 'thorns');
  return pct > 0 ? Math.max(1, Math.round((dealt * pct) / 100)) : 0;
}

/**
 * Everyone an ability would hit.
 *
 * `candidates` is already the affected side -- foes for an attack, allies for
 * support -- so this only has to resolve the shape. A `self` ability is aimed at
 * its own caster, which makes it a `one` whose centre happens to be the caster;
 * the restriction that it CAN only be aimed there lives in `canTarget`.
 */
export function unitsHit(ability: Ability, centre: Pos, candidates: Unit[]): Unit[] {
  const living = candidates.filter(alive);
  if ((ability.scope ?? 'one') === 'all') return living;
  return living.filter((u) => samePos(u.pos, centre));
}

/**
 * Where an ability may be AIMED.
 *
 * Only `one` is gated by depth. `all` hits the whole side regardless, so every
 * slot on it is a legal aim point and the choice is a formality -- the click
 * confirms the cast rather than selecting a victim. `self` has exactly one legal
 * point, which is what stops a self-buff being pointed at a teammate.
 */
export function canTarget(ability: Ability, from: Unit, centre: Pos, units: Unit[]): boolean {
  const scope = ability.scope ?? 'one';
  if (scope === 'self') return samePos(centre, from.pos);
  if (scope === 'all') return true;
  return withinReach(ability, from, centre, units);
}

/**
 * Value of taking this action right now. Drives the enemy AI and the auto-battle
 * used for idle progression, so it stays simple enough that players can predict
 * it. Overkill is discounted so the AI does not dump a 9-cost into a dying unit.
 */
export function scoreAction(
  source: Unit,
  ability: Ability,
  centre: Pos,
  allies: Unit[],
  enemies: Unit[],
): number {
  switch (ability.kind) {
    case 'attack': {
      const hits = unitsHit(ability, centre, enemies);
      if (hits.length === 0) return 0;
      return hits.reduce((sum, t) => {
        const dmg = computeDamage(source, ability, t);
        const effective = Math.min(dmg, t.hp);
        // Finishing a unit removes its whole future output -- worth a premium.
        return sum + (dmg >= t.hp ? effective * 1.6 : effective);
      }, 0);
    }
    case 'heal': {
      const amount = computeHeal(source, ability);
      const hits = unitsHit(ability, centre, allies);
      return hits.reduce((sum, u) => sum + Math.min(amount, unitMaxHp(u) - u.hp), 0);
    }
    case 'buff': {
      // A flat multiplier here made the AI turtle: a 5-target +30 atk buff scored
      // 300, beating almost every attack, and 25% of battles timed out. Instead
      // estimate the extra damage the buff actually produces before it decays.
      const hits = unitsHit(ability, centre, allies);
      const living = enemies.filter(alive);
      if (living.length === 0 || hits.length === 0) return 0;

      const avgDef = living.reduce((s, e) => s + effectiveDefense(e), 0) / living.length;
      const mitigation = 100 / (100 + avgDef);
      // Modifiers run a fixed number of turns now rather than decaying, so the
      // window a buff is worth anything over is the duration itself.
      const turnsActive = DEFAULT_MODIFIER_TURNS;

      if (ability.stat === 'defense') {
        // Value a guard buff as the damage it will absorb: raising DEF by N
        // multiplies incoming mitigation, so estimate against a typical hit.
        const avgAtk = living.reduce((s, e) => s + e.def.attack, 0) / living.length;
        return hits.reduce((sum, t) => {
          const before = effectiveDefense(t);
          const after = before + ability.power;
          const saved = avgAtk * (100 / (100 + before) - 100 / (100 + after));
          return sum + Math.max(0, saved) * turnsActive * EXPECTED_ACT_RATE;
        }, 0);
      }

      // There used to be an "will these units actually engage soon" discount
      // here, because on a map the AI would stand at spawn buffing itself until
      // the turn cap. Everyone is permanently in the fight now, so it always
      // evaluated to 1 -- and the failure mode it guarded against cannot happen.
      return hits.reduce((sum, t) => {
        const powers = t.def.abilities.filter((a) => a.kind === 'attack').map((a) => a.power);
        if (powers.length === 0) return sum;
        const avgPower = powers.reduce((a, b) => a + b, 0) / powers.length;
        return sum + ability.power * avgPower * mitigation * turnsActive * EXPECTED_ACT_RATE;
      }, 0);
    }
  }
}

/**
 * Rough worth of buying the next upgrade tier, for the auto-battler. Values the
 * permanent +10% as extra damage across the rest of the fight, so it competes
 * with -- but usually loses to -- an attack that is available right now.
 */
export function scoreUpgrade(unit: Unit, enemies: Unit[]): number {
  const living = enemies.filter(alive);
  if (living.length === 0) return 0;

  const avgDef = living.reduce((n, e) => n + effectiveDefense(e), 0) / living.length;
  const mitigation = 100 / (100 + avgDef);
  const powers = unit.def.abilities.filter((a) => a.kind === 'attack').map((a) => a.power);
  const avgPower = powers.length ? powers.reduce((a, b) => a + b, 0) / powers.length : 1;

  const perHit = unit.def.attack * UPGRADE_STAT_BONUS * avgPower * mitigation;
  const EXPECTED_REMAINING_ACTS = 5;
  return perHit * EXPECTED_REMAINING_ACTS + 18;
}
