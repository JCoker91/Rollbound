import type { Ability, Passive, Unit } from './types.ts';
import { alive, UPGRADE_STAT_BONUS } from './types.ts';
import { elementMultiplier } from './elements.ts';
import { TERRAIN, hasLineOfSight, manhattan, terrainAt, type MapDef, type Pos } from './grid.ts';

/** Attack buffs lose this much per turn; see battle.ts. */
export const BUFF_DECAY_PER_TURN = 10;
/** Measured from simulation: a living character acts ~70% of phases. */
const EXPECTED_ACT_RATE = 0.7;

/** Defense stat, plus terrain cover, plus any active guard buff. */
export function effectiveDefense(unit: Unit, map: MapDef): number {
  return (
    Math.round(unit.def.defense * statScale(unit)) +
    unit.defBuff +
    TERRAIN[terrainAt(map, unit.pos)].defBonus
  );
}

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

export const unitAttack = (u: Unit): number =>
  Math.round(u.def.attack * statScale(u)) + u.atkBuff;

export const unitMaxHp = (u: Unit): number => Math.round(u.def.maxHp * statScale(u));

/** Movement budget, including any `swift` passive. */
export const unitMove = (u: Unit): number => u.def.move + passive(u, 'swift');

/** Flat damage formula. Defense is diminishing-returns rather than subtractive. */
export function computeDamage(source: Unit, ability: Ability, target: Unit, map: MapDef): number {
  const frenzy = source.hp * 2 <= unitMaxHp(source) ? passive(source, 'frenzy') : 0;
  const atk = unitAttack(source) * (1 + frenzy / 100);
  const base = atk * ability.power;
  const mitigated = base * (100 / (100 + effectiveDefense(target, map)));
  const elemental = mitigated * elementMultiplier(ability.element, target.def.element);
  const resisted = elemental * (1 - passive(target, 'resilient') / 100);
  return Math.max(1, Math.round(resisted));
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

/** Everyone an ability centred on `centre` would hit, given its AoE shape. */
export function unitsHit(ability: Ability, centre: Pos, candidates: Unit[]): Unit[] {
  const radius = ability.aoeRadius ?? 0;
  return candidates.filter((u) => alive(u) && manhattan(u.pos, centre) <= radius);
}

/** Distance check only -- see `canTarget` for the rule the game actually uses. */
export function inRange(ability: Ability, from: Pos, centre: Pos): boolean {
  const d = manhattan(from, centre);
  return d >= (ability.minRange ?? 0) && d <= ability.range;
}

/**
 * Full targeting rule: close enough AND with an unobstructed line. Buildings
 * block shots, so a ranged unit has to step around a corner rather than fire
 * through it. Adjacent targets always have line of sight -- nothing sits
 * between two neighbouring tiles.
 *
 * Note this gates where an ability may be AIMED. Splash from an AoE still hits
 * everything in its radius, so a blast centred in the open can wrap around a
 * corner -- deliberate, and what makes AoE worth its dice on a dense map.
 */
export function canTarget(ability: Ability, from: Pos, centre: Pos, map: MapDef): boolean {
  return inRange(ability, from, centre) && hasLineOfSight(map, from, centre);
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
  map: MapDef,
): number {
  switch (ability.kind) {
    case 'attack': {
      const hits = unitsHit(ability, centre, enemies);
      if (hits.length === 0) return 0;
      return hits.reduce((sum, t) => {
        const dmg = computeDamage(source, ability, t, map);
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

      const avgDef = living.reduce((s, e) => s + effectiveDefense(e, map), 0) / living.length;
      const mitigation = 100 / (100 + avgDef);
      const turnsActive = Math.max(1, ability.power / BUFF_DECAY_PER_TURN);

      // Buffs decay, so pre-buffing four turns before contact is wasted. Scale
      // by how many of the buffed units could actually engage soon -- without
      // this the AI stands at its spawn buffing itself until the turn cap.
      if (ability.stat === 'defense') {
        // Value a guard buff as the damage it will absorb: raising DEF by N
        // multiplies incoming mitigation, so estimate against a typical hit.
        const avgAtk = living.reduce((s, e) => s + e.def.attack, 0) / living.length;
        return hits.reduce((sum, t) => {
          const before = effectiveDefense(t, map);
          const after = before + ability.power;
          const saved = avgAtk * (100 / (100 + before) - 100 / (100 + after));
          return sum + Math.max(0, saved) * turnsActive * EXPECTED_ACT_RATE;
        }, 0);
      }

      const engaged =
        hits.filter((t) => {
          const reach = t.def.move + Math.max(...t.def.abilities.map((a) => a.range));
          return living.some((e) => manhattan(t.pos, e.pos) <= reach + 1);
        }).length / hits.length;
      if (engaged === 0) return 0;

      return hits.reduce((sum, t) => {
        const powers = t.def.abilities.filter((a) => a.kind === 'attack').map((a) => a.power);
        if (powers.length === 0) return sum;
        const avgPower = powers.reduce((a, b) => a + b, 0) / powers.length;
        return sum + ability.power * avgPower * mitigation * turnsActive * EXPECTED_ACT_RATE * engaged;
      }, 0);
    }
  }
}

/**
 * Rough worth of buying the next upgrade tier, for the auto-battler. Values the
 * permanent +10% as extra damage across the rest of the fight, so it competes
 * with -- but usually loses to -- an attack that is available right now.
 */
export function scoreUpgrade(unit: Unit, enemies: Unit[], map: MapDef): number {
  const living = enemies.filter(alive);
  if (living.length === 0) return 0;

  const avgDef = living.reduce((n, e) => n + effectiveDefense(e, map), 0) / living.length;
  const mitigation = 100 / (100 + avgDef);
  const powers = unit.def.abilities.filter((a) => a.kind === 'attack').map((a) => a.power);
  const avgPower = powers.length ? powers.reduce((a, b) => a + b, 0) / powers.length : 1;

  const perHit = unit.def.attack * UPGRADE_STAT_BONUS * avgPower * mitigation;
  const EXPECTED_REMAINING_ACTS = 5;
  return perHit * EXPECTED_REMAINING_ACTS + 18;
}
