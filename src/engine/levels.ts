import type { CharacterDef } from './types.ts';

/**
 * Character levels.
 *
 * Experience is a shared pool rather than per-character: you decide who gets it,
 * which is the actual decision. Levelling is otherwise automatic and would be
 * busywork.
 *
 * The interesting constraint is the cap. Your roster cannot run away on the back
 * of one carry -- the ceiling is set by your FIFTH-highest character, rounded up
 * to the next multiple of five. Reaching level 26 means dragging five characters
 * to 25 first. That keeps a bench worth investing in, and it is the reason
 * duplicates and summons stay relevant after a favourite is maxed.
 */

export const LEVEL_STEP = 5;
export const MAX_LEVEL = 80;
/** How many characters have to keep pace. */
export const PACE_COUNT = 5;

/** Stat growth is additive on the base sheet, so it stays explainable. */
export const GROWTH_PER_LEVEL = 0.08;

/** Experience to go from `level` to `level + 1`. */
export function xpForNext(level: number): number {
  return Math.round(60 * Math.pow(level, 1.45));
}

/** Total experience sunk into reaching `level` from 1. */
export function xpSpent(level: number): number {
  let total = 0;
  for (let l = 1; l < level; l++) total += xpForNext(l);
  return total;
}

/**
 * The ceiling every character shares, from the levels of the whole roster.
 *
 * With fewer than five characters the lowest one sets the pace, so an early
 * roster is not blocked by seats it has not filled yet.
 */
export function levelCap(levels: number[]): number {
  if (levels.length === 0) return LEVEL_STEP;
  const sorted = [...levels].sort((a, b) => b - a);
  const pace = sorted.length >= PACE_COUNT ? sorted[PACE_COUNT - 1]! : sorted[sorted.length - 1]!;
  return Math.min(MAX_LEVEL, Math.floor(pace / LEVEL_STEP) * LEVEL_STEP + LEVEL_STEP);
}

/** Who is holding the ceiling down, so the UI can say so by name. */
export function pacesetters(
  entries: { id: string; level: number }[],
): { id: string; level: number }[] {
  const sorted = [...entries].sort((a, b) => b.level - a.level);
  if (sorted.length < PACE_COUNT) return sorted.slice(-1);
  const pace = sorted[PACE_COUNT - 1]!.level;
  return sorted.filter((e) => e.level === pace);
}

/**
 * The level a sheet was grown to, read back off its `powerScale`.
 *
 * Derived rather than stored. `applyLevel` deliberately leaves no `level`
 * field on the sheet -- the damage formula anchors on the SCALE, and a level
 * sitting there invites someone to put progression back inside combat maths
 * that is meant not to know about it. This is exact for whole levels, which
 * are the only kind there are, and it exists purely so the UI can say "Lv 12"
 * instead of making the player infer it from a stat line.
 *
 * A sheet that never went through `applyLevel` has no scale and is level 1.
 */
export function levelOf(def: CharacterDef): number {
  return Math.max(1, Math.round((((def.powerScale ?? 1) - 1) / GROWTH_PER_LEVEL) + 1));
}

/** A copy of the character grown to `level`. Applied before star picks. */
export function applyLevel(def: CharacterDef, level: number): CharacterDef {
  if (level <= 1) return def;
  const scale = 1 + (level - 1) * GROWTH_PER_LEVEL;
  return {
    ...def,
    // Travels with the sheet so the damage formula can anchor mitigation to it.
    powerScale: scale,
    maxHp: Math.round(def.maxHp * scale),
    attack: Math.round(def.attack * scale),
    physicalDefense: Math.round(def.physicalDefense * scale),
    magicalDefense: Math.round(def.magicalDefense * scale),
  };
}
