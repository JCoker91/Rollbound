# Stagebound

A web-based idle gacha RPG set inside an impossible interdimensional theater. You are the
**Co-Director**: you assemble a Cast of Performers pulled from countless realms and direct them
through dice-driven, turn-based Performances.

This document is a handoff. It covers what exists, why it was built that way, and what is planned.
Read **§6 Design decisions** and **§11 Gotchas** before changing anything — several choices look
arbitrary but were made to fix specific, observed problems.

Companion documents:

- `STAGEBOUND_STORY_REFERENCE.md` — premise, tone, terminology, and the long-term mystery.
- `SPRITE_STYLE_GUIDE.md` — the art standard every sprite is generated against. Non-negotiable
  for anything that ships.

---

## 1. The game

**Idle layer.** You accrue gold, summon shards, and character XP over real time, capped at 8 hours
offline. Clearing stages raises the rate. This is the loop the game is built around.

**Battle layer.** A side-view, Final Fantasy–style turn-based battler: five Performers on the left
against up to seven enemies on the right. Each turn you roll **5d6 into a shared pool**, and
abilities cost exact dice sums. A 9-cost ability needs two dice, which means one teammate does not
act. **Choosing who sits out is the core decision.**

**Progression.** Cast new Performers, spend duplicates on a branching star tree, spend XP on levels
(gated so the whole Cast must keep pace), and buy temporary upgrades mid-Performance.

### Naming

The game was **Dice Legends**, then **Rollbound**, now **Stagebound**. `save.ts` carries a
`LEGACY_KEYS` chain so a rename never wipes an existing profile.

Story terminology (Performer, Cast, Casting, Production/Act/Scene) is used in **player-facing text**.
Code keeps plain RPG names — `ROSTER`, `CharacterDef`, `battle` — because, per the story reference,
"terminology should support clarity first." The one place the metaphor reached the filesystem is
`art/actors/`, which is fine: it is a folder of characters.

### Platform decision

Web only, no app stores. Vite + React + TypeScript, no game engine. The battle engine is pure
TypeScript with **zero rendering dependencies**, which is what lets the same code resolve idle
stages headlessly and run balance simulations over thousands of battles.

---

## 2. Quick start

Requires **Node 22.18+** — the CLI tools run TypeScript directly via `--experimental-strip-types`,
no build step. Python 3 with Pillow for the art scripts.

```bash
npm install
npm run dev          # usually http://localhost:5173
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server with hot reload |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the built output |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run play [seed]` | Watch one full AI-vs-AI battle in the terminal |
| `npm run sim [n]` | Balance report over N simulated battles |
| `python scripts/pack_sprites.py` | Publish `art/` → `public/`; regenerate sprite metrics |
| `python scripts/make_favicon.py` | Regenerate the site icon (SVG + ICO + apple-touch) |

`npm run sim` is the most useful tool in the repo. It has caught every balance and AI bug so far.

### Dev tools

The game ships as it is played — no authoring UI visible. Tools are hidden, not deleted.

On the Vite dev server a small dashed **▶ Dev** button sits in the header. It turns dev mode on and
opens the animation lab; it then reads **Exit dev** and returns you to the clean game.

Everything gates on **`?dev=1`** in the query string, *before* the `#` the hub routes on:

```
http://localhost:5173/?dev=1#anim
```

With it set, an **▶ Anim** tab appears in the nav and the battle screen's authoring controls return.

Two deliberate choices:

- **The gate is a query param, not `import.meta.env.DEV`.** The game is played through `npm run
  dev`, so keying off build mode would show the tools exactly when you are trying to play — and it
  would make the tools unreachable against a production build, which is where some bugs only appear.
- **The button is `import.meta.env.DEV`**, necessarily: a way *in* has to exist before the param is
  set. It is stripped from production builds; the gate it opens is not.

`DEV_TOOLS` is read once at module load, so the button performs a full navigation rather than a hash
change.

---

## 3. Repo layout

```
src/
  engine/          Pure game logic. No React, no DOM, no rendering.
    types.ts       Shared types: Ability, CharacterDef, Unit, Passive, StarNode, SpriteSheet
    rng.ts         Seeded mulberry32. Every battle is reproducible from its seed.
    formation.ts   Slots, depth reach, AoE distance. Replaced the old tile grid.
    elements.ts    Element matchup wheel
    combat.ts      Damage/heal formulas, targeting, passives, AI action scoring
    allocate.ts    Dice allocation solver — the heart of the game
    battle.ts      Battle state, turn flow, enemy AI, telegraphs, in-battle upgrades
    content.ts     ALL game content: roster, enemies, encounters, star trees
    describe.ts    Generates rules text from ability data
    idle.ts        Idle accrual maths (pure, clock passed in)
    save.ts        localStorage persistence
    summon.ts      Gacha rates and rolling
    stars.ts       Star tree costs and effect application
    levels.ts      XP curve, level cap rule, stat growth
    sprites.generated.ts   GENERATED by pack_sprites.py — do not hand-edit
  web/
    App.tsx        Hub router, profile state, dev entry
    BattleScreen.tsx  The entire battle UI
    Avatar.tsx     SVG role badges and creature glyphs
    Figure.tsx     Character renderer for menus
    clipAnimation.ts  Sprite-strip keyframe generation and clip geometry
    animationData.ts  Loads the authored art/actors/*/*.anim.json settings
    screens/       Home, Characters, Summon, Inventory, Events, AnimationLab
    styles.css     Battle screen styles
    hub.css        Hub styles
    stars.css      Star tree + levelling styles
  cli/
    play.ts        Terminal battle viewer
    sim.ts         Balance simulator
scripts/
  pack_sprites.py  Art pipeline: art/ → public/, plus generated metrics
  make_favicon.py  Site icon: gold d6 showing the five face
vite.config.ts     Build config + the dev-only animation-save endpoint
art/               THE ONLY PLACE ART IS UPLOADED
  actors/<name>/   One Performer: sprite set, icon, animations/,
                   <name>.pack.json (generated), <name>.anim.json (authored)
  background/      Scenery, mirrored verbatim into public/background/
  objects/         Props (not yet consumed)
  enemies/         Antagonists (not yet consumed)
public/            ENTIRELY GENERATED — see below
documents/
  README.md                    This file
  SPRITE_STYLE_GUIDE.md        The art standard
  STAGEBOUND_STORY_REFERENCE.md  Premise, tone, terminology
```

### `art/` in, `public/` out

**`art/` is the only folder art is uploaded to. `public/` is derived and owned by the pipeline.**
Deleting `public/` should cost nothing but a re-run of `pack_sprites.py`.

That split is enforced, not just documented:

- Each actor carries a **`<name>.pack.json`** manifest beside their art, holding an output
  fingerprint plus the packed clip catalogue. One file per actor rather than shared registries at
  the top of `art/` — a shared file couples actors that have nothing to do with each other, and
  regenerating Benjamin should not rewrite a file that also describes Maxine. The folder is the
  complete, portable unit.
- The fingerprint is a **guard against regenerating over uploaded art**. This pipeline once read and
  wrote the same folder, and a run destroyed a freshly uploaded sprite by regenerating it from stale
  sources. Comparing mtimes cannot catch that — after any normal run the output is always newer.
- A complete run **prunes** `public/sprites/` and `public/background/` of anything it did not
  produce. Pruning is skipped when any actor was skipped, so a partial run cannot delete a
  skipped actor's output.

The favicon files are the one hand-managed exception, and they are generated too — by
`make_favicon.py`.

---

## 4. Architecture principles

These three separations are load-bearing. Breaking them will hurt.

**1. The engine never imports React.** Everything in `src/engine/` is pure. This is why `npm run sim`
can run thousands of battles in seconds, and why a server can later resolve idle stage clears with
the exact same code.

**2. Progression is folded into character sheets once, before a battle starts.**

```ts
applyStars(applyLevel(def, level), starProgress)  // → a plain CharacterDef
```

Nothing in the damage formula, the AI, or the dice allocator knows that levels or stars exist. They
see ordinary numbers. Order matters: levels first, so a star's percentage is of the levelled stat
rather than the base sheet.

**3. Rules text is generated from ability data, never hand-written.** `describe.ts` turns
`{ power: 1.4, range: 3, aoeRadius: 2 }` into prose. Retune a number and the text follows. An
ability can never claim something it does not do.

A fourth, learned the hard way: **measurements about art are generated, never hand-copied.** A
replaced Kael sheet once kept the old aspect ratio in `content.ts` and rendered 22% too wide.
`sprites.generated.ts` now carries every measured value.

---

## 5. Systems

### 5.1 The dice economy

Five d6 into a shared pool each turn. Abilities cost an exact sum; wildcards take any single die.
**This survived the battle-system rewrite untouched** — it is the game's identity and is entirely
format-independent.

**Simulation over all 7,776 rolls produced two findings that shaped the whole design:**

- **Low costs are the least reliable.** A 1-cost needs a literal `1` on some die — 59.8% of rolls.
  A 9-cost can be assembled dozens of ways — 90.7%. Reliability peaks at 6 (97.4%) and falls off in
  *both* directions. Costs 4–6 are the safe band; 1–2 and 13+ are fragile edges to be used as
  deliberate drawbacks.
- **Cost collision is the real balance lever.** Teams whose ability costs overlap starve each other
  for dice; teams with spread costs act far more often. **Cost spread earns a seat as surely as raw
  stats do** — Rebar's 2/6/11 barely overlaps anyone, so he acts on turns nobody else can.

**Every character has a wildcard "basic"** costing any single die. This removed dead rolls entirely
without removing the tension. The relationship is exact:

```
characters acting = 5 − Σ (dice each ability uses − 1)
```

Every die an ability consumes beyond its first benches exactly one teammate.

### 5.2 Formation and combat

The tile grid is gone. There is **no movement, no terrain, and no line of sight** — a Performer
occupies one fixed slot for the whole battle.

**Slots carry two coordinate systems, deliberately kept apart:**

| | Used by | Purpose |
| --- | --- | --- |
| `col` / `row` | The rules | Integer formation grid |
| `xPct` / `yPct` | The renderer | Where to draw on the backdrop |

Splitting them lets the art be arranged for stage perspective — staggered, foreshortened, nudged
onto a painted floor — without the rules caring, and lets the rules be reasoned about as a small
tidy grid without the art being forced onto one.

Party: 5 slots over 2 columns. Enemies: 7 slots over 3 columns in a 2 / 3 / 2 pattern.

> **The rules grid is packed TIGHT while the draw positions are spread out.** A first attempt
> staggered the rules grid to match the art, every slot ended up 2 apart, and a radius-1 AoE could
> only ever hit its own target — War Cry and Hallowed Grove fell to 0.1% usage in simulation.

**`range` means depth reach**, not distance: how many enemy ranks an ability can reach into,
counting **only columns that still hold someone alive**. Counting occupied columns is what stops
melee being locked out — clear the front rank and the next becomes the front. This is what makes
formation worth arranging: a boss behind two ranks of adds cannot be touched by a melee basic until
the adds are gone. Support abilities are exempt; the party is two columns deep and gating heals on
depth would add fiddle without adding a decision.

**`aoeRadius`** is manhattan distance in formation slots. Radius 1 catches a target and its
immediate neighbours; radius 2 reaches most of a formation and belongs only on the biggest abilities.

- **Elements**: fire → wind → earth → water → fire, plus light ↔ dark (mutual). 1.5× strong,
  0.75× resisted.
- **Damage**: `ATK × power × (100 / (100 + DEF)) × element`, then passive modifiers.

### 5.3 Enemies are NOT built like player characters

This is the single most important content distinction.

- **Enemies roll no dice.** Every enemy acts every turn. They pick the highest-priority ability that
  is off cooldown and has a target. Deliberately predictable — you should be able to look at the
  stage and know what is coming.
- Because they act every phase instead of ~3.6 of 5, their per-hit numbers are **roughly half** a
  player character's.
- **Trash mobs** get one ability and usually no passive. **Elites** get passives. **Bosses** get
  several abilities on cooldowns with priorities, plus multiple passives.
- **Telegraphed attacks**: an ability with `telegraph: 1` announces its target area this turn and
  lands at the start of its next phase. The danger zone pulses during your turn.

Passives available: `regen`, `thorns`, `resilient`, `frenzy`, `lifesteal`, `swift`.

### 5.4 In-battle upgrades

Three tiers per player character at **6 / 8 / 12 dice**. Each grants +10% cumulative stats and
unlocks a passive. Costs the character's action, same as casting. The max-HP gain is granted as
healing, so upgrading mid-fight does not leave you at a smaller fraction of a bigger bar.

### 5.5 Star tree (permanent, spends duplicates)

Five rungs shaped **choice → converge → choice → converge → choice**. Costs escalate 1, 2, 3, 4, 5
duplicates — 15 total, so 16 pulls of a character maxes them.

The converging rungs (★2, ★4) are deliberately plain stat gains: they are where the branches rejoin,
so they cannot carry an identity-defining effect only half of players would own. All specialisation
lives on the three choice rungs.

Effects are data (`{ kind: 'stat', stat: 'attack', percent: 9 }`), supporting stat percentages,
passives, and ability modification (power / range / dice cost).

**Spare duplicates are derived, never stored**: `copies − 1 − starSpend(level)`. A save cannot drift
into a state where spares and star level disagree.

### 5.6 Levels (spends XP)

Shared XP pool; you choose who receives it. Growth is additive on the base sheet (+8%/level).

**The cap rule**: the ceiling is set by your **fifth-highest** character, rounded up to the next
multiple of 5.

```
levels [25,25,25,25,20] → cap 25    ← the 20 blocks everyone
levels [25,25,25,25,25] → cap 30
```

Reaching level 26 means dragging five characters to 25 first. This is what keeps a bench worth
investing in.

### 5.7 Idle and summoning

- `ratesFor(stage)` → gold/shards/XP per minute, scaling with stage. Capped at 8 hours offline.
- `accrued()` and `claim()` are **pure and take `now` as an argument** — they never read the clock.
  Deliberate, so the same code can move server-side, where the timestamp is the one thing a client
  must never own.
- Summon rates: **4% / 26% / 70%** for 3★/2★/1★. 30 shards per pull, 270 for ten. The rate table is
  printed on the page from the same constants the roll uses, so displayed odds cannot drift from
  applied odds.

---

## 6. Design decisions worth knowing

Non-obvious choices, each made to fix a real observed problem.

| Decision | Why |
| --- | --- |
| **Side-view battler replaced tile tactics** | Less to build and maintain, it suits the art (figures draw 2–3× larger, where the HQ renders win), and the backdrops already assumed a stage. The dice economy — the actual identity — was untouched by the change. |
| `range` counts **occupied** columns, not column indices | Otherwise clearing the front rank leaves a melee character unable to reach anything. |
| Rules coordinates packed tight, draw coordinates spread | Matching the rules grid to the staggered art made every slot 2 apart and killed radius-1 AoE. |
| Enemy AI advances every turn regardless of whether it acted | Universal wildcards meant a unit could self-buff forever without closing. Gating advance on "did nothing" left whole teams idle until the turn cap — **78% draws**. |
| Buff scoring estimates *actual added damage*, not a flat multiplier | A flat `power × 2 × targets` made a 5-target +30 ATK buff score 300, beating almost every attack. The AI turtled and 25% of battles timed out. |
| Sprites are positioned by a measured **foot anchor**, not centred | An outstretched weapon drags the image's centre sideways; centring puts the character off their mark. |
| Damage reactions diff HP rather than parse the log | Catches direct hits, AoE splash, thorns, lifesteal and regen in one place, with exact amounts, and needs no name matching. |
| Spent characters are **darkened**, not faded | Transparency let the backdrop show through and they became hard to find. |
| Sprite sizing derives from the 64px native grid | The grid is the one measurement the whole roster shares, so the art itself encodes relative stature and one global factor scales everyone. |

---

## 7. Content authoring

### Characters

All content lives in `src/engine/content.ts`. A character needs identity (id, name, rarity, element,
role), stats (maxHp, attack, defense), 3–4 abilities including one `wildcard: true` basic, 3 upgrade
tiers, and a `starTree`.

**When designing a kit, check cost coverage across the whole roster.** Current spread:

```
 1: Aethis            2: Kael, Rebar     3: Benjamin, Maxine   4: Kael
 5: Benjamin, Aethis  6: Rebar           7: Kael, Maxine       8: Aethis
 9: Benjamin         10: Maxine         11: Rebar
```

Every cost has at most two claimants, and the measured economy tracks it: filling the empty 1 and 8
slots with Aethis took `acting/phase` from 2.98 to 3.26, and removing approach turns in the
side-view rewrite took it to **3.60 of 5**.

### Encounters

An `EncounterDef` is a backdrop plus party and enemy slot arrays. `STANDARD_PARTY_SLOTS` and
`STANDARD_ENEMY_SLOTS` in `formation.ts` cover the default 5-v-7 stage; a Production wanting a
different arrangement supplies its own.

### Art pipeline

Authored against **`SPRITE_STYLE_GUIDE.md`**, which is the source of truth. Read §10 of it before
generating any animation — that section exists because of the bugs listed below.

**Stills.** Four files per Performer in `art/actors/<name>/`. `_LQ` is the *measurement* reference
(stature, ground line, audit); `_HQ` is what actually **ships**. Size and pixels are separate
questions: how big a character is comes from the shared 64px grid, which pixels get drawn comes from
the best available render.

**Animations.** Sheets go in `art/actors/<name>/animations/<name>_<clip>.png`. The frame grid is
inferred from the image's own dimensions — gcd of width and height, read row-major — so `7680×640`
is 12×1 and `1448×1086` is 4×3.

Four things the pipeline does, each earned:

1. **Clips are normalised into one coordinate space first.** *Sheets are not delivered at a common
   scale, and this is the trap.* Maxine's idle arrived as 640px cells holding a 584px figure; her
   celebration as 362px cells holding a 338px one — the same character drawn 1.73× smaller. Both
   fill ~92% of their own cell, so **neither looks wrong** until they are measured against each
   other. `normalise()` scales every clip to the reference idle and aligns them on a shared **foot
   point** (x = centre of the lowest content band, y = the ground line). Anchoring on the feet rather
   than the image centre lets a wider or taller clip grow away from the character instead of dragging
   them off their mark. The factor is reported as `normalised`; anything far from 1.0 means the art
   disagrees, and re-exporting beats resampling.
2. **One crop box per CHARACTER, not per clip.** Per-clip boxes look right in isolation and break the
   moment two clips play back to back: a clip containing a jump needs a taller box for the airborne
   frames, so the celebration packed at aspect 1.0 against the idle's 0.81 — drawn at one height her
   body came out 19% shorter and every hand-off popped. Sharing the box makes a jump read as a jump.
3. **Only looping clips are trimmed to whole cycles**, detected by frame self-similarity. A clip
   loops by name prefix (`idle`, `walk`, `run`, `float`) or the `_ending` suffix. Cycle-trimming a
   one-shot would cut its landing off. Two different things get trimmed and they need different
   evidence: a *fractional cycle* is checked over at least two frame pairs, because with one pair
   the "average" is a single comparison and a coincidence reads as a cycle; a *duplicated final
   frame* is inherently one pair, so it is measured against the *closest* two consecutive frames
   rather than the average gap. The average will not do — Benjamin's attack ends nearer its first
   frame (0.20 of the mean gap) than Maxine's genuinely duplicated ending does (0.25), because a
   one-shot is *meant* to finish where it started. Against the minimum they separate 0.27 to 1.26.
4. **A one-shot settles into a held pose, not necessarily the idle.** `<clip>_ending` is a looping
   sheet the clip hands off to, resolved by suffix into `settlesInto` with no configuration — so a
   Performer who takes a bow keeps holding it. Falls back to `idle` when no ending was drawn.
5. **A flat background is keyed, unmixed, and its trapped pockets cleared.** Sheets sometimes arrive
   on flat grey instead of transparent. Flood-filling from the corners is only the first third of
   the job, and the other two thirds are what produced a visible grey outline on Maxine's ending:
   the *anti-aliased ring* where the figure blends into the backdrop survives the fill at full
   opacity with the backdrop's colour still in it, and *enclosed pockets* — the gap between a raised
   arm and the body, the hole through a staff's ornament — are walled off from every corner and stay
   opaque grey. Widening the fill's tolerance fixes neither; it just eats real edge detail. Since the
   backdrop colour is known exactly, `unmatte()` solves `C = a·F + (1-a)·B` for each fringe pixel
   (estimating `F` by pushing interior colours outward), restoring the soft edge instead of replacing
   it with a hard one; pockets are cleared by a tight colour match plus a morphological opening, which
   is safe *because* the backdrop is flat — her sheet had 286k pixels at exactly the backdrop colour
   and not one within 10 of it. Measured on frame 0: fringe 3,530 → 354, pockets 385 → 39, and 2,109
   pixels of genuine anti-aliasing recovered. Sheets that already carry real alpha skip all of this.
6. **The box is not the character — size by the figure.** The box is as tall as the highest jump and
   as wide as the widest swing, so the figure fills only part of it, and *how much changes whenever a
   clip is added*. Sizing by box height made a still at 132px stand taller than the same character
   animated at 132px, and adding Benjamin's attack sheet shrank his idle by 12%. `restFill` (the
   fraction the **median** resting frame occupies — median, because a bounce apex is not how tall
   someone is) and `footPad` fix it: `clipBox()` divides by `restFill` and pushes down by `footPad`.

**Playback is generated keyframes, not `steps()`.** `clipAnimation.ts` emits one `step-end` stop per
frame, keeping the hard frame cut while making both the timing and the position of each frame
addressable. Untuned clips reproduce `steps()` exactly.

**Authored settings live in `art/actors/<name>/<name>.anim.json`** — beside the art, beside the
generated `<name>.pack.json`, and never written by the pack script, so a re-pack cannot erase a
judgement call. One file per actor for the same reason the manifest is: tuning Maxine should not
rewrite a file that also describes Benjamin.

```json
{
  "celebration": {
    "placement": { "scale": 1.04, "dy": 2 },
    "frames": [{}, { "hold": 2.5 }],
    "order": [1, 0, 2, 4, 5]
  }
}
```

| Key | Scope | Meaning |
| --- | --- | --- |
| `placement` | Whole clip | `scale`, `dx`, `dy` against the foot anchor |
| `frames` | Per frame | `hold` weight, `dx`, `dy` |
| `order` | Whole clip | Playback sequence; omit for natural order |

Offsets are percentages, so corrections hold at any render size. `hold` is a **weight**, not a
duration, so the speed control still means "how long a plain frame lasts."

> **`frames` is indexed by SOURCE frame, not by playback position.** That is what lets a hold or a
> nudge stay attached to the drawing it was authored for when `order` is rearranged underneath it.
> A frame missing from `order` is disabled — still in the image, never played — which beats
> re-exporting a sheet to drop one bad frame.

**The animation lab** (`?dev=1#anim`, or the **▶ Dev** button) is where all of this is judged and
edited: swap character and clip, scrub frames by hand, play a one-shot into whatever it settles
into, ghost the still behind the clip to line up the stance, reorder and disable frames, tune
placement and timing live, download a single frame as PNG — and **Save**, which writes the JSON
through a dev-only endpoint (`vite.config.ts`). A browser cannot write to the repo and the
alternatives are both bad: downloading leaves you to move the file by hand, and copy-paste makes
every small nudge a chore. The endpoint is `apply: 'serve'` so it never exists in a build, and it
still validates its inputs — a dev server is reachable from the network if anyone runs `--host`.

### Scenery

Anything in `art/background/` is mirrored verbatim into `public/background/` — backdrops are painted
at final size and the stage scales them with CSS, so there is nothing to pack. Currently
`battle_screens/battle_screen_1.png` (Performances) and `screens/main_screen_stage.png` (the hub's
idle scene).

---

## 8. Current state

**Balance — 200 simulated battles, *Curtain Call*:**

```
player win rate : 100.0%   (draws 0.0%)
avg turns       : 14.5
avg survivors   : 4.92 / 5
avg acting/phase: 3.60 / 5
```

**Zero losses.** In-battle upgrades, stars, levels and the side-view rewrite have all landed on top
of enemies tuned before any of them existed. **An enemy difficulty pass is the most overdue work in
the project** — the simulator can no longer discriminate difficulty at all.

**Cast** (all five have sprites): Benjamin (3★ fire blade), Kael (2★ wind blade), Rebar (2★ light
shield), Maxine (3★ water staff, artillery), Aethis (1★ earth staff, healer).

**Animations:** Benjamin — idle, attack. Maxine — idle, idle_2, celebration + celebration_ending.
Everyone else is a static still.

**Enemies:** Ash Husk, Bog Wisp, Crag Golem, Pale Shade, Fallen Seraph (boss, telegraphs Judgment).
All still render as SVG role badges — **no enemy art exists yet**; `art/enemies/` is empty.

**Encounters:** Curtain Call.

**Hub screens:** Home (idle scene + claim), Characters (roster, stars, levels), Summon (working
gacha), Inventory (currencies real, items labelled placeholders), Events (real countdowns,
everything disabled and labelled "Not implemented").

---

## 9. Known issues and open items

**Gameplay**

- **Enemies are far too weak.** Start here.
- **Rebar lost his identity in the rewrite.** Ironpaw Charge was a 3-tile gap-closer and that
  *was* his design — a guardian who relocates. With fixed slots it is now a plain cheap melee hit.
  Marked with a `TODO` in `content.ts`. He needs a new mechanical hook.
- **Telegraphs lost their counterplay.** The Fallen Seraph's Judgment used to resolve on the tile it
  named rather than where you moved — the whole point. With no movement, the wind-up needs a new
  player response: a damage-reduction window, an interrupt by damaging the caster, or something else.
- **Stage progression does not exist.** `profile.stage` is always 1; winning does not advance it or
  grant rewards. The battle and idle layers are not yet connected.
- **Party is the first five owned characters**, in roster order. No lineup management UI.
- **The 1★ summon pool is a single character.** Aethis is the only 1★, so 70% of pulls are the same
  unit. If she is ever promoted the tier empties, and `summon()` falls back to rolling the whole
  roster for that tier — 70% of pulls would then ignore rarity entirely. Fix with more 1★ content.
- **No dark character**, so nothing on the roster is strong against the Fallen Seraph.

**Art**

- **No enemy art.** The largest visible gap now that the Cast is done.
- **Kael has 4 delivery px of margin** where the guide wants 16 — nothing for an animation to swing
  into. Regenerate before animating him.
- **Aethis and Rebar sit 3 native px above the ground line.** Harmless for a still (the pipeline
  trims and re-anchors) but *not* once either is animated, where every frame must share a ground line.
- **`maxine/celebration` and `maxine/idle_2` were upscaled 1.73× and 1.61×** to match the reference
  idle. They are permanently softer than art delivered at the right cell size.

**Technical**

- **Save is client-side localStorage.** Trivially editable, and the clock is the player's own.
  Acceptable for a friends-only project; see roadmap.
- **Two global CSS namespaces** (`styles.css` for battle, `hub.css` for the hub) already caused one
  collision — a `.ghost` class made a hub button inherit an absolutely-positioned battle overlay and
  render as a screen-sized ellipse. A keyframe collision (`danger-pulse`) was caught the same way.
  CSS modules or a prefix convention would prevent the whole category.

---

## 10. Roadmap

**Next up, roughly in order:**

1. **Enemy difficulty pass** — scale enemies to a Cast that levels, stars, and upgrades.
2. **Enemy art** — they are role badges on a painted stage; it is the most visible gap.
3. **Stage progression** — winning advances `profile.stage`, grants rewards, raises the idle rate.
   This is the missing link between the two halves of the game.
4. **Rebar's replacement identity** and **telegraph counterplay** — both left dangling by the rewrite.
5. **Party / lineup management** — choose which five perform, and in what order.

**Planned, further out:**

- **Server-authoritative idle** via Supabase. The client sends `claim`; the server computes
  `now() − last_claimed_at` against the stage rate and writes reward and timestamp in one
  transaction. The client never sends a number or a time. `idle.ts` is already shaped for this.
- **More clips per Performer** — attack, hit, cast, death. The pipeline and lab already support any
  clip name; only art is missing.
- **Large bosses** spanning multiple slots, with a sprite scale and a set of covered slots. The
  formation model was designed for this.
- **Production / Act / Scene structure** replacing generic stage numbers.
- **The Audience and Hype systems**, per the story reference.
- **Item system** — the Inventory screen lists the four planned slots.
- **Event system** — the Events screen is a shell with real countdowns and no behaviour.
- **Spotlight / ultimate abilities** with the theatrical presentation the story reference describes.

---

## 11. Gotchas for the next session

**Environment**

- Windows + Git Bash. **Bash heredocs mangle backslashes and break on some quoted content** —
  several edits failed silently this way. Prefer the Write tool, or Python scripts with explicit
  UTF-8, for anything containing escapes or unusual characters.
- **PowerShell `$_` is eaten by Bash.** Killing stray processes needs the PowerShell tool, not a
  `powershell -Command` string from Bash.
- `dist/` is deleted on every build. **Never leave source art there.**
- **`TaskStop` kills the npm wrapper, not the Vite child.** Kill strays explicitly:
  `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'vite' }`

**Browser verification**

- **A hidden or fully occluded tab freezes the document timeline**, so CSS animations sit at frame 0
  and `animationend` never fires. Verified animation logic by seeking with WAAPI (`anim.currentTime
  = t`) instead, which works regardless.
- **Recording only transitions is not enough to verify an animation.** An early check deduplicated
  consecutive identical values, so it could not detect a doubled frame — which was exactly the bug
  (`animation-direction: alternate` with `steps()` holds both endpoints twice).
- Screenshot the UI rather than assuming. It caught the invisible AoE preview, the ellipse button,
  and several sprite scale problems.

**Verification habits that paid off**

- `npm run sim` after every balance-affecting change. It found the buff-scoring bug, the AI stall,
  the pathfinding stranding, and the boss HP sponge.
- **Measure before believing a guess.** A reported "Kael renders higher than Dart, probably padding"
  turned out to be a deliberate `:nth-child(even)` margin rule. The 3% still-vs-clip gap turned out
  to be `restFill` measuring the bounce apex.
- Render candidate values side by side rather than iterating one guess at a time.

**Art quirks already hit**

- Sheets from the same artist may disagree on baseline **and** scale, and each looks fine alone.
  Always compare across sheets before packing — see §7 and style guide §10.1.
- Automated size detection is unreliable when a weapon is the topmost or lowest content. Verify by
  rendering.
- `_HQ` renders carry 272k–612k semi-transparent pixels each. That halo is why `content_box()` trims
  on an alpha floor of 12 rather than using `getbbox()` — it was the root of every early sizing bug.

---

## 12. Design backlog

Ideas captured but not designed to implementation depth. Recorded here so they survive across
sessions; nothing below is committed.

### 12.1 Theater upgrades — spend to make the building better

Buy seats (main floor, balcony, boxes), lighting rigs, curtains, stage machinery. Each purchase
grants a passive bonus and **visibly changes the Theater**, which is the story reference's core
pillar: "the player's progression should be visible in the Theater itself."

Why it fits: an idle game needs a gold sink that is not another character. This one doubles as the
art budget's payoff — the hub screen is already a painted stage, so upgrades have somewhere to show.

Open questions:

- Do upgrades buff the Cast directly (+ATK), the idle rate, or the Audience's capacity? Capacity is
  the most interesting — it makes §12.2 the real reward and keeps the two systems coupled.
- One shared upgrade track, or per-area tracks that compete for the same currency?
- How does the hub backdrop change? Swappable painted plates are cheap; layered props over one plate
  are more flexible and match the "visible rigging, stage flats" aesthetic.

### 12.2 The Audience — collectable spectators, each a small bonus

Seats bought in §12.1 get filled by Audience members, each granting a specific effect. The story
reference already sketches the shape: Retired Knight boosts Warrior damage, Fortune Teller
manipulates dice, Wealthy Noble increases currency, Excitable Child increases Hype from crits,
a defeated boss grants a bonus tied to that boss.

Why it fits: a second collection axis that is not gacha, so it powers up players who cannot pull.
And "defeated enemies become spectators" is free worldbuilding and a good joke.

Open questions:

- **The dice-manipulating members are the dangerous ones.** The dice economy is the game's identity
  and it is finely measured; an Audience member who rerolls or nudges a die changes the reliability
  curve that §5.1 is built on. Any such effect must be re-simulated, not eyeballed.
- Sources: story progression, boss victories, achievements, events, Theater upgrades, hidden
  objectives.
- Are seats positional — does a front-row member matter more? Positional would give the upgrade
  system something to sell beyond raw count.

### 12.3 Chains — the next battle mechanic, and the one worth getting right

**The idea:** abilities carry a symbol. When two Performers use abilities sharing a symbol in the
same turn, an extra effect triggers.

**Why this is the right shape for this game.** Today the roster has exactly one composition axis:
**cost spread** (§5.1). Chains would add a second — **symbol overlap** — and the two pull in
*opposite directions*. You want costs that do not collide so your team acts often, and symbols that
do collide so your team chains. One roster slot, two competing pressures, and no dominant answer.
That is the structure that makes a team-builder deep without making it complicated.

It also lands exactly on the stated goal: **simple to play, deep to master.** Reading it is trivial
— the ability list shows a symbol and lights up when a chain is live, which is the same affordance
the dice-gating already uses. Mastering it means planning two turns of dice around a chain you can
see coming.

**Design questions to settle before building:**

- **What is a symbol?** Element is the obvious candidate and costs nothing new — but it is already
  load-bearing for the damage wheel, so chains would double down on mono-element teams rather than
  rewarding a new kind of thinking. A separate, orthogonal glyph (2–4 per character, drawn from a
  small shared set) is more work but keeps the two axes independent.
- **Pairs only, or does a 3-chain escalate?** Escalation is exciting and is where a hardcore player
  lives, but it collides hard with the dice economy: three characters chaining means three cheap
  abilities, and cheap costs are the *least* reliable (a 1-cost hits on 59.8% of rolls). A 3-chain
  might be rare enough to feel like a genuine event — which may be exactly right.
- **What does a chain actually do?** Bonus damage is the boring answer. More interesting: a chain
  refunds a die, which feeds directly back into "who gets to act" — the decision the whole game is
  built on.
- **Does order matter?** Ordering adds depth but also adds a sequencing UI to a turn that currently
  resolves as a set.
- **How does it read to the Audience?** Chains are a natural Hype source, which would connect §12.3
  to §12.2 rather than leaving them as separate bolt-ons.

**Implementation warning.** `bestPlan` in `allocate.ts` currently optimises dice→ability assignment
where each assignment's value is independent. **Chains break that independence** — the worth of
giving Kael a 4 depends on whether Benjamin also acts. That turns a clean solve into a combinatorial
one. Two ways out, both worth considering before committing to escalating chains:

1. Keep the solver's job as "enumerate affordable sets" and score chains one level up, where the
   candidate count is small.
2. Restrict chains to **pairs**, which keeps the interaction term quadratic and tractable.

**Whatever is chosen, run `npm run sim` before and after.** Every previous change to the dice economy
moved `acting/phase` in ways nobody predicted — 2.95 → 3.26 from filling two empty cost slots,
3.26 → 3.60 from removing approach turns. A mechanic that hands dice back will move it again.

### 12.4 Standing questions from the rewrite

Not new ideas — unfinished business that any battle-mechanics work should resolve alongside:

- **Rebar needs an identity** (§9). A chain system is a plausible home for a guardian: a Performer
  whose symbol is common, who exists to complete other people's chains.
- **Telegraphs need counterplay** (§9). "Break the chain the boss is building" is one answer that
  would fall out of §12.3 for free.
