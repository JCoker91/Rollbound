# Dev toolbox

Every command and tool in the repo, what it is for, and the traps around it.

This page exists because the tools outgrew anyone's memory of them. It is a **reference**, not a
design document — the reasoning behind any of this lives in `README.md`, and where a decision is
worth reading before you change something, there is a pointer to it.

---

## Commands

| | |
| --- | --- |
| `npm run dev` | Vite dev server. Watches `art/` and re-packs on a change (see [The art loop](#the-art-loop)). |
| `npm run art` | What art each character has, and the exact filename for anything missing. Add a character id for one: `npm run art benjamin`. |
| `npm run art:split -- <sheet> --write` | Cut a sheet into one file per frame. See [Splitting sheets](#splitting-sheets). |
| `npm run sim` | 500 headless battles and an ability-usage histogram. A crash test, **not** a balance authority — see `README.md` §2. |
| `npm run play` | One headless battle with a readable turn log. |
| `npm run typecheck` | `tsc --noEmit`. Run it after any edit under `src/`. |
| `npm run build` | Production build. **Also runs the art pipeline.** |
| `python scripts/pack_sprites.py [--only <actor>]` | `art/` → `public/`. The dev server does this for you; run it by hand when the server is down. |
| `python scripts/split_sheet.py …` | What `npm run art:split` calls. Usable directly. |
| `python scripts/respace_sheet.py <sheet> [--write]` | Repair a sheet whose drawings overrun their cells. See [Repairing a sheet](#repairing-a-sheet). |

> `npm run` swallows flags unless you separate them: `npm run art:split -- <args>`. Calling the
> Python script directly avoids that entirely.

---

## The art loop

**Clips come only from `art/actors/<name>/animations/`.** Nothing under `art/samples/` is ever
packed — that folder is a drop box for originals and works in progress. Putting a new sheet there
and wondering why nothing changed is the single most common way to lose ten minutes.

Updating a clip is: **overwrite the file at its path, keeping its name.** The dev server re-packs
that one actor and reloads the page.

What the server prints, and what each line means:

| line | meaning |
| --- | --- |
| `art/samples/ is a drop box, not a source — nothing packed` | The file you touched is not one the packer reads. |
| `nothing changed — no reload` | The pack ran and produced byte-identical output. Your edit had no effect on the published art. |
| `N file(s) written` + a reload | Real change. |

A pack that writes nothing reloads nothing, so "reloading" genuinely means the art changed. Every
output goes through `write_if_changed` / `save_if_changed`, which is also why `git status` after a
build now lists only real changes.

---

## Naming art

```
art/actors/benjamin/
  benjamin.png                board sprite — everything scales from this
  benjamin_icon.png           optional; derived from the board sprite if absent
  animations/
    idle/  idle_2/  idle_3/  idle_4/        a clip can be a FOLDER of frames
    ability_1/ … ability_4/                 by slot: position in content.ts
    benjamin_sunder_4x1.png                 or by name: wins if both exist
    benjamin_pain.png  benjamin_death.png   stills
```

**A folder is a clip.** `animations/idle_2/idle_2_01.png…` is a three-frame idle; the count is how
many files are in it. This is the preferred input — no grid to infer and no cut to make, so neither
of the two traps below can fire. A folder beats a same-named sheet. **Index frames zero-padded**, or
`_10` sorts before `_2`.

**Ability sheets can be named two ways.** `benjamin_ability_2_…` resolves by *position* in
`content.ts`; `benjamin_sunder_…` resolves by name and wins if both exist. Slots are faster to
author and survive a rename — but they bind to position, so **reordering a kit silently repoints
every slot-named sheet.** The animation lab prints the binding (`ability_2 — Sunder`) so it is
visible where you would notice.

**Reserved clip names:** `ready` (held during the walk to the mark and while an action is queued),
`thinking` (a **still**, held while selected and still deciding — yields to `ready` once an action is
booked),
`upgrade` (buying an in-battle upgrade), `pain` and `death` (stills), `celebration`, and
`celebration_ending` (the pose `celebration` settles into — the `_ending` suffix is what wires that
up). `move` has no renderer yet; a sheet for it will pack and sit unused.

There is **no generic `attack` clip.** An ability with no sheet plays no clip: the Performer walks
out, holds their `ready` stance for the beat, and walks back.

### The `_NxM` trap

A multi-frame **sheet** needs its grid in the name unless its cells are square. Without it the frame
count is `gcd(width, height)`:

| sheet | inferred | actual |
| --- | --- | --- |
| 2048×768, 4 frames | 8×3 = **24** | 4 |
| 2876×768, 4 frames | gcd 4 → **138,048** | 4 |

The second one is not a typo. The packer will try to cut and pack 138k frames and the browser will
try to animate the result — it eats the machine. The packer now **refuses** any suffix-less sheet
inferring more than one row or more than `MAX_INFERRED_COLS` frames, and names the rename in its
message. Splitting a sheet into a folder retires this problem entirely.

---

## Uploading a sheet

**The easiest route, and the one that needs no filename: the `⤓ Drop art` screen** on the dev panel.
Drop a PNG, pick the character and the clip from lists built out of `content.ts`, see the cut drawn
over the sheet, and save. It names the file, runs the split and files the frames.

Two things worth knowing about how it works:

- **The cut is not done in the browser.** The sheet is posted to the dev server, which runs
  `scripts/split_sheet.py`. A canvas implementation of `gutter_cuts` would be a second answer to
  "where does frame 2 start", and the two would drift — the same reason the splitter imports the
  packer's cutter rather than having its own. The lines drawn over the preview are the positions the
  script reports back.
- **Nothing lands under `art/` until you commit.** The upload is stashed in `.art-inbox/` while you
  look at it, so the watcher does not fire and the page does not reload out from under the decision.

**A clip can be built from several sheets.** If the clip you pick already has frames, the page offers
*"Add these frames to it"* instead of refusing. Benjamin's celebration is two generations joined this
way: a sword-raise and a back-flip, cut separately and appended.

New frames always land at the **end**, and then you order them in the anim lab — it can move,
duplicate and disable frames while the clip plays, which is a far better place to decide order than a
file listing. The order is stored as `order` in `<name>.anim.json` and indexes source frames, so
appending never disturbs an order already set. Benjamin's celebration is `[4,5,6,7,0,1,2,3]`: the
flip, then the raise.

Frames from different sheets are rarely the same size. They are padded to the largest, bottom-centred,
and the pack says which files it padded — nudge those with the lab's per-frame `dx`/`dy` if they land
off their mark.

Everything below is the same job from a terminal.

## Splitting sheets

```
npm run art:split -- art/actors/benjamin/animations/benjamin_idle_2_3x1.png --write
npm run art:split -- --all benjamin --write        # every sheet this actor has
```

Dry-run by default; `--remove` deletes the sheet once its frames are written.

| flag | |
| --- | --- |
| `--grid 4x1` | The frame grid, instead of reading it off the filename. |
| `--clip <name>` | Which clip the frames belong to, instead of reading it off the filename. |
| `--out <dir>` | Where the clip folder goes. Lets a sheet be split out of a staging folder. |
| `--append` | Add to a clip that already has frames, continuing the numbering. |
| `--json` | Print the cut as data and write nothing. What the upload page previews with. |

> **`--grid` and `--remove` together were a trap, and it cost a source file.** `--grid` reached the
> analysis path only, so a sheet could be previewed as 4×1 and then written as 2×1 — after which
> `--remove` deleted the original. Fixed; `--grid` now reaches the cut. Worth knowing because the
> recovery is not obvious: the frames still hold every pixel, so the sheet can be rebuilt by
> concatenating them.

It uses the packer's own `split_sheet`, so the split is the cut the packer would have made —
**verified lossless**: content boxes come out pixel-identical, with about 1.4% of pixels differing at
a maximum delta of 29/255 from resampling a padded image.

### When a seam cuts through a drawing

Every split reports seams that cut through ink:

```
! benjamin_idle_3_2x1.png: seam 1 (x=887) cuts through 92 px of drawing
  — frames 1 and 2 will each hold part of the other (pass --bleed …)
```

Sometimes there is **no correct cut**. On `idle_3` the first figure's sword tip crosses the seam
*and* the second figure's scarf reaches back past it, so the two silhouettes are one continuous run
of ink — no x keeps both figures whole, and no cleverness finds one, because the information is not
in the image.

```
npm run art:split -- <sheet> --bleed --write        # 10% of a cell either side
npm run art:split -- <sheet> --bleed 120 --write    # or an explicit margin
```

`--bleed` cuts every frame wide so each keeps its whole drawing, then **erases the neighbour's slice
automatically** when that slice is a separate connected drawing — which it usually is. When the two
drawings genuinely touch it says so and leaves them for hand editing rather than guessing.

## Repairing a sheet

```
python scripts/respace_sheet.py <sheet> [--write]
```

For a sheet whose drawings overrun their cells: it finds the drawings as connected components rather
than trusting the grid, drops stray specks, and re-lays them out with room. It preserves each frame's
horizontal drift, because that drift is motion — `normalise` keeps one foot point per *clip*, not per
frame, deliberately.

Use it when the art is crowded; use `--bleed` when a drawing overlaps its neighbour.

---

## The animation lab

`?dev=1#anim`, or **▶ Anim lab** on the dev badge. Swap character and clip, scrub frames, reorder,
duplicate (`⧉`) and disable them, tune placement, pose and timing live, and **Save** — which writes
back to `art/actors/<name>/<name>.anim.json` through a dev-only endpoint.

Also there:

- **Idle tuning.** An alternate idle (`idle_2` and up) gets a *Cuts in* slider — how often it
  interrupts the main idle, in loops per hundred, with **0 meaning off**. And a **ghost option for
  frame 1 of the main idle**, which is the thing an alternate has to match: it cuts into the base
  mid-fight and hands straight back, so any drift in scale or footing shows as a twitch at both seams.

  Matching a still only gets the pose right. To judge the *motion*, set Playback to
  **Seam — the main idle, then this, over and over**: it plays `idle` once, the alternate once, and
  repeats, so both joins go past on a loop. It is the only playback that shows what a battle shows —
  looping the alternate on its own shows a join it never actually makes, itself to itself. The main
  idle plays at its own saved speed, not at whatever the speed slider is set to, so the seam is the
  real one. The mode is offered only on `idle_2` and up.

- **A practice dummy** to land effects on. A `caster` impact plays on the performer instead, in a box
  the dummy's size, and those previews are not gated on the dummy being switched on.
- **The damage-split editor**, writing `src/engine/hitSplits.ts`.
- `pain` and `death` appear as one-frame clips so they can be tuned like anything else.

Two indices that are easy to confuse:

- `frames` is indexed by **source frame**, so a hold or a nudge stays attached to the drawing it was
  authored for when `order` is rearranged underneath it.
- `impacts[].frame` is a **step position** in the played timeline, so two copies of one drawing can
  carry different effects.

---

## The two battle layouts

`▣ Cinema` in the battle's top bar swaps between them, and the choice sticks. **Docked** puts the
stage over a 37vh band of panels; **cinema** gives the window to the stage and floats them.

They share every component, so a change to the tray or the sheet lands in both — but they are placed
by different CSS, so **check both before calling a layout change done**. Cinema rules are scoped
`.battle.cinema`, and several of them override a docked rule that is load-bearing there (the dice
container's fixed three-die width, for one). Reasoning is in `README.md` §"Two layouts".

## Dev mode

The floating **Dev** badge toggles it, on every screen, and it sticks (localStorage) — `?dev=1` alone
was too easy to lose. It reveals the anim lab, the stage lab, stage/party-level pickers and Reset.
The distinction it draws is deliberate: **live testing** is what a player meets; **dev testing** is
under parameters you chose.

---

## Where to look when something is odd

| symptom | look at |
| --- | --- |
| A sliver of the next frame shows, but the source PNGs are clean | Not the cut. Packed strips need their 2px gutter (`FRAME_GUTTER`) — without it a fractional scale samples across the frame boundary. Re-pack. |
| A new animation "does not show up" | Is it in `animations/`? `art/samples/` is never packed. |
| Frames sliced wrong, or the page eats memory | Missing `_NxM` on a sheet. See the table above. |
| A frame contains part of the one before it | A seam cuts through a drawing — `--bleed`. |
| The lab reloads and loses your place | Something under `art/` changed. A no-op pack no longer reloads. |
| An ability animates as the wrong one | A slot-named sheet after a kit reorder. Check the lab's `ability_N — Name` label. |
| The packer refuses an actor | `<name>.pack.json` was wiped. Delete `public/sprites/<name>/` and re-run. |

More in `README.md` §11.
