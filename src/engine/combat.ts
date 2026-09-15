import type {
  Ability,
  DamageType,
  ModKey,
  ModSource,
  ModStat,
  Passive,
  Pos,
  Unit,
} from './types.ts';
import { alive, UPGRADE_STAT_BONUS } from './types.ts';
import { resistanceOf, resistMultiplier } from './elements.ts';
import { samePos, slotsOf, withinReach } from './formation.ts';

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
export function modifierTotal(unit: Unit, stat: ModKey): number {
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
  // shred always bites at least a point. Safe again now that a point is a TENTH
  // of a damage point: rounding 20% of ATK 26 up from 5.2 to 5 costs 4%, where
  // at a whole-point scale the same floor turned +20% into +31%.
  return amount < 0 ? -Math.max(1, Math.round(-amount)) : Math.max(1, Math.round(amount));
}

/** An ability's damage type. Attacks default to physical; see types.ts. */
export const damageTypeOf = (a: Ability): DamageType => a.damageType ?? 'physical';

/**
 * How much one heal restores.
 *
 * `of` picks what the percentage is OF: the caster's ATK (support -- a healer's
 * output is gated by the same stat as their damage) or the recipient's own max
 * HP (sustain). Defaults to ATK, which is what every legacy `kind: 'heal'`
 * ability means.
 *
 * ONE function for both the forecast and the resolution. They used to be two:
 * the effect-list path in `battle.ts` multiplied by ATK and forgot to divide by
 * `ATK_PER_DAMAGE`, so Hibernate healed 54 while the panel beside it promised
 * 5. Two readers of the same field, disagreeing by a factor of ten.
 */
export function computeHeal(
  source: Unit,
  power: number,
  of: 'attack' | 'maxHp' = 'attack',
  target: Unit = source,
): number {
  return of === 'maxHp'
    ? Math.round(unitMaxHp(target) * power)
    : Math.round((unitAttack(source) * power) / ATK_PER_DAMAGE);
}

/**
 * Everything currently affecting this unit: its innate passives plus whichever
 * upgrade tiers it has bought this battle.
 */
export function activePassives(u: Unit): Passive[] {
  const bought = (u.def.upgrades ?? []).slice(0, u.upgrades).map((t) => t.passive);
  return [...(u.def.passives ?? []), ...bought];
}

/**
 * The kinds that are a percentage applied to their owner.
 *
 * `extraDie` is the first passive that is not one of these -- it puts a die in
 * the shared pool rather than changing a number on a sheet -- so "every passive
 * has a percent" stopped being true and this is the type that says which ones
 * still do.
 */
export type NumericPassive = Extract<Passive, { percent: number }>['kind'];

/** Summed, so buying a passive you already have stacks rather than replacing it. */
const passive = (u: Unit, kind: NumericPassive): number =>
  activePassives(u)
    .filter((p) => p.kind === kind)
    .reduce((n, p) => n + ('percent' in p ? p.percent : 0), 0);

/** Multiplier on attack, defense and max HP from bought upgrades. */
export const statScale = (u: Unit): number => 1 + u.upgrades * UPGRADE_STAT_BONUS;

export const unitAttack = (u: Unit): number => currentStat(u, 'attack');

export const unitMaxHp = (u: Unit): number => Math.round(u.def.maxHp * statScale(u));

/**
 * ATK points per point of damage, at power 1.0 and no mitigation.
 *
 * This is what lets ATK read as 26 while a hit lands for 2 on an 11 HP bar.
 * HP is small because a bar the player can count is worth more than one reading
 * 780, and that forces damage to be a small integer -- but a stat that moves in
 * whole damage points has no resolution left: ATK 2 to ATK 3 is a 50% jump
 * where the roster was authored at 37%, and +10% of it rounds to nothing.
 *
 * So the stat is measured in a FINER unit than its output. ATK and DEF are in
 * tenths of a damage point; the formula divides once, at the end. Nothing else
 * in the engine has to know, and every stat on every sheet is a whole number
 * again -- which is the whole reason the fractional-stat plumbing this replaced
 * could be deleted.
 */
export const ATK_PER_DAMAGE = 10;

/*
 * THERE IS NO MITIGATION CONSTANT. Armour is measured against the ATTACKER.
 *
 * `MITIGATION_ANCHOR = 100` used to sit here: a fixed reference for "how much
 * armour is a lot", multiplied by the attacker's `powerScale` so it would not
 * expire as levels climbed. It worked, and it had two problems.
 *
 * The first is readability, and it is why this changed. `DEF 50` meant nothing
 * against `ATK 104` -- the two were the same size by coincidence and unrelated
 * by construction, so nothing on the sheet told a player what a point of armour
 * was worth. `ATK / (ATK + DEF)` makes the comparison the rule: **equal stats
 * halve the blow**, twice the armour of their attack quarters it, and DEF is
 * finally a number you read against the ATK opposite it.
 *
 * The second is that the anchor only SIMULATED level-invariance. It needed
 * `powerScale` threaded into the damage formula to cancel the defender's
 * growth; the opposed form cancels it structurally, because both sides carry
 * the same scale and it divides out. One fewer thing that can go stale.
 *
 * What is kept: diminishing returns, no immunity, no negative damage, and each
 * point of DEF buying a constant slice of effective HP (`1 + DEF/ATK`).
 * Subtractive `ATK - DEF` has none of those -- measured on this roster, a tank
 * with DEF 20 against an ATK 10 attacker takes exactly zero.
 */

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

/**
 * A hit's damage before the defender's `resilient` bank is spent on it, as an
 * exact number. The shared half of `computeDamage` and `spendResilience`.
 */
/**
 * The least a blow may land for, as a fraction of what it would deal with no
 * armour, no resistance and no reduction at all.
 *
 * A FRACTION, not a number, because a flat floor is a scale-dependent constant
 * and this codebase has now produced three of those. `Math.max(1, ...)` alone
 * is right at level 1 and meaningless at level 80: it has never once bound
 * above level 1 (measured, 0 of 140 possible hits at every level), so the
 * promise that "a heavily mitigated hit still registers" was being kept by
 * accident rather than by the code.
 *
 * Stated the other way round it is a cap on stacked mitigation: armour,
 * elemental resistance, `resilient` and `chill` together may absorb at most
 * 95% of a blow. That is the property worth guaranteeing, and it holds at any
 * scale -- against a 10,000 HP tank the weakest hit in the game stays a
 * readable number instead of collapsing to 1.
 *
 * Immunity is exempt and must stay exempt: an attack labelled IMMUNE that
 * deals a trickle is a worse lie than one that deals nothing.
 */
export const MIN_DAMAGE_FRACTION = 0.05;

/** What a hit would deal with nothing in the way. The floor is measured off this. */
function unmitigatedDamage(source: Unit, ability: Ability): number {
  const frenzy = source.hp * 2 <= unitMaxHp(source) ? passive(source, 'frenzy') : 0;
  return (unitAttack(source) * (1 + frenzy / 100) * ability.power) / ATK_PER_DAMAGE;
}

function elementalDamage(source: Unit, ability: Ability, target: Unit): number {
  const frenzy = source.hp * 2 <= unitMaxHp(source) ? passive(source, 'frenzy') : 0;
  const atk = unitAttack(source) * (1 + frenzy / 100);
  const base = (atk * ability.power) / ATK_PER_DAMAGE;
  // Mitigation is `K / (K + DEF)` -- diminishing returns, never negative damage,
  // never immunity, and each point of DEF buys a constant slice of effective HP.
  // Subtractive `ATK - DEF` has none of those properties: it needs clamping at
  // zero, creates hard thresholds where an attacker flips from useful to
  // useless, and makes many small hits worthless against armour.
  //
  // Armour is measured against the ATTACKER's own strength, so both sides carry
  // the same level scale and it divides out: mitigation is level-invariant by
  // construction rather than by threading `powerScale` through the formula. A
  // level GAP still falls out for free, because the two scales no longer match
  // -- an out-levelled attacker is resisted, an over-levelled one cuts through.
  const armour = effectiveDefense(target, damageTypeOf(ability));
  const mitigated = base * (atk / (atk + armour));
  return mitigated * resistMultiplier(elementResistance(target, ability.element));
}

/** The exact damage a unit's `resilient` passives take off one hit. */
/**
 * How much damage this hit loses to the defender's side, as a percentage.
 *
 * Two sources, added rather than multiplied because additive is the thing a
 * player can do in their head: `resilient` on the victim, and `chill` from
 * whatever the ATTACKER is carrying in frost.
 *
 * `chill` is an aura, which is why `defenders` is here at all. It belongs to a
 * living member of the defending side -- Rebar's Winterhide -- and it reads the
 * attacker's frost stacks, so it is the first thing in the damage formula that
 * depends on somebody standing who is neither dealing nor taking the hit. Lose
 * the carrier and every frosted enemy hits full again.
 */
function reductionPercent(source: Unit, target: Unit, defenders: Unit[]): number {
  let pct = passive(target, 'resilient');

  // Chill auras do NOT stack: the deepest one on the field applies.
  //
  // Summing them would mean an upgrade that widens the cap (Glacier, 5 -> 10)
  // piles on top of the innate rather than replacing it -- 20% + 40% = 60% from
  // one character. "The cold is as deep as its deepest source" is both the
  // sane rule and the one that makes a cap upgrade mean what it says.
  const stacks = source.statuses.frost;
  if (stacks > 0) {
    let best = 0;
    for (const d of defenders) {
      if (!alive(d)) continue;
      for (const p of activePassives(d)) {
        if (p.kind === 'chill') best = Math.max(best, Math.min(stacks, p.max) * p.percent);
      }
    }
    pct += best;
  }

  // Asleep, and something is about to wake him. See `dormant`.
  if (target.statuses.asleep) {
    for (const p of activePassives(target)) if (p.kind === 'dormant') pct += p.percent;
  }
  return pct;
}

const resilienceShare = (source: Unit, target: Unit, defenders: Unit[], raw: number): number => {
  const pct = reductionPercent(source, target, defenders);
  return pct > 0 ? (raw * pct) / 100 : 0;
};

/**
 * Whole points this hit's resilience is worth, WITHOUT spending the bank.
 *
 * `resilient` is a percentage of a number that is usually 1, 2 or 3, and
 * multiplying before rounding quietly deleted it: measured against the damage
 * the game actually deals, a stated 8% delivered 0.7% and a stated 10% just
 * 1.3%, while 18% delivered 21.3%. It is not a curve that can be re-tuned
 * either -- 3 is the modal hit and `3 x 0.85` rounds back to 3, so a single
 * point of resilience flips 37% of all damage at once. Banking the fraction
 * until it is worth a whole point brings every value within ~1 point of what
 * it claims. See `Unit.carry`.
 *
 * Split into a peek and a spend because `computeDamage` has to stay PURE: the
 * forecast panel calls it to show what a hit would do and the AI calls it
 * dozens of times a turn, and neither may advance the defender's bank. Both
 * read the same carry, so the forecast is exact.
 */
const peekResilience = (source: Unit, target: Unit, defenders: Unit[], raw: number): number =>
  Math.floor((target.carry.resilient ?? 0) + resilienceShare(source, target, defenders, raw));

/**
 * Advance the resilience bank for one landed hit.
 *
 * Called once, by `strike`, right after the damage it reported. Forgetting it
 * fails closed rather than open -- a bank that never advances never reaches a
 * whole point, so resilience simply stops applying.
 */
export function spendResilience(
  source: Unit,
  ability: Ability,
  target: Unit,
  defenders: Unit[],
): void {
  const raw = elementalDamage(source, ability, target);
  if (raw > 0) bank(target, 'resilient', resilienceShare(source, target, defenders, raw));
}

/** Flat damage formula. Defense is diminishing-returns rather than subtractive. */
export function computeDamage(
  source: Unit,
  ability: Ability,
  target: Unit,
  /**
   * The target's own side. Required because `chill` is an aura: the reduction
   * is owned by a THIRD unit, not by either party to the hit. Passing an empty
   * list is legal and simply means no aura applies.
   */
  defenders: Unit[] = [],
): number {
  const raw = elementalDamage(source, ability, target);
  // Genuine immunity deals nothing, and is the one thing the floor may not
  // rescue: an attack labelled IMMUNE that deals a trickle is a worse lie than
  // one that deals zero.
  if (raw === 0) return 0;
  // At least one point, and at least `MIN_DAMAGE_FRACTION` of the unmitigated
  // blow -- the first keeps early hits honest, the second keeps late ones from
  // collapsing to a rounding error however much armour is stacked.
  const floor = Math.max(1, Math.round(unmitigatedDamage(source, ability) * MIN_DAMAGE_FRACTION));
  const after = Math.max(1, Math.round(raw)) - peekResilience(source, target, defenders, raw);
  return Math.max(floor, after);
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
  return (
    resistanceOf(element, unit.def.resistances) +
    // The boss rotation's layer: set wholesale each round, no duration.
    (unit.resistMods[element] ?? 0) +
    // Timed resistance from abilities, sharing the modifier list so it expires
    // by the same rule as everything else.
    modifierTotal(unit, element)
  );
}

/**
 * Add a fractional amount to a unit's bank and hand back the whole points.
 *
 * See `Unit.carry`. A percentage of a small number is usually less than one
 * point, and both ways of rounding it are wrong; banking makes "12% of every
 * hit" mean 12% however small the hits are.
 */
export function bank(u: Unit, key: string, amount: number): number {
  if (amount <= 0) return 0;
  const total = (u.carry[key] ?? 0) + amount;
  const whole = Math.floor(total);
  u.carry[key] = total - whole;
  return whole;
}

/** HP an attacker recovers from a lifesteal passive, if any. */
export function lifestealHeal(source: Unit, dealt: number): number {
  const pct = passive(source, 'lifesteal');
  return pct > 0 ? bank(source, 'lifesteal', (dealt * pct) / 100) : 0;
}

/** Damage a melee attacker takes back from a thorns passive, if any. */
export function thornsDamage(target: Unit, ability: Ability, dealt: number): number {
  if (ability.range > 1) return 0;
  const pct = passive(target, 'thorns');
  return pct > 0 ? bank(target, 'thorns', (dealt * pct) / 100) : 0;
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
  switch (ability.scope ?? 'one') {
    case 'all':
      return living;
    // Cut the formation along one axis. `x` is rank and `y` is file, so a
    // column catches one rank front-to-back and a row cuts across all of them.
    case 'column':
      return living.filter((u) => u.pos.x === centre.x);
    case 'row':
      return living.filter((u) => u.pos.y === centre.y);
    // Aimed at a SLOT, which may hold nobody. Whoever is standing there is the
    // one it touches, and that is allowed to be no one.
    case 'slot':
      return living.filter((u) => samePos(u.pos, centre));
    default:
      return living.filter((u) => samePos(u.pos, centre));
  }
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
  // A slot ability aims at the caster's OWN side, at a slot rather than a unit,
  // and only ONE STEP -- orthogonally adjacent, never diagonal.
  //
  // Free placement made the grid a menu: every turn you could put anyone
  // anywhere, so the formation had no state worth defending and no cost to
  // being wrong. One step makes position something you hold or give up over
  // several turns, and it prices the corners -- a centre slot has four
  // neighbours, an edge three, a corner two, so where you stand decides how
  // much the die you spend is worth.
  //
  // Orthogonal only, because the diagonal is the move that would undo that: it
  // crosses a rank and a file at once, which is the one step that changes both
  // "who can reach me" and "what line catches me" for a single die.
  if (scope === 'slot') {
    const step = Math.abs(centre.x - from.pos.x) + Math.abs(centre.y - from.pos.y);
    if (step !== 1) return false;
    return slotsOf(from.side).some((sl) => sl.col === centre.x && sl.row === centre.y);
  }
  // A line is aimed by naming any slot on it, so the depth check is the same
  // one a single target gets: it is asked about the slot you pointed at.
  return withinReach(ability, from, centre, units);
}

/**
 * Stat points a buff will actually add to `target` on one track.
 *
 * `Ability.power` is the amount ONLY under the legacy authoring, where a buff
 * carries no `effects` list. An ability WITH effects keeps its real numbers
 * there -- Rally's `power` is a vestigial 20 while its effect is +20% of the
 * caster's current ATK -- and scoring those off `power` read the 20 as twenty
 * flat stat points. That is why Rally was the single most-used ability in
 * simulation at 25% of every player action: the AI thought it was enormous.
 */
function buffStatGain(source: Unit, ability: Ability, target: Unit, stat: ModStat): number {
  if (!ability.effects) {
    const tracks: ModStat[] =
      (ability.stat ?? 'attack') === 'defense'
        ? ['physicalDefense', 'magicalDefense']
        : ['attack'];
    return tracks.includes(stat) ? ability.power : 0;
  }
  let total = 0;
  for (const fx of ability.effects) {
    if (fx.do !== 'modify' || !fx.stats.includes(stat)) continue;
    // A self-buff bundled into a team ability is worth nothing to anyone else,
    // and counting it for each ally is how a one-target effect scores five.
    if ((fx.on ?? 'target') === 'self' && target !== source) continue;
    total += resolveModifierAmount(source, target, stat, fx.percent, fx.of);
  }
  return total;
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
    // Zero, deliberately. The AI has no positional sense at all -- it cannot
    // tell a good slot from a bad one, and an auto-battler that repositions at
    // random is worse than one that never does. Scoring it means it never
    // appears in a plan, which is the correct behaviour rather than a gap.
    case 'move':
      return 0;
    case 'attack': {
      const hits = unitsHit(ability, centre, enemies);
      if (hits.length === 0) return 0;
      return hits.reduce((sum, t) => {
        // `enemies` IS the target's own side from the attacker's point of view,
        // so the aura is priced in rather than being a surprise the AI walks into.
        const dmg = computeDamage(source, ability, t, enemies);
        const effective = Math.min(dmg, t.hp);
        // Finishing a unit removes its whole future output -- worth a premium.
        return sum + (dmg >= t.hp ? effective * 1.6 : effective);
      }, 0);
    }
    case 'heal': {
      const amount = computeHeal(source, ability.power);
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
      const mitigation = unitAttack(source) / (unitAttack(source) + avgDef);
      // Modifiers run a fixed number of turns now rather than decaying, so the
      // window a buff is worth anything over is the duration itself.
      const turnsActive = DEFAULT_MODIFIER_TURNS;

      if (ability.stat === 'defense') {
        // Value a guard buff as the damage it will absorb: raising DEF by N
        // multiplies incoming mitigation, so estimate against a typical hit.
        const avgAtk = living.reduce((s, e) => s + e.def.attack, 0) / living.length;
        return hits.reduce((sum, t) => {
          const before = effectiveDefense(t);
          const after = before + buffStatGain(source, ability, t, 'physicalDefense');
          const saved =
            (avgAtk / ATK_PER_DAMAGE) *
            (avgAtk / (avgAtk + before) - avgAtk / (avgAtk + after));
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
        const gain = buffStatGain(source, ability, t, 'attack');
        return (
          sum +
          ((gain * avgPower) / ATK_PER_DAMAGE) * mitigation * turnsActive * EXPECTED_ACT_RATE
        );
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
  const mitigation = unitAttack(unit) / (unitAttack(unit) + avgDef);
  const powers = unit.def.abilities.filter((a) => a.kind === 'attack').map((a) => a.power);
  const avgPower = powers.length ? powers.reduce((a, b) => a + b, 0) / powers.length : 1;

  const perHit =
    ((unit.def.attack * UPGRADE_STAT_BONUS * avgPower) / ATK_PER_DAMAGE) * mitigation;
  const EXPECTED_REMAINING_ACTS = 5;
  // The flat term is a floor in DAMAGE units, so it moves with the stat scale.
  // It is the "buying a tier is worth SOMETHING even against a soft target"
  // nudge; left behind by a rescale it stops competing at all and the AI simply
  // never upgrades, which is a silent behaviour change rather than a visible
  // one. Four, because an average hit is now ~13 rather than ~2.8.
  return perHit * EXPECTED_REMAINING_ACTS + 4;
}
