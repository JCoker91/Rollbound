import type { Element } from './types.ts';

/** Attacker's element -> the element it is strong against. */
const BEATS: Record<Element, Element> = {
  fire: 'wind',
  wind: 'earth',
  earth: 'water',
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
