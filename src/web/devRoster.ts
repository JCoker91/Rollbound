import { useSyncExternalStore } from 'react';
import { ROSTER } from '../engine/content.ts';
import type { CharacterDef } from '../engine/types.ts';
import { applyLevel } from '../engine/levels.ts';
import { applyStars, MAX_STARS, type StarProgress } from '../engine/stars.ts';

/**
 * Saved test parties for dev mode.
 *
 * The point is to try a COMPOSITION without earning it. Checking whether a
 * chain between two Performers is worth its dice means fielding exactly those
 * two at a chosen level, which through the real game means grinding to it --
 * and then re-grinding after every reload, because the battle screen's party
 * override was React state and died with the page.
 *
 * So these persist. A roster is a name, five slots, and a level and star count
 * per slot; loading one rebuilds the sheets from the BASE roster rather than
 * from whatever is in the save, so a test party is reproducible and never
 * contaminated by real progress.
 *
 * Dev-only, and deliberately stored apart from the player's profile: a test
 * party is not progress, and a wipe of one should never touch the other.
 */

export interface DevMember {
  id: string;
  level: number;
  /** 0 to MAX_STARS. Picks are derived; see `autoPicks`. */
  stars: number;
}

export interface DevRoster {
  name: string;
  members: DevMember[];
}

const KEY = 'stagebound.dev.rosters';

/**
 * Storage that cannot throw -- the accessor itself raises in a private window
 * or with site data blocked, and an exception here would take the app down
 * before it rendered. Losing a saved test party is a fine outcome; a blank
 * page is not. Same reasoning as `dev.ts`.
 */
function read(): DevRoster[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Validated rather than trusted: this file outlives the roster it was
    // written against, and a member naming a character who has since been
    // renamed would otherwise crash the party build rather than be dropped.
    return parsed.flatMap((r: unknown) => {
      if (typeof r !== 'object' || r === null) return [];
      const { name, members } = r as { name?: unknown; members?: unknown };
      if (typeof name !== 'string' || !Array.isArray(members)) return [];
      const clean = members.flatMap((m: unknown) => {
        if (typeof m !== 'object' || m === null) return [];
        const { id, level, stars } = m as Record<string, unknown>;
        if (typeof id !== 'string' || !ROSTER.some((d) => d.id === id)) return [];
        return [{
          id,
          level: Number.isFinite(level) ? Math.max(1, Number(level)) : 1,
          stars: Number.isFinite(stars) ? clampStars(Number(stars)) : 0,
        }];
      });
      return clean.length ? [{ name, members: clean }] : [];
    });
  } catch {
    return [];
  }
}

function write(rosters: DevRoster[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(rosters));
  } catch {
    /* Nothing to do: the rosters stay for this session only. */
  }
}

const clampStars = (n: number): number => Math.min(MAX_STARS, Math.max(0, Math.round(n)));

/* A tiny store rather than context: the battle screen is the only reader, but
   it has to re-render when a save happens from inside its own modal. */
let current = read();
const listeners = new Set<() => void>();
const subscribe = (fn: () => void): (() => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const snapshot = (): DevRoster[] => current;

function commit(next: DevRoster[]): void {
  current = next;
  write(next);
  for (const fn of listeners) fn();
}

/** Saved rosters, re-rendering the caller when one is added or removed. */
export function useDevRosters(): DevRoster[] {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** Save under `name`, replacing any roster already using it. */
export function saveRoster(name: string, members: DevMember[]): void {
  const trimmed = name.trim();
  if (!trimmed || members.length === 0) return;
  const rest = current.filter((r) => r.name !== trimmed);
  commit([...rest, { name: trimmed, members: members.map((m) => ({ ...m })) }]
    .sort((a, b) => a.name.localeCompare(b.name)));
}

export function deleteRoster(name: string): void {
  commit(current.filter((r) => r.name !== name));
}

/**
 * Star picks for a dev party: the FIRST node of each tier, every time.
 *
 * A star level alone does not determine a character's sheet -- every other
 * tier is a choice between two nodes -- so something has to choose. Taking the
 * first is arbitrary but it is also STABLE, which is the property a test party
 * needs: the same saved roster must rebuild to the same numbers next week, and
 * a random or remembered pick would make a comparison between two runs
 * meaningless. Picking specific nodes is a job for the real star screen.
 */
export function autoPicks(def: CharacterDef, stars: number): StarProgress {
  const tiers = def.starTree ?? [];
  const level = Math.min(clampStars(stars), tiers.length);
  return { level, picks: tiers.slice(0, level).map((t) => t.nodes[0]!.id) };
}

/**
 * Build battle-ready sheets from a saved roster.
 *
 * From the BASE roster, never from the live party: the party passed into the
 * battle already has levels and stars folded in, and applying them again would
 * compound. Levels first, then stars, so a star's percentage is of the levelled
 * stat -- the same order `App.tsx` uses for the real party.
 */
export function buildParty(members: DevMember[]): CharacterDef[] {
  return members.flatMap((m) => {
    const def = ROSTER.find((d) => d.id === m.id);
    if (!def) return [];
    return [applyStars(applyLevel(def, Math.max(1, m.level)), autoPicks(def, m.stars))];
  });
}
