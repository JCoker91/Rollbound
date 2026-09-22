/**
 * What art each Performer has, and the exact filename for what they are missing.
 *
 *     npm run art            every character
 *     npm run art benjamin   one of them
 *
 * This exists to answer the only question that was costing real time: "I have
 * a sheet, where does it go and what do I call it?" Everything it needs is
 * already known -- the roster says which abilities a character has and in what
 * order, the packer's manifest says which clips came out the other end -- but
 * the two were only ever joined in somebody's head.
 *
 * Written in TypeScript rather than beside the packer in Python for one
 * reason: an ability's name and its SLOT live in `content.ts`, and a second
 * parser for that file is a second thing to keep in step with it. `npm run sim`
 * already established that a CLI can just import the engine.
 */
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROSTER } from '../engine/content.ts';
import { ANIMATION_CLIPS } from '../engine/sprites.generated.ts';
import { abilitySlug } from '../web/clipNaming.ts';

/**
 * The clips a finished character is expected to own.
 *
 * `grid` is whether the sheet needs an `_NxM` suffix -- a multi-frame sheet
 * does unless its cells happen to be square, because the frame count is
 * otherwise inferred as `gcd(width, height)` and a 2048x768 four-frame sheet
 * reads as 8x3. A single-drawing pose never needs one.
 */
const EXPECTED: { clip: string; grid: boolean; note: string }[] = [
  { clip: 'idle', grid: false, note: 'resting loop' },
  { clip: 'idle_2', grid: false, note: 'alternate stance' },
  { clip: 'idle_3', grid: false, note: 'alternate stance' },
  { clip: 'idle_4', grid: false, note: 'alternate stance' },
  { clip: 'ready', grid: false, note: 'held while walking out, and while an action is queued' },
  { clip: 'thinking', grid: false, note: 'still — held while selected and still deciding' },
  { clip: 'upgrade', grid: true, note: 'buying an in-battle upgrade' },
  { clip: 'move', grid: true, note: 'repositioning' },
  { clip: 'pain', grid: false, note: 'still — held hit reaction' },
  { clip: 'death', grid: false, note: 'still — held for the rest of the battle' },
  { clip: 'celebration', grid: true, note: 'victory' },
  { clip: 'celebration_ending', grid: false, note: 'the pose celebration settles into' },
];

const ok = (s: string) => `\x1b[32m${s}\x1b[0m`;
const no = (s: string) => `\x1b[31m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

function sourcesOf(id: string): string[] {
  const dir = join('art', 'actors', id, 'animations');
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.png')) : [];
}

/**
 * The source sheet for a clip, whatever grid suffix it carries.
 *
 * `<id>_<clip>.png` or `<id>_<clip>_<N>x<M>.png` and nothing else -- an earlier
 * version of this test was loose enough to match every clip against the first
 * file in the folder, and reported `benjamin_death.png` as the source of the
 * idle, the ready and the upgrade.
 */
const sourceFor = (files: string[], id: string, clip: string): string | undefined =>
  files.find((f) => {
    const stem = f.replace(/\.png$/, '');
    const rest = stem.startsWith(`${id}_`) ? stem.slice(id.length + 1) : stem;
    if (rest === clip) return true;
    // A literal regex for the suffix, rather than building one around the clip
    // name: escapes inside a template literal are eaten before RegExp ever sees
    // them, and `\d` silently became a plain `d`.
    if (!rest.startsWith(`${clip}_`)) return false;
    return /^\d+x\d+$/.test(rest.slice(clip.length + 1));
  });

function report(id: string, name: string): void {
  const files = sourcesOf(id);
  const packed = ANIMATION_CLIPS[id] ?? {};
  const def = ROSTER.find((d) => d.id === id);
  const abilities = def?.abilities ?? [];

  let have = 0;
  let want = 0;
  const lines: string[] = [];

  const row = (clip: string, label: string, grid: boolean, alt?: string) => {
    want++;
    const src = sourceFor(files, id, clip);
    const p = packed[clip];
    if (p) {
      have++;
      lines.push(`  ${ok('+')} ${label.padEnd(26)} ${dim(`${src ?? '?'}  ${p.frames}f`)}`);
    } else {
      const want1 = `${id}_${clip}${grid ? '_4x1' : ''}.png`;
      lines.push(
        `  ${no('-')} ${label.padEnd(26)} ${no(want1)}${alt ? dim(`   or ${alt}`) : ''}`,
      );
    }
  };

  // Abilities first: they are the ones whose filename is not obvious, because
  // it can be taken from either the ability's name or its position in the kit.
  abilities.forEach((a, i) => {
    const slot = `ability_${i + 1}`;
    const slug = abilitySlug(a.name);
    want++;
    const p = packed[slug] ?? packed[slot];
    if (p) {
      have++;
      const via = packed[slug] ? 'by name' : 'by slot';
      lines.push(
        `  ${ok('+')} ${`${slot}  ${a.name}`.padEnd(26)} ${dim(`${p.frames}f  ${via}`)}`,
      );
    } else {
      lines.push(
        `  ${no('-')} ${`${slot}  ${a.name}`.padEnd(26)} ${no(`${id}_${slot}_4x1.png`)}` +
          dim(`   or ${id}_${slug}_4x1.png`),
      );
    }
  });

  for (const e of EXPECTED) row(e.clip, e.clip, e.grid);

  console.log(`\n${name}  ${dim(`art/actors/${id}/animations/`)}  ${have}/${want}`);
  console.log(lines.join('\n'));
}

const only = process.argv.slice(2).map((s) => s.toLowerCase());
const targets = ROSTER.filter((d) => !only.length || only.includes(d.id));
if (!targets.length) {
  console.log(`no such character. Known: ${ROSTER.map((d) => d.id).join(', ')}`);
  process.exit(1);
}
for (const d of targets) report(d.id, d.name);
console.log(
  dim(
    '\nA multi-frame sheet needs its grid in the name (_4x1) unless its cells are square:' +
      '\nthe count is otherwise gcd(width, height), so 2048x768 reads as 8x3 = 24 frames.' +
      '\nAbility sheets may be named by slot or by ability; the ability name wins if both exist.',
  ),
);
