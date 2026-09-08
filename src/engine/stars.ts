import type { CharacterDef, StarEffect, StarNode } from './types.ts';

/**
 * Star levels.
 *
 * A character is unlocked by their first copy and starred with duplicates:
 * 1 duplicate for the first star, 2 for the second, and so on up to 5. Sixteen
 * pulls of the same character therefore takes them all the way.
 *
 * The tree branches on odd rungs and converges on even ones, so a fully starred
 * character has made three real choices rather than walked a fixed line.
 */

export const MAX_STARS = 5;

export interface StarProgress {
  level: number;
  /** Chosen node id per star taken; index 0 is the first star. */
  picks: string[];
}

export const EMPTY_STARS: StarProgress = { level: 0, picks: [] };

/** Duplicates needed to go from `level` to `level + 1`. */
export function starCost(level: number): number {
  return level + 1;
}

/** Duplicates already sunk into reaching `level`. */
export function starSpend(level: number): number {
  return (level * (level + 1)) / 2;
}

/**
 * Duplicates still available to spend.
 *
 * Derived rather than stored: copies pulled is the source of truth, so a save
 * can never drift into a state where spares and stars disagree.
 */
export function spares(copies: number, level: number): number {
  return Math.max(0, copies - 1 - starSpend(level));
}

export function progressFor(
  stars: Record<string, StarProgress> | undefined,
  id: string,
): StarProgress {
  return stars?.[id] ?? EMPTY_STARS;
}

/** The nodes actually taken, in order. */
export function chosenNodes(def: CharacterDef, progress: StarProgress): StarNode[] {
  const tree = def.starTree ?? [];
  const out: StarNode[] = [];
  for (let i = 0; i < progress.level && i < tree.length; i++) {
    const tier = tree[i]!;
    const picked = tier.nodes.find((n) => n.id === progress.picks[i]) ?? tier.nodes[0];
    if (picked) out.push(picked);
  }
  return out;
}

/**
 * A copy of the character with their star picks folded in.
 *
 * Applied once when a battle starts rather than checked during combat, so every
 * damage formula and AI heuristic sees plain numbers and needs no knowledge of
 * the star system at all.
 */
export function applyStars(def: CharacterDef, progress: StarProgress): CharacterDef {
  const nodes = chosenNodes(def, progress);
  if (nodes.length === 0) return def;

  let maxHp = def.maxHp;
  let attack = def.attack;
  let defense = def.defense;
  const passives = [...(def.passives ?? [])];
  const abilities = def.abilities.map((a) => ({ ...a }));

  for (const node of nodes) {
    for (const e of node.effects) {
      switch (e.kind) {
        case 'stat': {
          // Percentages are of the BASE stat, so three +8% picks read as +24%
          // rather than compounding into something the UI cannot explain.
          if (e.stat === 'maxHp') maxHp += Math.round((def.maxHp * e.percent) / 100);
          if (e.stat === 'attack') attack += Math.round((def.attack * e.percent) / 100);
          if (e.stat === 'defense') defense += Math.round((def.defense * e.percent) / 100);
          break;
        }
        case 'passive':
          passives.push(e.passive);
          break;
        case 'ability': {
          const target = abilities.find((a) => a.name === e.ability);
          if (!target) break;
          if (e.power) target.power = Math.round((target.power + e.power) * 100) / 100;
          if (e.range) target.range += e.range;
          if (e.cost) target.cost = Math.max(0, target.cost + e.cost);
          break;
        }
      }
    }
  }

  return { ...def, maxHp, attack, defense, passives, abilities };
}

/** Rules text for one effect, generated from its own numbers. */
export function describeEffect(e: StarEffect): string {
  switch (e.kind) {
    case 'stat': {
      const label = e.stat === 'maxHp' ? 'max HP' : e.stat === 'attack' ? 'ATK' : 'DEF';
      return `+${e.percent}% ${label}`;
    }
    case 'passive':
      return e.passive.kind;
    case 'ability': {
      const bits: string[] = [];
      if (e.power) bits.push(`+${Math.round(e.power * 100)}% power`);
      if (e.range) bits.push(`+${e.range} range`);
      if (e.cost) bits.push(`${e.cost > 0 ? '+' : ''}${e.cost} cost`);
      return `${e.ability}: ${bits.join(', ')}`;
    }
  }
}
