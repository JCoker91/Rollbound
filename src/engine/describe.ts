import type { Ability, Passive } from './types.ts';
import { BUFF_DECAY_PER_TURN } from './combat.ts';
import { STRONG, WEAK, strongAgainst, weakTo } from './elements.ts';

const cap = (s: string): string => s[0]!.toUpperCase() + s.slice(1);
const pct = (n: number): string => `${Math.round(n * 100)}%`;

const slots = (n: number): string => `${n} slot${n === 1 ? '' : 's'}`;

/**
 * How deep into the enemy line this reaches. Ranks are counted over those that
 * still hold someone, so "the front rank" always means whoever is currently
 * in front rather than a fixed column.
 */
function reachPhrase(a: Ability): string {
  if (a.range <= 1) return 'in the front rank';
  if (a.range === 2) return 'in the first two ranks';
  return 'anywhere in the enemy line';
}

/** "one enemy in the front rank" / "all allies within 1 slot of the target". */
function targetPhrase(a: Ability): string {
  const radius = a.aoeRadius ?? 0;

  if (a.kind !== 'attack') {
    // Support reaches the whole party; depth never gates it.
    return radius > 0 ? `all allies within ${slots(radius)} of a target` : 'one ally';
  }
  return radius > 0
    ? `all enemies within ${slots(radius)} of a target ${reachPhrase(a)}`
    : `one enemy ${reachPhrase(a)}`;
}

/**
 * Full rules text, generated from the ability's own numbers so it can never
 * drift out of sync with what the engine actually does.
 */
export function describeAbility(a: Ability): string {
  const element = cap(a.element);

  switch (a.kind) {
    case 'attack':
      return `Deals ${pct(a.power)} of ATK as ${element} damage to ${targetPhrase(a)}.`;
    case 'heal':
      return `Restores ${pct(a.power)} of ATK as HP to ${targetPhrase(a)}.`;
    case 'buff': {
      const stat = a.stat === 'defense' ? 'DEF' : 'ATK';
      return `Grants +${a.power} ${stat} to ${targetPhrase(a)}, decaying by ${BUFF_DECAY_PER_TURN} at the start of each of their turns.`;
    }
  }
}

/** How this ability's element interacts with the matchup wheel. */
export function describeElement(a: Ability): string | null {
  if (a.kind !== 'attack') return null;
  return `${cap(a.element)} deals ${STRONG}× to ${strongAgainst(a.element)} and ${WEAK}× to ${weakTo(a.element)}.`;
}

/** How the dice pay for it, spelled out. */
export function describeCost(a: Ability): string {
  if (a.wildcard) {
    return 'Basic — spend any single die, whatever its value. Always available.';
  }
  return `Spend any dice totalling exactly ${a.cost}.`;
}

/** Rules text for an always-on effect. */
export function describePassive(p: Passive): string {
  switch (p.kind) {
    case 'regen':
      return `Recovers ${p.percent}% of max HP at the start of each of its turns.`;
    case 'thorns':
      return `Reflects ${p.percent}% of damage taken back at melee attackers.`;
    case 'resilient':
      return `Takes ${p.percent}% less damage from all sources.`;
    case 'frenzy':
      return `Deals ${p.percent}% more damage while below half HP.`;
    case 'lifesteal':
      return `Recovers ${p.percent}% of the damage it deals as HP.`;
  }
}

/** How an enemy decides to use this ability. */
export function describeEnemyUsage(a: Ability): string | null {
  const bits: string[] = [];
  if (a.telegraph) bits.push(`announced ${a.telegraph} turn ahead, then lands`);
  if (a.cooldown) bits.push(`${a.cooldown}-turn cooldown`);
  return bits.length > 0 ? cap(bits.join(' · ')) : null;
}
