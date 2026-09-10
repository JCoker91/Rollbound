import type { Element } from './types.ts';

/**
 * Attacker's element -> the element it is strong against.
 *
 * A five-element cycle, plus light and dark as a mutual pair outside it:
 *
 *     fire -> wind -> earth -> lightning -> water -> fire
 *
 * Every element in the cycle beats exactly one and loses to exactly one, so a
 * five-enemy encounter built from it has no dead matchups.
 *
 * Lightning was slotted in rather than bolted on. It arrived with the elemental
 * Understudies, and only one existing edge had to move: earth used to beat
 * water, and now grounds lightning instead, with lightning conducting into
 * water. Both of those read without explanation, which is the test a matchup
 * wheel has to pass -- a player should be able to guess it.
 */
const BEATS: Record<Element, Element> = {
  fire: 'wind',
  wind: 'earth',
  earth: 'lightning',
  lightning: 'water',
  water: 'fire',
  light: 'dark',
  dark: 'light',
};

export const STRONG = 1.5;
export const WEAK = 0.75;

/**
 * The wheel expressed as resistance percentages, which is what the damage
 * formula actually consumes.
 *
 * These are the same 1.5x and 0.75x as before, restated: taking 50% extra is
 * -50 resistance, taking 25% less is +25. Keeping the wheel as the source of
 * DEFAULTS rather than deleting it is deliberate -- resistance as a free-form
 * per-enemy number is more expressive but not guessable, and a player who has
 * to look up every matchup has lost the thing the wheel was for.
 */
export const WEAK_RESIST = -50;
export const STRONG_RESIST = 25;

/**
 * The resistance spread of a creature aligned to one element.
 *
 * This is the wheel, restated as a reusable profile rather than as a property
 * of the creature. Nothing IS a fire creature any more -- a stat block declares
 * `resistances: aligned('fire')` and gets the familiar spread, or writes its
 * own numbers, or mixes the two.
 *
 * Keeping it is what preserves guessability. Free-form per-enemy resistances
 * are more expressive but not predictable, and a player who has to read five
 * tooltips before every fight has lost what the wheel was for. A profile gives
 * the common case one line and leaves every exception open.
 */
export function aligned(element: Element): Partial<Record<Element, number>> {
  return {
    [weakTo(element)]: WEAK_RESIST,
    [strongAgainst(element)]: STRONG_RESIST,
  };
}

/**
 * How much of `element` this defender shrugs off, in percent.
 *
 * Reads only the sheet. There is no longer a defender element to fall back on,
 * which is the point: an unlisted element is simply neutral, and a creature can
 * be weak to two things, resistant to everything, or aligned to nothing at all.
 */
export function resistanceOf(
  attackElement: Element | undefined,
  resistances?: Partial<Record<Element, number>>,
): number {
  // No element means the elemental layer is not consulted at all, which is the
  // same number as "resisted by nothing" but a different statement.
  if (!attackElement) return 0;
  return resistances?.[attackElement] ?? 0;
}

/**
 * Resistance capped before it is applied.
 *
 * `1 - r/100` reaches ZERO at 100 and goes negative above it, so an uncapped
 * additive stat turns two stacked buffs into immunity and three into healing
 * from the element. The ceiling is what makes "+40% fire resistance for three
 * turns" safe to author freely.
 *
 * The floor is far less dangerous -- vulnerability grows linearly, so even -200
 * is merely triple damage -- but it is bounded too so a debuff stack cannot
 * produce absurd one-shots.
 */
export const RESIST_CAP = 100;
export const RESIST_FLOOR = -200;

/**
 * The ceiling is 100 -- genuine immunity -- and not the 80 first proposed.
 *
 * 80 was chosen so stacked buffs could never reach immunity. Then a boss turned
 * up whose entire identity is being immune to one element per turn, and a
 * ceiling that forbids the thing a boss is FOR is the wrong ceiling. The real
 * hazard the cap guards against is not immunity but a NEGATIVE multiplier --
 * resistance above 100 would have an attack heal its target -- and clamping the
 * multiplier at zero prevents that at any resistance value.
 *
 * What 80 protected is now a content rule rather than a formula one: do not
 * author resistance buffs that stack to 100. That is a balance decision, and
 * burying it in a clamp only hid it.
 */
export const resistMultiplier = (resist: number): number =>
  Math.max(0, 1 - Math.max(RESIST_FLOOR, Math.min(RESIST_CAP, resist)) / 100);

/** The element this one deals bonus damage to. */
export const strongAgainst = (e: Element): Element => BEATS[e];

/** The element that deals bonus damage to this one. */
export const weakTo = (e: Element): Element =>
  (Object.keys(BEATS) as Element[]).find((k) => BEATS[k] === e)!;

/**
 * What the log calls a hit, from the resistance actually applied.
 *
 * Derived from the number rather than from the wheel, so a creature with an
 * explicit resistance is labelled by what happened to it and not by what its
 * element would normally imply. A label that disagrees with the damage beside
 * it is worse than no label.
 */
export function matchupLabel(resist: number): string {
  if (resist <= WEAK_RESIST) return 'STRONG';
  if (resist < 0) return 'strong';
  if (resist >= RESIST_CAP) return 'IMMUNE';
  if (resist >= 60) return 'nearly immune';
  if (resist >= STRONG_RESIST) return 'resisted';
  if (resist > 0) return 'partly resisted';
  return '';
}
