import { describeDie } from './dice.ts';
import type { Ability, Effect, ModStat, Passive, VersusPower } from './types.ts';
import { DEFAULT_MODIFIER_TURNS } from './combat.ts';
import { STRONG_RESIST, WEAK_RESIST, strongAgainst, weakTo } from './elements.ts';

const cap = (s: string): string => s[0]!.toUpperCase() + s.slice(1);
const pct = (n: number): string => `${Math.round(n * 100)}%`;

const slots = (n: number): string => `${n} slot${n === 1 ? '' : 's'}`;

/**
 * " -- 200% against a frozen target" and nothing at all when no condition is set.
 *
 * Written as a trailing clause rather than a second sentence so it survives
 * being joined into a multi-effect list, where "Deals X. If frozen, Y." would
 * put a full stop in the middle of one.
 */
function versusClause(v: VersusPower | undefined): string {
  if (v?.frozen === undefined) return '';
  return ` — ${pct(v.frozen)} against a frozen target`;
}

/** ", +25% per frost stack on it" — the counter is read, never spent. */
function perFrostClause(per: number | undefined): string {
  return per ? `, +${pct(per)} per frost stack on it` : '';
}

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
  if (scope === 'slot') return 'a slot in your own formation';
  if (a.kind !== 'attack') {
    // Support reaches any ally; depth never gates it.
    if (scope === 'all') return 'the whole party';
    if (scope === 'column') return 'every ally in one rank';
    if (scope === 'row') return 'every ally in one row';
    return 'one ally';
  }
  if (scope === 'all') return 'the entire enemy line';
  // Named by the line it cuts, not by the slot you point at. "Every enemy in
  // one rank" is what the player has to arrange against; which slot was
  // clicked to say so is an input detail.
  if (scope === 'column') return `every enemy in one rank ${reachPhrase(a)}`;
  if (scope === 'row') return `every enemy in one row ${reachPhrase(a)}`;
  return `one enemy ${reachPhrase(a)}`;
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
      return (
        `deals ${pct(fx.power)} of ATK as ${kind} damage to ${name}` +
        `${versusClause(fx.versus)}${perFrostClause(fx.perFrost)}`
      );
    }
    case 'heal':
      // Says what the percentage is OF, because "90% of ATK" and "25% of max
      // HP" are wildly different numbers and the sheet has both on it.
      return fx.of === 'maxHp'
        ? `heals ${name} for ${pct(fx.power)} of ${name === 'the caster' ? 'their' : 'its'} max HP`
        : `restores ${pct(fx.power)} of ATK as HP to ${name}`;
    case 'frost':
      return `applies ${fx.stacks} frost to ${name}`;
    case 'regen':
      return `grants ${name} regen for ${fx.turns} turn${fx.turns === 1 ? '' : 's'}`;
    case 'sleep':
      // No explanation of what sleep DOES. A status is learned once, and
      // restating the rule under every ability that applies it is the same
      // waste the chain symbols were: the game has a word for it, so use it.
      return `applies sleep to ${name}`;
    case 'taunt':
      // Says what it cannot move as well as what it can. The AoE exemption is
      // the whole shape of the ability -- a player who learns it the hard way,
      // by taunting into a whole-side attack, has been misled by the text.
      return `taunts ${name}, pulling its declared attack onto the caster (a whole-side attack cannot be pulled)`;
    case 'move':
      return `moves ${name} ${Math.abs(fx.ranks)} rank${Math.abs(fx.ranks) === 1 ? '' : 's'} ${fx.ranks > 0 ? 'forward' : 'back'}`;
    case 'reposition':
      return 'steps into the chosen slot, trading places with whoever is there';
    case 'resist': {
      // A pronoun needs the possessive here, not the object form -- "raises
      // them Fire resistance" is what you get from reusing `name` directly.
      const whose = sameTargetAsPrevious ? who.it : `${who.full}'s`;
      return (
        `${fx.percent < 0 ? 'lowers' : 'raises'} ${whose} ${cap(fx.element)} resistance by ` +
        `${Math.abs(fx.percent)} for ${fx.turns} turn${fx.turns === 1 ? '' : 's'}`
      );
    }
    case 'modify': {
      const size = `${Math.abs(fx.percent)}%`;
      // Naming the SOURCE is not decoration: "20% of the caster's stats" and
      // "20% of your own" are different abilities, and which one this is
      // decides whether building the caster up is worth anything.
      const of =
        fx.of === 'casterCurrent' ? "the caster's current stats" : `${who.it} own base stats`;
      const verb = fx.percent < 0 ? 'reduces' : 'raises';
      const whose = sameTargetAsPrevious ? who.it : `${who.full}'s`;
      // The riposte rides on the modifier and is invisible to anyone reading
      // the effect list, so it has to be said here or the panel describes a
      // plain guard buff while the engine also frosts every attacker.
      const types = fx.riposte
        ? [fx.riposte.damageType, fx.riposte.also].filter(Boolean).join(' or ')
        : '';
      const rider = fx.riposte
        ? `, and while it lasts anyone hitting ${who.it === 'its' ? 'it' : 'them'} with a ` +
          `${types} attack takes ${fx.riposte.frost} frost`
        : '';
      return (
        `${verb} ${whose} ${statList(fx.stats)} by ${size} of ${of} ` +
        `for ${fx.turns} turn${fx.turns === 1 ? '' : 's'}${rider}`
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
      return (
        `Deals ${pct(a.power)} of ATK as ${kind} damage to ${targetPhrase(a)}` +
        `${versusClause(a.versus)}${perFrostClause(a.perFrost)}.`
      );
    case 'heal':
      return `Restores ${pct(a.power)} of ATK as HP to ${targetPhrase(a)}.`;
    case 'move':
      return `Steps into a chosen slot in your own formation, trading places with whoever is there.`;
    case 'buff': {
      const stat = a.stat === 'defense' ? 'DEF' : 'ATK';
      // A flat amount in STAT units, and stats are single digits now, so the
      // authored number can carry a decimal. Shown to one place.
      const amount = Math.round(a.power * 10) / 10;
      return `Grants +${amount} ${stat} to ${targetPhrase(a)} for ${DEFAULT_MODIFIER_TURNS} turns.`;
    }
  }
}

/**
 * The word for what an ability does with its symbol, for a tooltip.
 *
 * The panel draws the MARK, not this -- see `SymbolIcon`. A symbol is pure
 * identity: it does nothing, it matches, and two abilities showing the same
 * shape chain. Spelling that out under every ability that carried one cost
 * three lines to restate a rule the shape already states, and it restated it
 * once per ability, forever.
 *
 * What survives as text is only the part the mark cannot say: what THIS
 * ability does differently when it chains. Everything else is the icon.
 */
export function describeChain(a: Ability): string | null {
  if (!a.symbol) return null;
  return a.trigger ? `${cap(a.symbol)} — chained: ${a.trigger.text}` : cap(a.symbol);
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
    case 'lastingTaunt':
      return (
        `Its taunts keep working for ${p.turns} more turn${p.turns === 1 ? '' : 's'}: ` +
        `the provoked creature keeps choosing it without being taunted again.`
      );
    case 'grudgeArmor':
      return (
        `Takes ${p.percent}% less damage for the rest of the turn per hit already ` +
        `taken this turn, up to ${p.max}.`
      );
    case 'grudge':
      return (
        `Gains ${p.percent}% attack for its next turn each time it is hit. ` +
        `Counts hits rather than damage, and is spent the turn after.`
      );
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
    case 'chill':
      return (
        `While this Performer is standing, frosted enemies deal ${p.percent}% less damage per ` +
        `frost stack, up to ${p.max} stacks — ${p.percent * p.max}% at full.`
      );
    case 'frostFervor':
      return `Gains ${p.percent}% attack for the rest of the turn each time frost lands on an enemy.`;
    case 'freeCastOnFreeze':
      return `Whenever an enemy freezes, the next ${p.ability} costs any single die.`;
    case 'exploitCold':
      return (
        `Deals ${p.frosted}% more damage to frosted enemies, and ${p.frozen}% more to frozen ones.`
      );
    case 'dormant':
      return `Takes ${p.percent}% less damage while asleep.`;
    case 'rimeguard': {
      const bits = [];
      if (p.turns) bits.push(`reactive guards last ${p.turns} turn${p.turns === 1 ? '' : 's'} longer`);
      if (p.onHit) bits.push(`while one is up, attacks apply ${p.onHit} frost`);
      if (p.riposte) bits.push(`and it applies ${p.riposte} extra frost when struck`);
      return `${cap(bits.join(', '))}.`;
    }
    case 'extraDie':
      // Says WHILE IT LIVES, because that is the whole counterplay: the pool is
      // rebuilt every turn from who is still standing, so the die goes the turn
      // after its owner does.
      return `While this Performer is standing, the party rolls one extra die — ${describeDie(p.die)}.`;
  }
}

/** How an enemy decides to use this ability. */
export function describeEnemyUsage(a: Ability): string | null {
  const bits: string[] = [];
  if (a.telegraph) bits.push(`announced ${a.telegraph} turn ahead, then lands`);
  if (a.cooldown) bits.push(`${a.cooldown}-turn cooldown`);
  return bits.length > 0 ? cap(bits.join(' · ')) : null;
}
