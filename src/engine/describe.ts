import { describeDie } from './dice.ts';
import type { Ability, Effect, ModStat, Passive, VersusPower } from './types.ts';
import { cooldownOf } from './types.ts';
import { DEFAULT_MODIFIER_TURNS } from './combat.ts';
import { splitPower } from './battle.ts';
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
  // A summon aims at nobody -- it puts a body on the board. `self` is the
  // honest reading of that and keeps the pronoun machinery below working.
  switch (fx.do === 'summon' || fx.do === 'encore' ? 'self' : (fx.on ?? 'target')) {
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
      /*
       * A multi-hit says so, and says how it divides.
       *
       * The total is what the sheet leads with, because that is the number a
       * player compares against every other ability. How it splits comes after,
       * and only when it is uneven -- "six hits" already tells you an even
       * volley divides evenly, while "50/50/100" is the whole point of an
       * uneven one and cannot be inferred.
       */
      const hits = fx.hits?.length && fx.hits.length > 1 ? fx.hits : null;
      const split = hits
        ? (() => {
            const shares = splitPower(fx.power, hits);
            const even = shares.every((v) => Math.abs(v - shares[0]!) < 1e-9);
            return even
              ? `, over ${hits.length} hits`
              : `, over ${hits.length} hits of ${shares.map((v) => pct(v)).join(' / ')}`;
          })()
        : '';
      return (
        `deals ${pct(fx.power)} of ATK as ${kind} damage to ${name}${split}` +
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
    // No "if there is room". The fizzle is a fact about the board at the
    // moment it fires, not about the ability, and a rules line that hedges
    // every sentence with its own failure case stops being readable.
    case 'summon':
      return fx.of
        ? `calls a ${fx.of.replace(/_/g, ' ')} into the formation`
        : 'calls another of itself into the formation';
    // Says what it DOES rather than what it costs the player, because the cost
    // is the board: how hard this lands is how many of them are still standing,
    // and that number is on screen.
    case 'encore':
      return 'every ally still standing takes its best attack at once, at random targets';
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
    case 'spendRegen':
      return `spends all of ${name === 'the caster' ? 'their' : sameTargetAsPrevious ? who.it : `${who.full}'s`} regen at once, healing it all immediately`;
    case 'ward': {
      // Possessive, not the object form -- `name` becomes "them" on a repeated
      // target and "the damage them take" is what that produces. Same reason
      // `modify` and `resist` reach for `who.it` here.
      const whose = sameTargetAsPrevious ? who.it : `${who.full}'s`;
      return (
        `reduces ${whose} incoming damage by ${fx.percent}% ` +
        `for ${fx.turns} turn${fx.turns === 1 ? '' : 's'}`
      );
    }
    case 'resist': {
      // A pronoun needs the possessive here, not the object form -- "raises
      // them Fire resistance" is what you get from reusing `name` directly.
      const whose = sameTargetAsPrevious ? who.it : `${who.full}'s`;
      return (
        `${fx.percent < 0 ? 'lowers' : 'raises'} ${whose} ${cap(fx.element)} resistance by ` +
        `${Math.abs(fx.percent)}% for ${fx.turns} turn${fx.turns === 1 ? '' : 's'}`
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
      const at = (e: Effect) =>
        e.do === 'summon' || e.do === 'encore' ? 'self' : (e.on ?? 'target');
      const same = prev !== undefined && at(prev) === at(fx);
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
  // The cooldown belongs here, not only on the enemy sheet. It used to appear
  // exclusively in `describeEnemyUsage`, so a player's ultimate stated its
  // cooldown nowhere at all -- the only way to learn an ability was on a timer
  // was to spend three dice and watch it grey out.
  const cd = cooldownOf(a);
  const cool = cd ? ` Then unavailable for ${cd} turn${cd === 1 ? '' : 's'}.` : '';
  return `Spend any dice totalling exactly ${a.cost}.${cool}`;
}

/*
 * =====================================================================
 * SHORT FORM
 * =====================================================================
 *
 * The full rules text is correct and it is too long to scan. Perfect Form reads
 * "Raises the caster's ATK, P.DEF and M.DEF by 20% of their own base stats for
 * 3 turns, then deals 200% of ATK as physical damage to one enemy in the first
 * two ranks, over 6 hits" -- which is what you want when you are deciding, and
 * not what you want when you are looking along a list of four abilities trying
 * to remember which one is the big hit.
 *
 * So: a **magnitude word and a shape**, and no numbers at all. "Raises its own
 * stats and deals high physical damage to one enemy." The exact figures live in
 * the detail modal, which is where somebody who wants them will go.
 *
 * Bands rather than numbers is the whole idea. A player cannot tell whether
 * 110% is a lot without knowing the roster; "moderate" is a claim they can
 * check against the other three abilities on the same sheet, which is the only
 * comparison they are actually making.
 */

/**
 * Damage bands, as a multiple of ATK.
 *
 * Cut against the real spread. Every damaging ability in the game sits between
 * 0.5 and 2.2, and the clusters are genuine: chip attacks and area spells at
 * 0.6-0.8, ordinary strikes at 0.9-1.15, the expensive single-target ones at
 * 1.3-1.6, and ultimates at 2.0+.
 *
 * Area abilities are NOT discounted for hitting more. Blizzard at 60% to five
 * creatures is more total damage than Sunder at 110% to one, but the word is
 * describing what a single body takes -- which is the thing a player is reading
 * it to find out, and the scope is stated in the same sentence anyway.
 */
const DAMAGE_BANDS: [number, string][] = [
  [2.25, 'extreme'],
  [1.5, 'high'],
  [0.8, 'moderate'],
  [0, 'minor'],
];

/** Percentage bands, for buffs, shreds, wards and resistances. */
const PERCENT_BANDS: [number, string][] = [
  [50, 'extreme'],
  [30, 'high'],
  [15, 'moderate'],
  [0, 'minor'],
];

const band = (bands: [number, string][], value: number): string =>
  bands.find(([at]) => Math.abs(value) >= at)?.[1] ?? 'minor';

/** "one enemy", "all enemies", "the party" -- shape only, no ranks. */
function shortTarget(a: Ability, fx: Effect): string {
  const at = fx.do === 'summon' || fx.do === 'encore' ? 'self' : (fx.on ?? 'target');
  if (at === 'self') return 'itself';
  if (at === 'allies') return 'the party';
  const scope = a.scope ?? 'one';
  const many = scope === 'all' || scope === 'column' || scope === 'row';
  if (a.kind === 'attack' && many) return 'all enemies';
  if (many) return 'the party';
  return a.kind === 'attack' ? 'one enemy' : 'one ally';
}

/** "a moderate" / "an extreme" -- the one place this text needs an article. */
const an = (word: string): string => (/^[aeiou]/.test(word) ? `an ${word}` : `a ${word}`);

/** One effect, in as few words as it takes to know what kind of thing it is. */
function shortEffect(a: Ability, fx: Effect, same: boolean): string | null {
  /*
   * Naming the same body twice reads as two things happening to two creatures.
   * The full text solves this with `sameTargetAsPrevious`; so does this.
   *
   * The pronoun has to agree in NUMBER, which the first pass did not: Blizzard
   * came out "deals damage to all enemies and applies 1 frost to it".
   */
  const full = shortTarget(a, fx);
  const plural = full === 'all enemies' || full === 'the party';
  const who = !same ? full : full === 'itself' ? 'itself' : plural ? 'them' : 'it';
  const whose =
    who === 'itself' ? 'its own' : who === 'them' ? 'their' : who === 'it' ? 'its' : `${who}'s`;
  switch (fx.do) {
    case 'damage': {
      const kind = fx.damageType ?? a.damageType ?? 'physical';
      const el = fx.element ?? a.element;
      return `deals ${band(DAMAGE_BANDS, fx.power)} ${el ? `${el} ` : ''}${kind} damage to ${who}`;
    }
    case 'modify': {
      const up = fx.percent >= 0;
      const what = fx.stats.length > 1 ? 'stats' : statWord(fx.stats[0]!);
      return `${up ? 'raises' : 'lowers'} ${whose} ${what} by ${an(band(PERCENT_BANDS, fx.percent))} amount`;
    }
    // Banded like DAMAGE, not like a percentage: a heal's power is a multiple
    // of ATK exactly as an attack's is, and running it through the percentage
    // bands called Poultice's 0.7 "extreme".
    case 'heal':
      return `heals ${who} for ${an(band(DAMAGE_BANDS, fx.power))} amount`;
    case 'frost':
      return `applies ${fx.stacks} frost to ${who}`;
    case 'regen':
      return `grants ${who} regeneration`;
    case 'ward':
      return `reduces ${whose} incoming damage`;
    case 'resist':
      return `raises ${whose} ${fx.element} resistance`;
    case 'sleep':
      return `puts ${who} to sleep`;
    case 'taunt':
      return `taunts ${who}`;
    case 'spendRegen':
      return `cashes in ${whose} regeneration at once`;
    case 'summon':
      return 'calls in reinforcements';
    case 'encore':
      return 'makes every ally act at once';
    // Movement says nothing worth compressing -- the full line is already
    // three words -- and returning null drops it from the summary entirely.
    case 'move':
    case 'reposition':
      return null;
  }
}

const statWord = (s: ModStat): string =>
  s === 'attack' ? 'ATK' : s === 'physicalDefense' ? 'P.DEF' : 'M.DEF';

/**
 * The whole ability in one line, with words where the numbers were.
 *
 * Falls back to the full text for an ability with no `effects` list, which is
 * the legacy authoring shape -- those carry a bare `power` and nothing to
 * summarise from.
 */
export function describeShort(a: Ability): string {
  /*
   * A bare `power` is synthesised into the damage effect it is equivalent to,
   * the same way `applyAbility` does it.
   *
   * Falling back to the full text here looked harmless and was not: enemies are
   * authored the legacy way, so every creature in the game -- the things a
   * player most wants a one-line read on -- got the long form instead.
   */
  const own: Effect[] | null =
    a.effects ??
    (a.kind === 'attack'
      ? [{ do: 'damage', power: a.power, damageType: a.damageType, element: a.element }]
      : null);
  if (!own) return describeAbility(a);
  const at = (e: Effect) => (e.do === 'summon' || e.do === 'encore' ? 'self' : (e.on ?? 'target'));
  const parts = own
    .map((fx, i) => shortEffect(a, fx, i > 0 && at(own[i - 1]!) === at(fx)))
    .filter((x): x is string => !!x);
  if (parts.length === 0) return describeAbility(a);
  const joined =
    parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return `${cap(joined)}.`;
}

/**
 * What the chain adds, in the same register.
 *
 * Reuses the authored `trigger.text` rather than trying to summarise it: those
 * were rewritten to be concrete and short already ("Reduces its P.DEF by 40%
 * instead of 25%"), and a summary of a sentence that is already one clause is
 * just a worse copy of it.
 */
export function describeShortChain(a: Ability): string | null {
  return a.trigger ? `${a.trigger.text}.` : null;
}

/** Rules text for an always-on effect. */
export function describePassive(p: Passive): string {
  switch (p.kind) {
    case 'counter':
      return (
        `Strikes back for ${p.percent}% of its ATK at anyone who attacks one of its allies. ` +
        `Single-target attacks only, once per action, and never for an attack that lands on it too.`
      );
    case 'adapt':
      return (
        `Each attack that deals it elemental damage raises its resistance to that element by ` +
        `${p.percent}%, up to ${p.max}%. Physical damage carries no element and teaches it nothing.`
      );
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
    case 'mend': {
      const reach = p.targets ?? 1;
      const who = reach === 1 ? 'the most wounded ally' : `the ${reach} most wounded allies`;
      // A tier that only widens the reach carries no percentage of its own, and
      // "heals for 0% of ATK" is a worse lie than saying what it actually adds.
      if (p.percent === 0) return `Tends ${who} instead of one.`;
      return `Heals ${who} for ${p.percent}% of ATK at the start of each of its turns.`;
    }
    case 'regenGuard':
      return `While this Performer is standing, allies carrying regen take ${p.percent}% less damage.`;
    case 'deeproot':
      return `While this Performer is standing, every regen charge restores ${p.percent}% more of its holder's max HP.`;
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
  /*
   * Priority first, because it OVERRIDES the band printed beside it.
   *
   * A scheduled ability is chosen the moment its cooldown is up, whatever the
   * d20 says -- so a card showing "18-20" and nothing else is not merely
   * incomplete, it is wrong about the one thing the fight is built around. The
   * False Lead's Encore is a deadline, and a deadline the player reads as a
   * 15% chance is not a deadline.
   */
  if ((a.priority ?? 0) > 0) bits.push('used the moment it is available, whatever the roll');
  if (a.telegraph) bits.push(`announced ${a.telegraph} turn ahead, then lands`);
  const cd = cooldownOf(a);
  if (cd) bits.push(`${cd}-turn cooldown`);
  return bits.length > 0 ? cap(bits.join(' · ')) : null;
}
