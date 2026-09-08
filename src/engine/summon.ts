import type { CharacterDef, Rarity } from './types.ts';

/**
 * Summoning.
 *
 * Rates live here as data rather than being buried in the UI, so they can be
 * displayed to the player verbatim -- a gacha that shows its real numbers is
 * both fairer and easier to balance, since the tuning knob and the disclosure
 * are the same value.
 */

export const SUMMON_COST = 30;
/** A ten-pull costs nine, the usual bulk discount. */
export const MULTI_COUNT = 10;
export const MULTI_COST = SUMMON_COST * 9;

export const RATES: Record<Rarity, number> = {
  3: 0.04,
  2: 0.26,
  1: 0.7,
};

export interface PullResult {
  def: CharacterDef;
  /** True when this is the first copy -- a genuinely new character. */
  isNew: boolean;
  /** Copies held after this pull. */
  copies: number;
}

function pickRarity(roll: number): Rarity {
  if (roll < RATES[3]) return 3;
  if (roll < RATES[3] + RATES[2]) return 2;
  return 1;
}

/**
 * Roll `count` characters against the rate table.
 *
 * `owned` is read and returned updated rather than mutated, so the caller
 * decides when the result becomes real -- the UI reveals pulls one at a time.
 */
export function summon(
  pool: CharacterDef[],
  owned: Record<string, number>,
  count: number,
  rng: () => number = Math.random,
): { results: PullResult[]; owned: Record<string, number> } {
  const next = { ...owned };
  const results: PullResult[] = [];

  for (let i = 0; i < count; i++) {
    const rarity = pickRarity(rng());
    // Fall back to the whole pool if a rarity has no characters defined yet,
    // so adding a tier of content later cannot break summoning today.
    const tier = pool.filter((d) => d.rarity === rarity);
    const bucket = tier.length > 0 ? tier : pool;
    const def = bucket[Math.floor(rng() * bucket.length)]!;

    const before = next[def.id] ?? 0;
    next[def.id] = before + 1;
    results.push({ def, isNew: before === 0, copies: before + 1 });
  }

  return { results, owned: next };
}
