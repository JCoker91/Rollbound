import { samePos } from '../engine/formation.ts';
import type { Ability, Element, Pos, Side, Unit } from '../engine/types.ts';

/**
 * What the battle SAYS and how its numbers are coloured.
 *
 * Both are pure mappings with a wrong answer available for every input --
 * a sentence that reads "on undefined", an element that falls through to the
 * default red -- and stepping a fight in a browser to read them off the
 * screen one at a time is not a way to find that out. They live here, apart
 * from the component, so a test can call them directly.
 */

export interface Floater {
  id: number;
  amount: number;
  kind: 'damage' | 'heal';
  at: Pos;
  /**
   * Which way this number is thrown, as a fraction of a small arc.
   *
   * A multi-hit puts six numbers on one target within a second, and before this
   * they all rose from the same pixel in the same direction -- six labels
   * stacked one behind another, which reads as one number flickering rather
   * than as six blows. Scattering them turns the volley into something you can
   * count at a glance.
   *
   * Assigned where the floater is made rather than rolled in the renderer,
   * because a render can happen many times for one floater and the number must
   * not jump between frames.
   */
  spray: { x: number; rise: number; tilt: number };
  /**
   * Whose board `at` is a coordinate ON.
   *
   * Both sides use column 2 -- the party's front rank and the enemy's are the
   * same number -- so a position alone does not say where on the stage it is.
   * Every lookup from a `Pos` to a draw position needs the side with it.
   */
  side: Side;
  /** Colours the number. Absent for physical hits, healing and thorns. */
  element?: Element;
  /** Draws it big with a CRIT flag over it. */
  crit?: boolean;
}

/**
 * "Benjamin uses Cross Slash on Red Understudy!"
 *
 * The target is looked up among ALL units rather than the living ones, because
 * by the time an action has resolved its target may be down -- and the line
 * that says who was hit is exactly the line you want when they die to it.
 *
 * Scope decides the phrasing: naming a slot for an ability that hit five
 * creatures, or naming yourself for a self-buff, both read as bugs.
 *
 * Pure, and outside the component, so it can be tested without a battle
 * running -- the sentences are the feature, and stepping a fight in a browser
 * to read them is a poor way to find out one of them says "on undefined".
 */
export function actionLine(
  actor: Unit,
  ability: Ability | null | undefined,
  target: Pos | undefined,
  units: Unit[],
): string {
  if (!ability) return `${actor.def.name} takes a bow — a new flourish!`;

  const theirs = actor.side === 'player' ? 'the enemy line' : 'your party';
  const ours = actor.side === 'player' ? 'your party' : 'the enemy line';

  switch (ability.scope ?? 'one') {
    case 'self':
      return `${actor.def.name} uses ${ability.name}!`;
    case 'all':
      return `${actor.def.name} uses ${ability.name} on ${ability.kind === 'attack' ? theirs : ours}!`;
    default: {
      const hit = target && units.find((u) => samePos(u.pos, target));
      return hit
        ? `${actor.def.name} uses ${ability.name} on ${hit.def.name}!`
        : `${actor.def.name} uses ${ability.name}!`;
    }
  }
}

/**
 * The classes that colour and size one floating number.
 *
 * Split out for the same reason as `actionLine`: it is a mapping with a wrong
 * answer for every element, and reading them off a screen one battle at a time
 * is not a test.
 */
export function floaterClass(f: Pick<Floater, 'kind' | 'element' | 'crit'>): string {
  return `floater ${f.kind}${f.element ? ` el-${f.element}` : ''}${f.crit ? ' crit' : ''}`;
}


/** One ability's worth of live modifiers on a unit, ready to render. */
export interface ModGroup {
  /** The ability that applied them, which is also their identity for refresh. */
  ability: string;
  /** `ATK +21`, `P.DEF −12`, `fire res +25%` -- already signed and labelled. */
  parts: string[];
  /** Turns left. One number per group, because one cast sets one clock. */
  turns: number;
  /** Whether this helps its holder. Mixed groups count as a buff if any part is. */
  good: boolean;
}

const MOD_LABEL: Record<string, string> = {
  attack: 'ATK',
  physicalDefense: 'P.DEF',
  magicalDefense: 'M.DEF',
};

/**
 * A unit's live modifiers, grouped the way the engine stores them.
 *
 * Grouped by ABILITY rather than listed flat because that is the unit the rules
 * work in: one cast of Rally is one thing with one clock that happens to move
 * three stats, and printing it as three rows of "+21, 3 turns" invites reading
 * it as three separate buffs that might expire apart. They cannot.
 *
 * Signed with a real minus (U+2212) rather than a hyphen, because these sit
 * next to numbers and a hyphen at small sizes reads as punctuation.
 *
 * An element key is a resistance in percentage POINTS, not a stat amount -- the
 * one place `Modifier.amount` changes meaning -- so it is labelled differently
 * and carries its own sign convention: positive resistance is good.
 */
export function modifierGroups(unit: Unit): ModGroup[] {
  const out: ModGroup[] = [];
  for (const m of unit.modifiers) {
    const sign = m.amount < 0 ? '−' : '+';
    const mag = Math.abs(m.amount);
    const stat = MOD_LABEL[m.stat as string];
    const part = stat ? `${stat} ${sign}${mag}` : `${m.stat} res ${sign}${mag}%`;
    const found = out.find((g) => g.ability === m.ability);
    if (found) {
      found.parts.push(part);
      found.good ||= m.amount > 0;
      // The longest clock in the group. They are set together by one cast, so
      // this is a tie in practice -- but a group whose parts disagreed would
      // be better described by the one still standing than by the one gone.
      found.turns = Math.max(found.turns, m.turns);
    } else {
      out.push({ ability: m.ability, parts: [part], turns: m.turns, good: m.amount > 0 });
    }
  }
  return out;
}

/**
 * How badly hurt somebody is, in three bands.
 *
 * A fraction is a number you have to do arithmetic on; a colour is something
 * you read while looking at something else, which is the only way health is
 * ever actually read mid-turn. Three bands rather than a gradient because the
 * decisions they feed are discrete -- heal now, heal soon, or get on with it --
 * and a continuous ramp makes 41% and 44% look like different answers.
 *
 * Boundaries are inclusive upward: exactly half health is still `well`, exactly
 * a quarter is still `hurt`. A band should not flip on the hit that takes you
 * TO its edge, only on the one that takes you past it.
 */
export function healthBand(hp: number, max: number): 'well' | 'hurt' | 'dying' {
  if (max <= 0) return 'dying';
  const share = hp / max;
  return share >= 0.5 ? 'well' : share >= 0.25 ? 'hurt' : 'dying';
}
