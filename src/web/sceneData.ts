import type { Slot, StageLayer } from '../engine/formation.ts';

/**
 * Battle scenes, authored in the stage lab and stored beside the art.
 *
 * Lives at `art/scenes/<id>.json`, for the same reasons the animation tuning
 * lives at `art/actors/<name>/<name>.anim.json`: it is a judgement call about
 * how something should LOOK, so it is hand-authored rather than generated, and
 * a re-pack can never overwrite it.
 *
 * One file per scene. A shared file would be a merge conflict waiting to
 * happen and would couple scenes that have nothing to do with each other --
 * laying out a forest should not rewrite the file describing a throne room.
 *
 * ```json
 * {
 *   "name": "Curtain Call",
 *   "layers": [
 *     { "src": "/background/paper_stage/backdrop.png", "depth": 0 },
 *     { "src": "/background/paper_stage/tree.png", "depth": 0.34,
 *       "x": 4, "bottom": 30, "h": 30, "shadow": true }
 *   ]
 * }
 * ```
 */
export interface SceneFile {
  name: string;
  layers: StageLayer[];
  /**
   * Where the cast stands, overriding the defaults in formation.ts.
   *
   * A scene is not only its scenery: a set with a raised platform stage right
   * wants its front rank standing ON the platform, and that is a property of
   * the SET, not of the formation rules. Keeping the marks in the same file as
   * the pieces they relate to is what lets one scene be swapped for another
   * without the cast ending up in mid-air.
   *
   * Optional, and omitted means the defaults. `board` is every party slot
   * -- all five, because any of them is reachable by repositioning -- while
   * `enemy` is whatever block the encounter deploys into.
   */
  board?: Slot[];
  enemy?: Slot[];
  /**
   * Which battle stages this scene dresses, inclusive: `[1, 10]`.
   *
   * The scene declares its own range rather than a central table mapping stages
   * to scenes. One file per scene is already the rule here, and a registry
   * would be a second place to edit and a second place to forget -- rename a
   * scene and the table points at nothing, with no error until somebody plays
   * that stage and gets a black backdrop.
   *
   * Omitted means the scene is not on the ladder at all. That is the right
   * default: a scene being WORKED ON should not silently become what players
   * see the moment it is saved, and the lab needs somewhere to build a set
   * before it is ready to dress anything.
   */
  stages?: [number, number];
  /**
   * Where a Performer stands while their ability plays, per side.
   *
   * Part of the SCENE for the same reason the formation marks are: a set with a
   * raised platform or a prop across the middle wants its acting positions
   * somewhere else, and that is a property of the set rather than of the rules.
   * Omitted falls back to `DOWNSTAGE`, which stays the default for every scene
   * that has no opinion.
   */
  acts?: { player: { x: number; y: number }; enemy: { x: number; y: number } };
}

// Eager, so scenes are plain data at module load: the battle screen reads them
// while building its first render and cannot await. Vite inlines these at build
// time, and an edit triggers a reload in dev -- which is what makes the lab's
// Save button show up on the battle screen without a restart.
const files = import.meta.glob<SceneFile>('../../art/scenes/*.json', {
  eager: true,
  import: 'default',
});

/** `id` is the file name without its extension. */
const idOf = (path: string): string => path.split('/').pop()!.replace(/\.json$/, '');

export const SCENES: Record<string, SceneFile> = Object.fromEntries(
  Object.entries(files)
    .map(([path, data]) => [idOf(path), data])
    .filter(([, data]) => !!data),
) as Record<string, SceneFile>;

export const SCENE_IDS: string[] = Object.keys(SCENES).sort();

/**
 * One scene's layers, or undefined when nothing is authored for it.
 *
 * Undefined rather than an empty list on purpose: an encounter falls back to
 * its flat `background` image when it has no scene, and an empty array would
 * read as "a scene with nothing in it" and paint a black stage.
 */
export function sceneLayers(id: string | undefined): StageLayer[] | undefined {
  if (!id) return undefined;
  const layers = SCENES[id]?.layers;
  return layers?.length ? layers : undefined;
}

/**
 * Which scene dresses a given battle stage, or undefined for the default.
 *
 * Ranges are scanned rather than indexed because they are authored by hand and
 * a handful of them will never be worth a lookup table. Overlaps resolve to the
 * NARROWEST match, which is what makes the common authoring shape work: a broad
 * `[1, 10]` meadow for the early ladder, with a `[10, 10]` boss set laid over
 * the top of it. A wider range never steals a stage a more specific one claimed.
 */
export function sceneIdForStage(stage: number): string | undefined {
  let best: { id: string; span: number } | undefined;
  for (const [id, file] of Object.entries(SCENES)) {
    const range = file?.stages;
    if (!range || range.length !== 2) continue;
    const [from, to] = range;
    if (stage < from || stage > to) continue;
    const span = to - from;
    if (!best || span < best.span) best = { id, span };
  }
  return best?.id;
}

/** A scene's acting marks, or undefined to use the defaults. */
export function sceneActs(id: string | undefined): SceneFile['acts'] | undefined {
  if (!id) return undefined;
  const a = SCENES[id]?.acts;
  // Both sides or neither: half an override would put one side on the scene's
  // mark and the other on the global one, which is a staging nobody chose.
  return a?.player && a.enemy ? a : undefined;
}

/** A scene's authored marks for one side, or undefined for the defaults. */
export function sceneSlots(id: string | undefined, which: 'board' | 'enemy'): Slot[] | undefined {
  if (!id) return undefined;
  const list = SCENES[id]?.[which];
  return list?.length ? list : undefined;
}
