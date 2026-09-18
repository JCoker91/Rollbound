/**
 * How each multi-hit ability divides its damage. WRITTEN BY THE ANIMATION LAB.
 *
 * A data file rather than a field in `content.ts`, for one reason: tuning a
 * volley is something you do by watching it, over and over, and that loop
 * cannot run through hand-editing a source file.
 *
 * It lives in `src/engine/` and NOT in `art/`, which is the important part. The
 * engine is pure and runs headless -- `npm run sim` has no art pipeline and no
 * browser -- so balance kept under `art/` would be invisible to exactly the
 * tool that checks it.
 *
 * TypeScript rather than JSON because a JSON import needs an import attribute
 * that Node and the bundler disagree about, and this file is machine-written
 * either way. The shape is the whole file: one flat object, regenerated whole,
 * so a bad write breaks the build loudly instead of half-applying.
 *
 * Keyed `<character id>/<ability name>`: an ability is only unique within its
 * owner, and two characters may well both end up with a "Flurry".
 *
 * Shares are ratios, normalised against their own total by `splitPower`, so
 * `[1, 1, 2]` and `[0.25, 0.25, 0.5]` say the same thing.
 */
export const HIT_SPLITS: Record<string, number[]> = {
  'benjamin/Perfect Form': [1, 1, 1, 1, 1, 1],
  'benjamin/Quick Cut': [1, 1],
};

export const hitSplitKey = (characterId: string, abilityName: string): string =>
  `${characterId}/${abilityName}`;

/** The split for one ability, or undefined for a single-hit strike. */
export function hitSplitFor(characterId: string, abilityName: string): number[] | undefined {
  const v = HIT_SPLITS[hitSplitKey(characterId, abilityName)];
  return v?.length && v.length > 1 ? v : undefined;
}
