import type { Ability, Passive } from './types.ts';
import { BUFF_DECAY_PER_TURN } from './combat.ts';
import { STRONG, WEAK, strongAgainst, weakTo } from './elements.ts';

const cap = (s: string): string => s[0]!.toUpperCase() + s.slice(1);
const pct = (n: number): string => `${Math.round(n * 100)}%`;

const tiles = (n: number): string => `${n} tile${n === 1 ? '' : 's'}`;

/** "up to 2 tiles away" or, for weapons with a dead zone, "2-3 tiles away". */
function reachPhrase(a: Ability): string {
  const min = a.minRange ?? 0;
  if (min > 1) return `${min}-${a.range} tiles away`;
  if (a.range === 1) return 'adjacent';
  return `up to ${tiles(a.range)} away`;
}

/** "one enemy up to 2 tiles away" / "all allies within 2 tiles of the target". */
function targetPhrase(a: Ability): string {
  const radius = a.aoeRadius ?? 0;
  const reach = reachPhrase(a);
  const noun = a.kind === 'attack' ? 'enemy' : 'ally';

  if (radius > 0) {
    const plural = a.kind === 'attack' ? 'enemies' : 'allies';
    return `all ${plural} within ${tiles(radius)} of a target ${reach}`;
  }
  return reach === 'adjacent' ? `one adjacent ${noun}` : `one ${noun} ${reach}`;
}

/**
 * Full rules text, generated from the ability's own numbers so it can never
 * drift out of sync with what the engine actually does.
 */
export function describeAbility(a: Ability): string {
  const element = cap(a.element);
  // With a dash the sentence becomes imperative ("Move ..., then deal"), so the
  // verb needs both forms rather than a lowercased splice.
  const verb = (third: string, bare: string) =>
    a.dash ? `Move up to ${tiles(a.dash)}, then ${bare}` : third;

  switch (a.kind) {
    case 'attack':
      return `${verb('Deals', 'deal')} ${pct(a.power)} of ATK as ${element} damage to ${targetPhrase(a)}.`;
    case 'heal':
      return `${verb('Restores', 'restore')} ${pct(a.power)} of ATK as HP to ${targetPhrase(a)}.`;
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
    case 'swift':
      return `Moves ${p.percent} extra tiles.`;
  }
}

/** How an enemy decides to use this ability. */
export function describeEnemyUsage(a: Ability): string | null {
  const bits: string[] = [];
  if (a.telegraph) bits.push(`announced ${a.telegraph} turn ahead, then lands`);
  if (a.cooldown) bits.push(`${a.cooldown}-turn cooldown`);
  return bits.length > 0 ? cap(bits.join(' · ')) : null;
}
