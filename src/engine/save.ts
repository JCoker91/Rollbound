import { newProfile, type Profile } from './idle.ts';

/**
 * Local persistence.
 *
 * This is a placeholder with a known weakness: everything here is client-side,
 * so the numbers are trivially editable and the clock is the player's own. That
 * is fine for a game played with friends, and the shape is deliberately chosen
 * so the swap is small later -- `load` and `save` become a fetch, and the server
 * supplies `now` and recomputes accrual itself rather than trusting a claim.
 */

const KEY = 'stagebound:profile:v1';
/**
 * Keys the game shipped under before, newest first. Read as a fallback so a
 * rename does not silently wipe every existing save; the next `save()` writes
 * to the current key and the old ones are simply abandoned.
 *
 * Safe to drop an entry once nobody could still be carrying that profile.
 */
const LEGACY_KEYS = ['rollbound:profile:v1', 'dice-legends:profile:v1'];

export function load(nowMs: number, starters: string[]): Profile {
  try {
    const raw = LEGACY_KEYS.reduce<string | null>((found, k) => found ?? localStorage.getItem(k), localStorage.getItem(KEY));
    if (!raw) return newProfile(nowMs, starters);

    const parsed = JSON.parse(raw) as Partial<Profile>;
    if (parsed.version !== 1) return newProfile(nowMs, starters);

    // Repair rather than reject: a save missing a field should not wipe progress.
    const base = newProfile(nowMs, starters);
    return {
      ...base,
      ...parsed,
      version: 1,
      owned: { ...base.owned, ...(parsed.owned ?? {}) },
      stars: parsed.stars ?? {},
      levels: parsed.levels ?? {},
      lastTickAt: typeof parsed.lastTickAt === 'number' ? parsed.lastTickAt : nowMs,
    };
  } catch {
    // Corrupt or unavailable storage (private windows throw) -- start fresh
    // rather than crashing into a blank screen.
    return newProfile(nowMs, starters);
  }
}

export function save(profile: Profile): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(profile));
  } catch {
    // Nothing useful to do; losing a save beats taking the game down.
  }
}

export function wipe(): void {
  try {
    localStorage.removeItem(KEY);
    // Every key, or Reset would leave a pre-rename save behind for `load` to
    // find and the wiped progress would reappear on the next visit.
    for (const k of LEGACY_KEYS) localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}
