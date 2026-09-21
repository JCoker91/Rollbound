# Stagebound

A web-based idle gacha RPG set in an interdimensional theater. Vite + React + TypeScript, no game
engine. Characters are "Performers"; battles are dice-driven and turn-based.

## Commands

```
npm run art        what art each character has, and the filename for what is missing
npm run art:split -- <sheet|--all actor> [--write] [--remove] [--bleed [px|%]]   sheet -> frames
npm run dev        vite dev server
npm run sim        500 headless battles, ability-usage histogram
npm run play       headless CLI battle
npm run typecheck  tsc --noEmit
npm run build      production build — ALSO RUNS THE ART PIPELINE (~10s)
python scripts/pack_sprites.py [--only <actor>]    art/ -> public/
```

## The documents are the source of truth

Read these before designing anything; they carry the reasoning, not just the rules.

| | |
| --- | --- |
| `documents/DEV_TOOLBOX.md` | **Every command and tool**, and the traps around them. Start here for "how do I…" |
| `documents/README.md` | Architecture, systems, **§8 current state**, **§10 roadmap**, **§11 gotchas** |
| `documents/BATTLE_DESIGN.md` | The target battle system. **§8 has the finished Performer kits** |
| `documents/SPRITE_STYLE_GUIDE.md` | Art spec — **pixel-art era, superseded by the paper art**. Its banner lists what the pipeline still enforces; the rest is history |
| `documents/STAGEBOUND_STORY_REFERENCE.md` | Setting and characters |

## Architecture rules

- **The battle screen has TWO layouts** — the dock, and `cinema` (a toggle in the top bar). Same
  components, placed differently; cinema also relaxes the dice-first rule so an ability can be
  chosen before it is paid for. Read `README.md` §"Two layouts" before changing anything in
  `BattleScreen.tsx` or the `.battle` CSS, and check both before calling a change done.

- **`src/engine/` never imports React.** It is pure and runs headless (`npm run sim` depends on it).
- **Rules text is generated** from ability data in `describe.ts`, so a sheet can never claim
  something the engine does not do. Never hand-write ability descriptions.
- **`scripts/pack_sprites.py` owns `public/`.** `art/` is the only upload target; `public/` is
  derived and safe to delete. Never hand-place files there.
- **Content lives in `src/engine/content.ts`** — one roster array. Comments there explain *why* each
  number is what it is; keep that up when you change one.

## Working style this project expects

- **Measure, don't assert.** Numbers in these docs came from running the engine. Write a throwaway
  script in `.tmp/` and delete it rather than reasoning about balance in your head.
- **Scarcity is not balance evidence.** "No other character has this" says what has not been built
  yet — the roster is mid-construction. Judge an ability against the design space for its role.
- **The simulator is not a balance authority.** 100% win rate at ~1.8 turns is an AI playing a game
  no human plays against enemies with one ability each. It is a crash test, not a tuning tool.
- Comments in this codebase are long and explain reasoning, including rejected alternatives. Match
  that register; a comment that only restates the code is noise here.

## Traps that have cost real time

- **`commitAction` does not chain.** The chain-aware path is `planAction` → `commitNext`.
- **Windows + Git Bash.** Python edit scripts must pass `encoding='utf-8'` to *both* `read_text` and
  `write_text` — omitting it truncates the file mid-write. Assert match counts before writing.
- **`npm run build` re-runs the art pipeline.** It no longer leaves re-encode churn — every write
  goes through `write_if_changed` / `save_if_changed`, so a pack that finds nothing to do touches
  no file at all. Anything `git status` lists after a build is a real change.
- **Replacing an actor's art folder wipes `<name>.pack.json`**, so the packer refuses with "not
  written by this script". Recovery: delete `public/sprites/<name>/` and re-run.
- **Clips come only from `art/actors/<name>/animations/`.** A sheet left in `art/samples/` is never
  packed and never appears in the lab — that is the usual reason a new animation "does not show up".
  Updating one is **overwrite the file at that path, same name**; the dev server repacks and reloads
  by itself, and says `nothing changed — no reload` when a pack found nothing to do.
- **A clip can be a FOLDER of frames**, and that is now the preferred input:
  `animations/idle_2/idle_2_01.png…` is a three-frame idle. No grid to infer and no cut to make, so
  neither the `_NxM` trap nor cell bleed can happen. A folder beats a same-named sheet. Split an
  existing sheet with `npm run art:split` — verified lossless: content boxes come out pixel-identical
  and only edge antialiasing moves. Index frames **zero-padded**, or `_10` sorts before `_2`.
- **When drawings overlap a seam there is no correct cut** — the split reports which seams cut
  through ink. `--bleed [px|%]` (default 10% of a cell) cuts every frame wide so each keeps its whole
  drawing, then erases the neighbour's slice automatically when it is a separate connected component
  (which it usually is). When the drawings genuinely touch it says so and leaves them for hand
  editing, rather than guessing.
- **Always put `_NxM` in a multi-frame sheet's name.** Without it the count is `gcd(width, height)`
  assuming square cells: a 2048×768 four-frame sheet reads as 8×3 = 24, and a 2876×768 one has a gcd
  of 4 and reads as **138,048 frames** — which the packer will try to cut and the browser will try
  to animate, eating the machine. The packer now **refuses** any suffix-less sheet inferring more
  than one row or more than `MAX_INFERRED_COLS` frames, and names the rename in its message.
  `npm run art` prints the exact filename for anything missing.
- **A sheet whose drawings overrun their cells** is repairable without regenerating:
  `python scripts/respace_sheet.py <sheet> [--write]` re-lays them out, preserving each frame's
  horizontal drift (which is motion) and dropping stray specks.
- More in `README.md` §11 — read it before debugging anything odd.

## Where things stand

**Art:** Benjamin is complete (15/15 clips — `npm run art` for the live picture); everyone else is at
0–1. His folder is the reference for what finished looks like. The art pipeline got a lot of work
this session — read `DEV_TOOLBOX.md` before touching art or adding a sheet.

Kits finished: **Benjamin, Rebar, Maxine, Kael.** Unbuilt: Aethis, Brax, Veyra (placeholders — do
not tune against them). **Every star tree is placeholder content**, being redone as a batch after
the kits.

Each finished kit paid for a mechanic on its way in — modifiers and turn phases (Benjamin),
statuses and positioning (Rebar), conditional power (Maxine), taunt (Kael). Keep that going: let the
next character specify the next mechanic rather than authoring it against what already exists.

The bottleneck is **enemy kits**: most defensive mechanics are currently unevaluable because mobs
have one weak attack each. See README §10.
