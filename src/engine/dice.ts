import type { Ability, Die, DieSpec } from './types.ts';
import type { Rng } from './rng.ts';

/**
 * The dice pool.
 *
 * Dice used to be a `number[]` with a parallel `boolean[]` of what had been
 * spent. That was enough while the pool was five identical d6 rolled once a
 * turn and never touched again, and it stops being enough the moment anything
 * can change it: a Performer who contributes a sixth die, an ability that
 * doubles a die's value to reach a cost nobody rolled, a curse that blanks one.
 *
 * So a die is a thing with an identity. Three consequences are worth stating,
 * because they are what the rest of the engine relies on:
 *
 *  - **Dice are named by `id`, never by index.** Two parallel arrays and a
 *    stored index are the same bug waiting in two places; an id survives the
 *    pool being added to, reordered or thinned.
 *  - **A blank (`value === 0`) is not a small die, it is an absent one.** It
 *    can never be spent, on a wildcard or on a sum, and `payingMasks` will not
 *    return a mask that touches one.
 *  - **`rolled` is kept alongside `value`.** An ability that changes a die has
 *    to be visible as having changed it, or the pool just quietly shows a
 *    different number than the one that was rolled.
 *
 * Bitmasks are still how subsets are searched -- they are the right shape for
 * "every subset summing to exactly 7" -- but they are computed fresh against
 * the current pool and converted to ids before anything stores them.
 */

/** The die everyone rolls. Five of these are the base pool. */
export const STANDARD_D6: DieSpec = {
  id: 'd6',
  faces: [1, 2, 3, 4, 5, 6],
  label: 'd6',
};

/** A die to put in the pool, and who is providing it. */
export interface DieEntry {
  spec: DieSpec;
  source?: string;
}

/**
 * Roll a fresh pool.
 *
 * Ids are positional at roll time (`d6#0`) and then never re-derived, so they
 * stay stable for the life of the pool however it is altered afterwards.
 */
export function rollPool(entries: DieEntry[], rng: Rng): Die[] {
  return entries.map(({ spec, source }, i) => {
    const face = spec.faces[rng.int(0, spec.faces.length - 1)] ?? 0;
    return {
      id: `${spec.id}#${i}`,
      spec,
      value: face,
      rolled: face,
      spent: false,
      ...(source ? { source } : {}),
    };
  });
}

/** Can this die still pay for something? */
export const usable = (d: Die): boolean => !d.spent && d.value > 0;

/** True once something has changed this die since it was rolled. */
export const altered = (d: Die): boolean => d.value !== d.rolled;

export const unspent = (pool: Die[]): Die[] => pool.filter(usable);

export const sumOf = (dice: Die[]): number => dice.reduce((n, d) => n + d.value, 0);

/** The dice these ids name, in pool order, skipping any that have gone. */
export const byIds = (pool: Die[], ids: string[]): Die[] =>
  pool.filter((d) => ids.includes(d.id));

export function countBits(mask: number): number {
  let c = 0;
  while (mask) {
    mask &= mask - 1;
    c++;
  }
  return c;
}

/**
 * Every subset of the pool that exactly pays for `ability`, as bitmasks.
 *
 * Blanks and already-spent dice are excluded here rather than by each caller.
 * They were filtered in three places and missed in a fourth, and "a mask may
 * only name dice you can actually spend" is a property of the pool rather than
 * of whoever is asking.
 */
/**
 * Does this ability cost a single die for this caster right now?
 *
 * The one place that knows, because the answer stopped being a property of the
 * ability alone the moment a charge could grant it -- and two implementations
 * of "is this a wildcard" would drift the first time the rule moved. Callers
 * with no unit in hand pass nothing and get the sheet's own answer.
 */
export function paysAsWildcard(ability: Ability, freeCast?: string | null): boolean {
  return !!ability.wildcard || (!!freeCast && freeCast === ability.name);
}

export function payingMasks(pool: Die[], ability: Ability, freeCast?: string | null): number[] {
  const out: number[] = [];
  for (let mask = 1; mask < 1 << pool.length; mask++) {
    let sum = 0;
    let count = 0;
    let legal = true;
    for (let i = 0; i < pool.length; i++) {
      if (!(mask & (1 << i))) continue;
      const die = pool[i]!;
      if (!usable(die)) {
        legal = false;
        break;
      }
      sum += die.value;
      count++;
    }
    if (!legal) continue;
    // Wildcards ignore the value entirely and eat exactly one die.
    if (paysAsWildcard(ability, freeCast) ? count === 1 : sum === ability.cost) out.push(mask);
  }
  return out;
}

export function maskToDice(mask: number, pool: Die[]): Die[] {
  const out: Die[] = [];
  for (let i = 0; i < pool.length; i++) if (mask & (1 << i)) out.push(pool[i]!);
  return out;
}

export const maskToIds = (mask: number, pool: Die[]): string[] =>
  maskToDice(mask, pool).map((d) => d.id);

export const idsToMask = (ids: string[], pool: Die[]): number => {
  let mask = 0;
  for (let i = 0; i < pool.length; i++) if (ids.includes(pool[i]!.id)) mask |= 1 << i;
  return mask;
};

// ------------------------------------------------------------------ mutation

/**
 * Change what a die is showing.
 *
 * Floored at zero, which is the blank: nothing may drive a die negative, and a
 * die reduced to nothing is exactly the same object as one that rolled a blank.
 * `rolled` is deliberately untouched -- it is the record of the roll, not a
 * second copy of the current value.
 */
export function setDieValue(die: Die, value: number): void {
  die.value = Math.max(0, Math.round(value));
}

/** Double a die's value. The shape "reach a cost nobody rolled" comes in. */
export function doubleDie(die: Die): void {
  setDieValue(die, die.value * 2);
}

/** Put another die in the pool, rolled now, with an id nothing else holds. */
export function addDie(pool: Die[], entry: DieEntry, rng: Rng): Die {
  let n = pool.length;
  while (pool.some((d) => d.id === `${entry.spec.id}#${n}`)) n++;
  const face = entry.spec.faces[rng.int(0, entry.spec.faces.length - 1)] ?? 0;
  const die: Die = {
    id: `${entry.spec.id}#${n}`,
    spec: entry.spec,
    value: face,
    rolled: face,
    spent: false,
    ...(entry.source ? { source: entry.source } : {}),
  };
  pool.push(die);
  return die;
}

// --------------------------------------------------------------- description

/** How many faces of this die are blank. */
export const blankFaces = (spec: DieSpec): number => spec.faces.filter((f) => f === 0).length;

/**
 * A die's faces in words, for a tooltip.
 *
 * Says the blanks first because they are the interesting half: a player reading
 * "1-3" on a die that is dead three times in six has been told the wrong thing.
 */
export function describeDie(spec: DieSpec): string {
  const blanks = blankFaces(spec);
  const live = spec.faces.filter((f) => f > 0);
  const lo = Math.min(...live);
  const hi = Math.max(...live);
  const range = live.length === 0 ? 'nothing' : lo === hi ? `${lo}` : `${lo}–${hi}`;
  return blanks === 0
    ? `${spec.faces.length} faces, ${range}`
    : `${spec.faces.length} faces — ${blanks} blank, the rest ${range}`;
}
