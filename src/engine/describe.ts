import type { Ability, Effect, ModStat, Passive } from './types.ts';
import { DEFAULT_MODIFIER_TURNS } from './combat.ts';
import { STRONG_RESIST, WEAK_RESIST, strongAgainst, weakTo } from './elements.ts';

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

/** "one enemy in the front rank" / "the whole party" / "the caster". */
function targetPhrase(a: Ability): string {
  const scope = a.scope ?? 'one';
  if (scope === 'self') return 'the caster';
  if (a.kind !== 'attack') {
    // Support reaches any ally; depth never gates it.
    return scope === 'all' ? 'the whole party' : 'one ally';
  }
  return scope === 'all' ? 'the entire enemy line' : `one enemy ${reachPhrase(a)}`;
}

const STAT_LABEL: Record<ModStat, string> = {
  attack: 'ATK',
  physicalDefense: 'P.DEF',
  magicalDefense: 'M.DEF',
};

/** "ATK", "ATK and P.DEF", "ATK, P.DEF and M.DEF". */
function statList(stats: ModStat[]): string {
  const names = stats.map((x) => STAT_LABEL[x]);
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * Who one effect lands on, in words -- and a pronoun for it.
 *
 * The pronoun is what keeps a multi-effect sentence readable. Naming the
 * target twice gives "reduces one enemy in the first two ranks's P.DEF by 25%
 * of one enemy in the first two ranks's base", which is accurate and unusable.
 */
function effectTargetPhrase(a: Ability, fx: Effect): { full: string; it: string } {
  switch (fx.on ?? 'target') {
    case 'self':
      return { full: 'the caster', it: 'their' };
    case 'allies':
      return { full: 'the whole party', it: 'their' };
    default:
      return {
        full: targetPhrase(a),
        it: a.kind === 'attack' && (a.scope ?? 'one') !== 'all' ? 'its' : 'their',
      };
  }
}

/**
 * One clause of rules text.
 *
 * `sameTargetAsPrevious` swaps the target for a pronoun, so an ability that
 * hits and then debuffs the same creature reads as one sentence about one
 * creature rather than two about a slot.
 */
function describeEffect(a: Ability, fx: Effect, sameTargetAsPrevious: boolean): string {
  const who = effectTargetPhrase(a, fx);
  const name = sameTargetAsPrevious ? (who.it === 'its' ? 'it' : 'them') : who.full;

  switch (fx.do) {
    case 'damage': {
      const type = fx.damageType ?? a.damageType ?? 'physical';
      const element = fx.element ?? a.element;
      const kind = type === 'true' ? 'true' : element ? `${cap(element)} ${type}` : type;
      return `deals ${pct(fx.power)} of ATK as ${kind} damage to ${name}`;
    }
    case 'heal':
      return `restores ${pct(fx.power)} of ATK as HP to ${name}`;
    case 'modify': {
      const size = `${Math.abs(fx.percent)}%`;
      // Naming the SOURCE is not decoration: "20% of the caster's stats" and
      // "20% of your own" are different abilities, and which one this is
      // decides whether building the caster up is worth anything.
      const of =
        fx.of === 'casterCurrent' ? "the caster's current stats" : `${who.it} own base stats`;
      const verb = fx.percent < 0 ? 'reduces' : 'raises';
      const whose = sameTargetAsPrevious ? who.it : `${who.full}'s`;
      return (
        `${verb} ${whose} ${statList(fx.stats)} by ${size} of ${of} ` +
        `for ${fx.turns} turn${fx.turns === 1 ? '' : 's'}`
      );
    }
  }
}

/**
 * Full rules text, generated from the ability's own numbers so it can never
 * drift out of sync with what the engine actually does.
 *
 * An effect list is read in order and joined with "then", because the order is
 * load-bearing -- a self-buff written before the damage is up when the damage
 * lands, and the sentence has to say so.
 */
export function describeAbility(a: Ability): string {
  if (a.effects) {
    const parts = a.effects.map((fx, i) => {
      const prev = a.effects![i - 1];
      const same = prev !== undefined && (prev.on ?? 'target') === (fx.on ?? 'target');
      return describeEffect(a, fx, same);
    });
    const joined = parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(', ')}, then ${parts[parts.length - 1]}`;
    return `${cap(joined)}.`;
  }

  switch (a.kind) {
    case 'attack':
      // True damage says so; it is the only type whose mitigation the player
      // cannot look up on a stat block. An ability with no element names only
      // its damage type -- there is no matchup to mention.
      const type = a.damageType ?? 'physical';
      const kind =
        type === 'true' ? 'true' : a.element ? `${cap(a.element)} ${type}` : type;
      return `Deals ${pct(a.power)} of ATK as ${kind} damage to ${targetPhrase(a)}.`;
    case 'heal':
      return `Restores ${pct(a.power)} of ATK as HP to ${targetPhrase(a)}.`;
    case 'buff': {
      const stat = a.stat === 'defense' ? 'DEF' : 'ATK';
      return `Grants +${a.power} ${stat} to ${targetPhrase(a)} for ${DEFAULT_MODIFIER_TURNS} turns.`;
    }
  }
}

/** How this ability's element interacts with the matchup wheel. */
export function describeElement(a: Ability): string | null {
  if (a.kind !== 'attack' || !a.element) return null;
  // Phrased as a convention, not a law. Resistance now lives on the target, so
  // the wheel only describes creatures authored with `aligned()` -- which is
  // most of them, and worth telling the player, but an exception is legal and
  // the forecast panel shows the real number either way.
  return (
    `${cap(a.element)}. Creatures aligned to ${strongAgainst(a.element!)} typically take ` +
    `${-WEAK_RESIST}% more; those aligned to ${weakTo(a.element!)} take ${STRONG_RESIST}% less.`
  );
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
