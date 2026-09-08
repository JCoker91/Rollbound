/**
 * Idle accrual.
 *
 * Deliberately pure and time-agnostic: every function takes "now" as an argument
 * rather than reading the clock. That keeps it testable, and means the exact same
 * code can run on a server later, where the timestamp is the one thing a client
 * must never be trusted with. Today the caller passes Date.now(); tomorrow it
 * passes a value the server handed back.
 */

import type { StarProgress } from './stars.ts';

export interface Profile {
  version: 1;
  gold: number;
  /** Summon currency. */
  shards: number;
  /** Shared experience pool, spent levelling whichever character you choose. */
  xp: number;
  /** Highest stage cleared. Drives the accrual rate. */
  stage: number;
  /** Epoch ms of the last time rewards were banked. */
  lastTickAt: number;
  /**
   * characterId -> how many copies pulled, ever. The first copy unlocks them and
   * the rest are duplicates available to spend on stars. Kept as a total rather
   * than a spendable balance so spares can always be re-derived from it.
   */
  owned: Record<string, number>;
  /** characterId -> star level and the node chosen at each rung. */
  stars: Record<string, StarProgress>;
  /** characterId -> level. Absent means level 1. */
  levels: Record<string, number>;
}

export interface Rates {
  goldPerMin: number;
  shardsPerMin: number;
  xpPerMin: number;
}

/**
 * Offline earnings stop here. Idle games cap accrual so that checking in daily
 * is rewarded but disappearing for a month is not a jackpot.
 */
export const MAX_OFFLINE_HOURS = 8;

export function ratesFor(stage: number): Rates {
  return {
    goldPerMin: 20 + stage * 12,
    shardsPerMin: 0.4 + stage * 0.2,
    xpPerMin: 45 + stage * 30,
  };
}

export interface Accrued {
  gold: number;
  shards: number;
  xp: number;
  /** Seconds actually credited, after the offline cap. */
  seconds: number;
  /** True when the cap trimmed the elapsed time. */
  capped: boolean;
}

/** What has piled up since `profile.lastTickAt`, without banking it. */
export function accrued(profile: Profile, nowMs: number): Accrued {
  const elapsed = Math.max(0, (nowMs - profile.lastTickAt) / 1000);
  const cap = MAX_OFFLINE_HOURS * 3600;
  const seconds = Math.min(elapsed, cap);
  const rates = ratesFor(profile.stage);

  return {
    gold: Math.floor((rates.goldPerMin * seconds) / 60),
    shards: Math.floor((rates.shardsPerMin * seconds) / 60),
    xp: Math.floor((rates.xpPerMin * seconds) / 60),
    seconds,
    capped: elapsed > cap,
  };
}

/** Bank whatever has accrued and reset the clock. Returns the amounts credited. */
export function claim(profile: Profile, nowMs: number): { profile: Profile; gained: Accrued } {
  const gained = accrued(profile, nowMs);
  return {
    profile: {
      ...profile,
      gold: profile.gold + gained.gold,
      shards: profile.shards + gained.shards,
      xp: profile.xp + gained.xp,
      lastTickAt: nowMs,
    },
    gained,
  };
}

export function newProfile(nowMs: number, starters: string[]): Profile {
  return {
    version: 1,
    gold: 500,
    shards: 60,
    xp: 400,
    stage: 1,
    lastTickAt: nowMs,
    owned: Object.fromEntries(starters.map((id) => [id, 1])),
    stars: {},
    levels: {},
  };
}

/** Short human form for big numbers: 1.2K, 3.4M. */
export function short(n: number): string {
  if (n < 1000) return String(Math.floor(n));
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** "2h 14m" / "45s" -- for offline time and event countdowns. */
export function duration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}
