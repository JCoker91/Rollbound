# Stagebound

A web-based idle gacha RPG set in an interdimensional theater. Vite + React + TypeScript, no game
engine. Characters are "Performers"; battles are dice-driven and turn-based.

## Commands

```
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
| `documents/README.md` | Architecture, systems, **§8 current state**, **§10 roadmap**, **§11 gotchas** |
| `documents/BATTLE_DESIGN.md` | The target battle system. **§8 has the finished Performer kits** |
| `documents/SPRITE_STYLE_GUIDE.md` | Art spec. Currently **v3.0, 256×256 canvas** |
| `documents/STAGEBOUND_STORY_REFERENCE.md` | Setting and characters |

## Architecture rules

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
- **`npm run build` re-runs the art pipeline** and can leave 1-byte PNG re-encode churn in
  `public/sprites/`. Check `git status` after building; revert if the pixels are identical.
- **Replacing an actor's art folder wipes `<name>.pack.json`**, so the packer refuses with "not
  written by this script". Recovery: delete `public/sprites/<name>/` and re-run.
- More in `README.md` §11 — read it before debugging anything odd.

## Where things stand

Kits finished: **Benjamin, Rebar, Maxine, Kael.** Unbuilt: Aethis, Brax, Veyra (placeholders — do
not tune against them). **Every star tree is placeholder content**, being redone as a batch after
the kits.

Each finished kit paid for a mechanic on its way in — modifiers and turn phases (Benjamin),
statuses and positioning (Rebar), conditional power (Maxine), taunt (Kael). Keep that going: let the
next character specify the next mechanic rather than authoring it against what already exists.

The bottleneck is **enemy kits**: most defensive mechanics are currently unevaluable because mobs
have one weak attack each. See README §10.
