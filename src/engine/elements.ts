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

/** The element this one deals bonus damage to. */
export const strongAgainst = (e: Element): Element => BEATS[e];

/** The element that deals bonus damage to this one. */
export const weakTo = (e: Element): Element =>
  (Object.keys(BEATS) as Element[]).find((k) => BEATS[k] === e)!;

export function elementMultiplier(attacker: Element, defender: Element): number {
  if (BEATS[attacker] === defender) return STRONG;
  if (BEATS[defender] === attacker) return WEAK;
  return 1;
}

export function matchupLabel(attacker: Element, defender: Element): string {
  const m = elementMultiplier(attacker, defender);
  if (m === STRONG) return 'STRONG';
  if (m === WEAK) return 'resisted';
  return '';
}
