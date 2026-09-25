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
  /**
   * itemId -> how many are held. See `items.ts`.
   *
   * A bounty token is a quantity of TIME rather than of currency: it pays the
   * idle rate for its duration, at the rate in force when it is spent. Kept as
   * a plain count because there is nothing else to know about one.
   */
  items: Record<string, number>;
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
    /*
     * Measured against what ONE FULL COLLECT is worth, which is the only
     * question an idle rate has to answer.
     *
     * At `45 + stage * 30` an eight-hour collect at stage 3 took five
     * characters from level 1 to **14** -- the whole of Act 1's requirement,
     * overnight, from a profile two stages old. Every gate in the game is then
     * answered by going to bed, which is not a loop, it is a timer with a
     * battle screen attached.
     *
     * At `12 + stage * 4` the same collect takes a party arriving at the
     * stage-10 boss on level 9 up to **12** -- enough to change the fight,
     * short of the 13 that makes it comfortable. One night moves you from
     * losing to nearly winning, and the last step is a second collect or a
     * better composition. That is the shape the ladder was built for.
     *
     * Gold and shards are untouched: gold has no sink yet, and shard pacing is
     * a summon question rather than a levelling one.
     */
    xpPerMin: 12 + stage * 4,
  };
}

/*
 * What clearing a stage pays, expressed in MINUTES OF IDLING at that stage.
 *
 * Tying the two economies together with one number is the whole point. A reward
 * quoted in flat gold goes stale the moment the idle rate changes, and nobody
 * can tell whether 400 gold is generous without knowing what an hour is worth.
 * "A clear is two minutes of idling, a boss is a quarter of an hour, and the
 * first time you get there is worth double" is a sentence a designer can hold
 * in their head and tune by argument.
 *
 * It also makes the real reward visible for what it is: clearing a NEW highest
 * stage raises `profile.stage`, and that raises the rate every one of these is
 * measured against. The pay-out is the milestone; the raise is the prize.
 */
/*
 * Tuned against the level a player ARRIVES at the boss on, which is the number
 * the whole act is shaped around -- not against anything the reward itself
 * says.
 *
 * At the old 6 minutes -- against the much faster idle rate this was first set
 * against -- clearing stages 1-9 left five characters far short of a gate that
 * wants 13: a wall so far off that no strategy could close it and the
 * only move was to idle for hours. At 45 they arrive at **10/9/9/9/9**, which is
 * a **35%** win -- losable, visibly close, and beatable either by idling a
 * couple of levels or by finding a better composition. That is the fight the
 * ladder was built to set up.
 *
 *     CLEAR_MINUTES   level on arrival     win at the gate
 *         20            7/7/7/7/6               ~5%
 *         45           10/9/9/9/9                35%
 *         60           11/11/10/10/10            57%
 *
 * The boss's own pay-out is deliberately much larger: it is the Act's send-off
 * rather than a rung, and it lands AFTER the fight so it cannot help you win it.
 */
export const CLEAR_MINUTES = 6;
/**
 * ...but XP is paid at this multiple of them.
 *
 * The two economies are paced for different things and had been sharing one
 * number. Cutting the idle xp rate by seven and a half meant raising the clear
 * to compensate -- which raised GOLD and SHARDS by seven and a half too, and
 * Act 1 started paying out 1,270 shards: forty-two summons for clearing the
 * tutorial.
 *
 * One weight rather than a second set of durations, so the ratio between a
 * corridor clear and a boss stays wherever it is put, and so "a clear is six
 * minutes of idling, and its xp counts sevenfold" is still one sentence.
 */
export const XP_WEIGHT = 7.5;
export const BOSS_MINUTES = 15;
/** A stage you have never cleared before pays this multiple. */
export const FIRST_CLEAR_BONUS = 2;

export interface ClearReward {
  gold: number;
  shards: number;
  xp: number;
  /** For the victory card, which says why the number is what it is. */
  minutes: number;
}

/**
 * `boss` is a parameter rather than derived here, because `BOSS_EVERY` lives in
 * `content.ts` -- which imports the engine, so the engine cannot import it back
 * without a cycle. The caller already knows which stage it fought.
 */
export function clearReward(stage: number, boss: boolean, firstClear: boolean): ClearReward {
  const rates = ratesFor(stage);
  const minutes = (boss ? BOSS_MINUTES : CLEAR_MINUTES) * (firstClear ? FIRST_CLEAR_BONUS : 1);
  return {
    gold: Math.round(rates.goldPerMin * minutes),
    // Rounded UP, alone among the three. Shards are the summon currency and the
    // rate is a fraction of one per minute, so rounding down would pay a flat
    // zero for every early clear -- the one reward a new player would actually
    // notice missing.
    shards: Math.ceil(rates.shardsPerMin * minutes),
    // Levelling is paced separately from the purse -- see `XP_WEIGHT`.
    xp: Math.round(rates.xpPerMin * minutes * XP_WEIGHT),
    minutes,
  };
}

/**
 * Bank a cleared stage: pay for it, and raise the ladder if it was a new high.
 *
 * `stage` is the rung that was actually beaten, which is not always
 * `profile.stage + 1` -- the dev stage picker can drop you anywhere, and
 * re-clearing an old stage is a legitimate thing to do for the pay-out. The
 * high-water mark only ever moves forward.
 */
export function bankClear(
  profile: Profile,
  stage: number,
  boss: boolean,
  /**
   * What a first clear drops, and why it is passed in rather than computed.
   *
   * `items.ts` reads `ratesFor` from this module, so it imports `idle.ts`; this
   * module cannot import it back without a cycle. The caller owns the drop
   * table, which is also where it belongs -- what a stage pays is content.
   */
  drops: string[] = [],
): { profile: Profile; reward: ClearReward; dropped: string[] } {
  const firstClear = stage >= profile.stage;
  const reward = clearReward(stage, boss, firstClear);
  // Tokens are a FIRST-CLEAR reward only. A stage-1 clear takes about thirty
  // seconds, so dropping one on every repeat would make farming the shortest
  // fight in the game strictly better than playing it.
  const dropped = firstClear ? drops : [];
  const items = { ...profile.items };
  for (const id of dropped) items[id] = (items[id] ?? 0) + 1;
  return {
    profile: {
      ...profile,
      gold: profile.gold + reward.gold,
      shards: profile.shards + reward.shards,
      xp: profile.xp + reward.xp,
      items,
      stage: Math.max(profile.stage, stage + 1),
    },
    reward,
    dropped,
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
    items: {},
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
