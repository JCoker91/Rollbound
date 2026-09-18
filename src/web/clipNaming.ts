/**
 * Clip NAMES, and nothing else.
 *
 * A leaf on purpose: no imports at all, so anything can read it -- including a
 * plain `node` CLI, which cannot load `clipAnimation.ts` because that module
 * reaches `animationData.ts` and its `import.meta.glob`. `npm run art` needs
 * exactly these two functions and none of the machinery around them, and a
 * second copy of the slug rule would drift from this one the first time an
 * ability was named something with punctuation in it.
 */

/** An ability's name as a clip name: `Quick Cut` -> `quick_cut`. */
export const abilitySlug = (ability: string): string =>
  ability
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

/**
 * Which ability a slot-named clip belongs to, for anything that shows a clip
 * name to a person. Returns null for a clip that is not slot-named.
 *
 * The lab is the caller that matters. `ability_2` on its own is a filing
 * reference, not information -- seeing "ability_2 — Sunder" is what makes a kit
 * reorder visible at the moment it would otherwise quietly repoint the art.
 */
export function slotAbilityName(
  clip: string,
  abilities: readonly { name: string }[] | undefined,
): string | null {
  const m = /^ability_(\d+)$/.exec(clip);
  if (!m || !abilities) return null;
  return abilities[Number(m[1]) - 1]?.name ?? null;
}

/**
 * Which clip an actor plays for a given ability.
 *
 * Per-ability, or nothing. The lookup is by NAME, so authoring a new animation
 * is entirely a matter of what the file is called -- drop
 * `benjamin_quick_cut_4x1.png` into the animations folder and Quick Cut starts
 * using it, with no registry to update and no code to touch. The packer already
 * derives clip names from file names, so nothing in the pipeline had to learn
 * what an ability is.
 *
 * There is no generic `attack` fallback any more, by decision: every ability
 * gets its own sheet. The fallback was not doing the job it was written for
 * either -- it kept ONE character's abilities animated, because Benjamin was
 * the only actor who ever shipped an `attack` sheet, and by the time his four
 * abilities each had their own he was not reaching it. For everyone else it
 * named a clip that did not exist and resolved to nothing, which is what this
 * now says out loud.
 *
 * An ability with no sheet is still perfectly playable: the Performer walks
 * out, holds their `ready` stance for the beat and walks back. That is exactly
 * what the whole roster bar Benjamin already did, and it stays incremental --
 * each sheet added upgrades one ability without disturbing the rest.
 */
export function abilityClipName(
  clips: Record<string, unknown> | undefined,
  ability: string | undefined,
  /**
   * The character's ability list, so a sheet can be filed by SLOT.
   *
   * `benjamin_ability_2_4x1.png` is the second ability's animation, whatever
   * that ability is currently called -- which is the whole point: exporting a
   * sheet should not require remembering how a kit spells its abilities, and
   * renaming one should not orphan its art.
   *
   * The trade is real and worth stating: a slot binds to POSITION in
   * `content.ts`, so reordering a kit moves every slot-named sheet with it,
   * silently. That is why the explicit name wins below, and why the animation
   * lab prints the binding beside the clip -- the mapping should never be
   * something you have to hold in your head.
   */
  abilities?: readonly { name: string }[],
): string {
  if (!clips || !ability) return '';
  // The ability's own name first. It is the specific answer, it survives a
  // reorder, and it is the one you reach for when a sheet should stay pinned to
  // a particular ability whatever happens to the kit around it.
  const slug = abilitySlug(ability);
  if (slug && clips[slug]) return slug;

  const slot = abilities?.findIndex((a) => a.name === ability) ?? -1;
  if (slot >= 0) {
    const bySlot = `ability_${slot + 1}`;
    if (clips[bySlot]) return bySlot;
  }
  return '';
}

/**
 * Every resting stance an actor owns, in a stable order.
 *
 * `idle` plus `idle_2`, `idle_3`, `idle_4` -- the packer already treats all of
 * them as looping clips, because `LOOPING` matches by prefix, so nothing in the
 * pipeline had to learn what an alternate stance is.
 *
 * Returns a single entry for a character with one idle, which is what makes
 * this free to adopt: the stance picker below has nothing to choose between and
 * behaves exactly as the old fixed `idle` did.
 */
export function idleStances(clips: Record<string, unknown> | undefined): string[] {
  if (!clips) return [];
  const out = clips['idle'] ? ['idle'] : [];
  for (let n = 2; n <= 8; n++) if (clips[`idle_${n}`]) out.push(`idle_${n}`);
  return out;
}
