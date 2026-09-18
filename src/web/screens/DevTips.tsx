/**
 * The toolbox, in the app.
 *
 * `documents/DEV_TOOLBOX.md` says all of this too, and that is the wrong place
 * to read it from: the moment you need "what do I call this sheet" is the
 * moment you are looking at the sheet in the animation lab, not at a file tree
 * in an editor. A page one click away in the same window is the difference
 * between remembering a tool exists and not.
 *
 * Deliberately not generated from the markdown. Rendering a doc would mean a
 * parser and a build step for a page whose whole job is to be short, and a
 * short hand-kept page that is read is worth more than a complete one that is
 * not. The markdown stays the long form; this is what is worth having at arm's
 * length while working.
 *
 * Content lives in the arrays below so the markup stays one shape -- adding a
 * command is adding a row, not writing JSX.
 */

const COMMANDS: { cmd: string; what: string }[] = [
  { cmd: '⤓ Drop art  (in this panel)', what: 'Easiest route: drop a sheet, pick who and what, see the cut, save. No filename to get right' },
  { cmd: 'npm run art', what: 'What art each character has, and the filename for anything missing. Add an id for one: npm run art benjamin' },
  { cmd: 'npm run art:split -- <sheet> --write', what: 'Cut a sheet into one file per frame. --all <actor> does every sheet they have' },
  { cmd: 'npm run art:split -- <sheet> --bleed --write', what: 'Same, but cut wide when a seam runs through a drawing — then it erases the neighbour automatically' },
  { cmd: 'python scripts/respace_sheet.py <sheet> --write', what: 'Re-space a sheet whose drawings are crowded and overrun their cells' },
  { cmd: 'python scripts/pack_sprites.py --only <actor>', what: 'art/ → public/ by hand. The dev server already does this on every save' },
  { cmd: 'npm run sim', what: '500 headless battles and an ability-usage histogram' },
  { cmd: 'npm run play', what: 'One headless battle with a readable turn log' },
  { cmd: 'npm run typecheck', what: 'tsc --noEmit' },
];

const NAMING: { path: string; what: string }[] = [
  { path: 'animations/idle_2/idle_2_01.png', what: 'A FOLDER is a clip. Frame count is how many files are in it — no grid to get wrong. Zero-pad, or _10 sorts before _2' },
  { path: 'benjamin_ability_2_4x1.png', what: 'Ability by SLOT — position in content.ts. Fast, but reordering a kit repoints it' },
  { path: 'benjamin_sunder_4x1.png', what: 'Ability by NAME. Wins if both exist, and survives a reorder' },
  { path: 'benjamin_idle.png  _idle_2  _idle_3  _idle_4', what: 'Resting stances. All four loop automatically; the game rotates between them' },
  { path: 'benjamin_ready_2x1.png', what: 'Held during the walk to the mark, and while an action is queued' },
  { path: 'benjamin_upgrade_4x1.png', what: 'Buying an in-battle upgrade' },
  { path: 'benjamin_pain.png / benjamin_death.png', what: 'Stills. death is drawn lying down and is sized by width' },
  { path: 'benjamin_celebration_4x1.png', what: 'Victory. celebration_ending is the pose it settles into' },
];

const TRAPS: { when: string; then: string }[] = [
  {
    when: 'A new animation does not show up',
    then: 'Is it in art/actors/<name>/animations/? Nothing in art/samples/ is ever packed — it is a drop box.',
  },
  {
    when: 'Frames sliced wrong, or the page eats memory',
    then: 'A sheet with no _NxM. Frame count falls back to gcd(width, height): 2048×768 reads as 24 frames, and 2876×768 as 138,048. Name the grid, or split it into a folder.',
  },
  {
    when: 'A frame holds part of the frame before it',
    then: 'A drawing overruns its seam. Re-split with --bleed; it cuts wide and erases the neighbour when that piece is separable.',
  },
  {
    when: 'An ability plays the wrong animation',
    then: 'A slot-named sheet after a kit reorder. The clip picker above shows the binding as "ability_2 — Sunder".',
  },
  {
    when: 'The lab reloads and loses your place',
    then: 'Something under art/ changed. A pack that writes nothing no longer reloads, so this now means art really did change.',
  },
  {
    when: 'The packer refuses an actor',
    then: '<name>.pack.json was wiped by replacing the folder. Delete public/sprites/<name>/ and re-run.',
  },
];

export function DevTips() {
  return (
    <div className="dev-tips">
      <h2>Dev toolbox</h2>
      <p className="dim">
        The short form. <code>documents/DEV_TOOLBOX.md</code> has the same material with the
        reasoning, and <code>documents/README.md</code> has the reasoning behind that.
      </p>

      <section>
        <h3>Commands</h3>
        <ul className="tip-list">
          {COMMANDS.map((c) => (
            <li key={c.cmd}>
              <code>{c.cmd}</code>
              <span>{c.what}</span>
            </li>
          ))}
        </ul>
        <p className="dim">
          <code>npm run</code> swallows flags unless you separate them with <code>--</code>. Calling
          the Python script directly avoids that.
        </p>
      </section>

      <section>
        <h3>Where art goes, and what to call it</h3>
        <p className="dim">
          Everything lives in <code>art/actors/&lt;name&gt;/animations/</code>. A multi-frame{' '}
          <em>sheet</em> needs <code>_NxM</code> in its name unless its cells are square; a{' '}
          <em>folder</em> of frames never does.
        </p>
        <ul className="tip-list">
          {NAMING.map((n) => (
            <li key={n.path}>
              <code>{n.path}</code>
              <span>{n.what}</span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3>When something is odd</h3>
        <ul className="tip-list wide">
          {TRAPS.map((t) => (
            <li key={t.when}>
              <code>{t.when}</code>
              <span>{t.then}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
