# Stagebound

A web-based idle gacha RPG set inside an impossible interdimensional theater. You are the
**Co-Director**: you assemble a Cast of Performers pulled from countless realms and direct them
through dice-driven, turn-based Performances.

This document is a handoff. It covers what exists, why it was built that way, and what is planned.
Read **§6 Design decisions** and **§11 Gotchas** before changing anything — several choices look
arbitrary but were made to fix specific, observed problems.

Companion documents:

- **`BATTLE_DESIGN.md` — the battle system the game is being rebuilt towards. READ THIS FIRST if
  you are touching battle code.** Most of it is now implemented and §5 below describes the engine
  as it actually stands; the two agree except where §5 says otherwise. What is left is **symbols
  and chains** (§4 there) and an **auto-battler that can price an enabler** — the same problem in
  `allocate.ts`. `BATTLE_DESIGN.md` §8 holds the per-Performer kit specs; **Benjamin is the only
  one built.**
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
TypeScript with **zero rendering dependencies**. That still earns its keep — it keeps game rules out
of components and lets idle stages resolve headlessly — but note that the balance simulator it was
originally built for has been **abandoned** (§2).

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
| ~~`npm run play [seed]`~~ | **Abandoned** — AI-vs-AI terminal battle viewer |
| ~~`npm run sim [n]`~~ | **Abandoned** — balance report over N simulated battles |
| `python scripts/pack_sprites.py [--only NAME]` | Publish `art/` → `public/`; regenerate sprite metrics. **Runs automatically** — see [`art/` in, `public/` out](#art-in-public-out) |
| `python scripts/make_favicon.py` | Regenerate the site icon (SVG + ICO + apple-touch) |

### The simulator is abandoned

`npm run sim` and `npm run play` still run, and **should not be used to make decisions.** The game
is not being designed around them.

They were built before the playable game existed — the wrong order — and the cost showed up twice.
First they measured an AI playing a game no human plays, so their verdicts were about the AI's
priorities rather than the design's. Second, and worse, the battle system they measure is being
replaced wholesale (`BATTLE_DESIGN.md`), so every balance figure they have ever produced describes
mechanics that are going away.

The AI would also need substantial rework to play the new system at all: it scores single actions in
isolation, with no notion of resolution order, chains, or spending a debuff against a revealed
intent. **A weak auto-battler in a composition-driven game is worse than none**, because it ignores
the mechanic the whole game is about.

The files are left in place (`src/cli/`, `scoreAction` in `combat.ts`) rather than deleted, because
an idle game does eventually want auto-resolve for farming and the headless architecture is the
right home for it. Treat them as a starting point for that, not as a measuring instrument. Safe to
delete outright if they get in the way.

### Dev tools

The game ships as it is played — no authoring UI visible. Tools are hidden, not deleted.

### The dev badge

Two fixed elements in the **bottom-right corner** (`DevBadge.tsx`), rendered outside the hub/battle
branch so they are there on every screen — hub tabs, the lab, and mid-fight:

- **The switch**, alone in its own pill. Just the word **Dev** and a lamp. One control, one shape,
  in both states — it briefly grew a row of buttons when flipped on, which meant the thing you
  click kept changing size and position depending on its own state.
- **The panel it raises**, stacked directly above it and titled *Dev tools*: **▶ Anim lab** and
  **Reset save**, in a column so the list can grow downward without the switch ever moving.

In the hub they sit above the nav bar; in a fight they drop to the corner, which is free there —
the dock stops well short of the right edge. Mid-fight only the switch appears, since neither the
lab nor a save wipe is reachable without leaving the battle first.

**Flipping it costs nothing.** The flag is a live store (`useDevTools`), not a constant read at
load, so toggling re-renders in place: a battle in progress survives the switch, and the URL is
rewritten with `history.replaceState` so the address bar still states the mode and a copied link
still carries it.

Three design points, each a correction of something that confused a real session:

- **It is a switch, not a link.** It used to change its own label between **▶ Dev** and **Exit
  dev** — which reads as two different buttons rather than one in two states — and it *also*
  navigated to the animation lab as it turned on, so it looked like a link to that screen while its
  real job, flipping a mode, was invisible. The label is now always the word "Dev", the state lives
  in the lamp, the border and the colour (three signals, because any one alone is only noticeable
  once you know to look), and reaching the lab is a separate, visible step.
- **The game's chrome stays the game's chrome.** The switch used to sit in the header and the lab
  used to be a sixth **▶ Anim** tab in the bottom nav. Neither belongs there: a tool has no
  business inside the game's own navigation, and the nav bar should not change shape with a flag.
  With the switch off, the hub is a title, a wallet, five tabs and nothing else — which is the
  point, because the whole reason to have the mode is to be able to see what a player sees.
- **Reset went with them.** Wiping the save is a testing action, not a player one, and it sat
  permanently beside the currency counters. In a production build it is still reachable, because
  `?dev=1` still works there; the button that turns the mode *on* is what gets stripped.

Everything gates on **`?dev=1`** in the query string, *before* the `#` the hub routes on:

```
http://localhost:5173/?dev=1#anim
```

With it set, the *Dev tools* panel appears above the switch and the battle screen's authoring
controls return — in the top-right bar of a fight, beside **Home**:

| Control | What it does |
| --- | --- |
| **Stage** dropdown | Jumps to any of stages 1–20; every tenth is marked `★ … — boss`. Sets the enemy level and the boss/corridor layout with it. |
| **party lv** box | Re-derives all five Performers from the *base* roster at that level. Empty means "use the real save". |
| **Show log** | The full turn log for the fight. |
| **Restart** / **New seed** | Same fight again, or a fresh roll of the dice. |

Changing the stage or the party level restarts the battle — a party only reaches the stage through
`createBattle`. The level is applied to the base roster rather than to the party that was handed in,
so it does not compound with levels already folded into the save.
The setting is **remembered** (`localStorage`, key `stagebound.dev`), so a bare `localhost:5173`
keeps whichever mode you were last in.

Three deliberate choices, all in `src/web/dev.ts`:

- **The gate is a query param, not `import.meta.env.DEV`.** The game is played through `npm run
  dev`, so keying off build mode would show the tools exactly when you are trying to play — and it
  would make the tools unreachable against a production build, which is where some bugs only appear.
- **The param wins over the memory when present**, in both directions: `?dev=1` forces the tools on,
  `?dev=0` forces them off, and each also becomes the new remembered default. Being able to state
  the mode in the address bar is the reason it was a param in the first place; remembering is a
  convenience layered *under* that, never over it.
- **The button is `import.meta.env.DEV`**, necessarily: a way *in* has to exist before the flag is
  set. It is stripped from production builds; the gate it opens is not.

`DEV_TOOLS` is read once at module load, so the button performs a full navigation rather than a hash
change.

> The memory was added because the param alone is too easy to lose. Anything that retypes the URL —
> a bookmark, a pasted `localhost:5173`, a hand-edit that keeps the hash and drops the search —
> silently turned the tools off, and a battle bar showing nothing but **Home** reads as a missing
> feature rather than a dropped flag. `localStorage` access is wrapped in `try`/`catch`: it *throws*
> rather than returning empty in a private window, and a forgotten preference is a fine outcome
> where a blank page is not.

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
    crisp.ts       Rounds figures to whole multiples of the art's own pixels
    screens/       Home, Characters, Summon, Inventory, Events, AnimationLab
    styles.css     Battle screen styles
    hub.css        Hub styles
    stars.css      Star tree + levelling styles
  cli/           ABANDONED — see §2
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
  enemies/creatures/  One flat 128px PNG per enemy — packed like a v2 actor
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
- **The fingerprint is a content hash, not a timestamp.** It was `mtime_ns` once, and git does not
  preserve mtime: after any clone, checkout or branch switch every output looked foreign, and the
  guard silently skipped the *entire roster* on every run — sizes matching to the byte the whole
  time. A hash costs one read of a file already being written and also catches an edit that kept the
  size. Manifests written before the change are re-adopted on size once and immediately re-stamped.
- A complete run **prunes** `public/sprites/` and `public/background/` of anything it did not
  produce. Pruning is skipped when an actor was skipped unexpectedly, so a partial run cannot
  delete a skipped actor's output. A run deliberately scoped with `--only` still prunes *those*
  actors' own folders, since it just rewrote their manifests — so renaming a clip does not leave
  the old strip behind until the next whole-roster run.

**You do not run the pipeline by hand.** The `stagebound:art-pipeline` plugin in `vite.config.ts`
runs it for you, on two triggers:

| When | What runs |
| --- | --- |
| `npm run dev`, then any save under `art/` | Re-packs **only that actor**, then full-page reloads |
| `npm run dev` startup | One catch-up pack, after the server is listening |
| `npm run build` | One full pack before the bundle is written |

So dropping a new sprite into `art/actors/<name>/` is the whole workflow — it appears in the running
game a second later, and the terminal prints what was written plus any audit notes. Details that
matter if it ever misbehaves:

- The watcher **ignores `*.pack.json` and `*.anim.json`**, which the pipeline and the animation lab
  write back *into* `art/`. Without that the pipeline's own output would retrigger it forever.
- Runs are **debounced 300ms and serialised**. Dropping a sprite, an icon and a sheet together is
  one pack, not three, and two packs can never race over the same manifest.
- The child process is spawned **asynchronously**. A synchronous one would block the dev server's
  event loop for the seconds a pack takes.
- Python is found as `python` on Windows and `python3` elsewhere; override with
  **`STAGEBOUND_PYTHON`**. `STAGEBOUND_SKIP_PACK=1` skips the build-time pack.
- It needs **Pillow and numpy** (`python -m pip install pillow numpy`).

The favicon files are the one hand-managed exception, and they are generated too — by
`make_favicon.py`.

---

## 4. Architecture principles

These three separations are load-bearing. Breaking them will hurt.

**1. The engine never imports React.** Everything in `src/engine/` is pure. This is what keeps game
rules out of components, lets a server later resolve idle stage clears with the exact same code, and
leaves the door open for auto-resolve. It is also what made the abandoned simulator possible — but
the principle earns its keep without it, so keep it.

**2. Progression is folded into character sheets once, before a battle starts.**

```ts
applyStars(applyLevel(def, level), starProgress)  // → a plain CharacterDef
```

Nothing in the damage formula, the AI, or the dice allocator knows that levels or stars exist. They
see ordinary numbers. Order matters: levels first, so a star's percentage is of the levelled stat
rather than the base sheet.

**3. Rules text is generated from ability data, never hand-written.** `describe.ts` turns
`{ power: 1.4, range: 3, scope: 'all' }` into prose. Retune a number and the text follows. An
ability can never claim something it does not do.

A fourth, learned the hard way: **measurements about art are generated, never hand-copied.** A
replaced Kael sheet once kept the old aspect ratio in `content.ts` and rendered 22% too wide.
`sprites.generated.ts` now carries every measured value.

---

## 5. Systems

> **The battle layer is mid-rebuild toward `BATTLE_DESIGN.md`.** The turn loop (§5.2) and enemy
> intent (§5.3) are BUILT and current. Still to come: damage types with split defenses, status
> effects, and symbols/chains — until those land, §5.4's upgrade tiers and the ability data model
> are the older system and will move.
>
> The dice economy in §5.1 survives the rebuild unchanged; it is the game's identity and is
> format-independent. §5.5–§5.7 (stars, levels, idle, summoning) are unaffected throughout.

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

**Target scope is one of three shapes**, and deliberately only three:

| `scope` | reaches | `range` applies? |
| --- | --- | --- |
| `one` (default) | a single unit | yes, for attacks |
| `self` | the caster, and nothing else | no |
| `all` | every living unit on the affected side | no |

This replaced an `aoeRadius` measured in formation slots, where a blast splashed onto its target's
*neighbours*. That asked the player to hold the enemy's grid layout in their head to work out what an
ability would catch, and it barely had a middle ground to offer in return — the formation is three
columns wide, so radius 2 already caught nearly everything. Single, self, or everyone reads at a
glance and needs no diagram.

Two consequences worth knowing. **AoE got strictly stronger** — what used to hit ~3 now always hits
5 — so the costs on the seven converted abilities are understated until the kit redesign. And
`range` on an `all` ability is vestigial: it no longer gates anything, though `thornsDamage` still
reads `range > 1` as its melee test.

- **Resistance can change mid-battle.** `Unit.resistMods` is a runtime layer on top of the sheet's
  own — the hook statuses will write into, and already the mechanism behind the boss's rotating
  immunity. Rotation draws from a **bag**, not a fresh roll: a plain draw repeated an element two
  rounds running, which reads as the mechanic being broken rather than as bad luck. The bag is
  fixed at the seam too, so a refill cannot open on the element the last cycle closed with.
- **The ceiling is 100, not the 80 first proposed.** 80 was chosen so stacked buffs could never
  reach immunity — then a boss arrived whose whole identity is immunity, and a ceiling forbidding
  what a boss is *for* is the wrong ceiling. The real hazard was never immunity but a **negative**
  multiplier, and the multiplier is clamped at zero instead. What 80 protected is now a content
  rule: do not author resistance buffs that stack to 100. Burying it in a clamp only hid it.
  Immunity also had to deal genuinely **zero** — the `Math.max(1, …)` damage floor made an attack
  labelled IMMUNE deal 1, and a true label is worth more than the point.
- **An ability may have no element at all.** `Ability.element` is optional, and absent is *not* a
  neutral element with a blank matchup table — it means the elemental layer does not apply: no
  resistance is read, no weakness fires, no matchup label is shown. That is what lets a plain
  physical attacker exist as the baseline a player learns damage and armour on before elements are
  introduced by anybody else. Benjamin is that Performer, and his `resistances` are empty for the
  same reason: an alignment he has no attacks to match would put half an element back on him by the
  side door.
- **Nothing has an element. Only damage does.** A `CharacterDef` has no `element` field; it has
  `resistances` and its abilities carry elements. That is what lets one Performer wield fire *and*
  water without the sheet having to file them under one — and it removes the question of what
  element a knight is supposed to be. It also frees resistance from the wheel's one-weakness,
  one-resistance shape: a creature can be weak to two things, resistant to everything but one, or
  aligned to nothing.
- **Resistance is a percentage stat**: positive takes less, negative takes more, `×(1 − resist/100)`,
  unlisted is neutral. **Capped at +80, floored at −200.** The cap is load-bearing — `1 − r/100`
  hits zero at 100 and goes negative above, so two stacked "+40% fire resistance" buffs would be
  immunity and three would heal from it. The floor matters far less, since vulnerability grows
  linearly. A runtime modifier layer adds on top once statuses exist.
- **`aligned(element)` keeps the wheel as a one-line default.** Deleting the wheel outright would
  have cost guessability: free-form per-enemy numbers are more expressive but not *predictable*,
  and a player who must read five tooltips before every fight has lost the thing the wheel was
  for. As a profile it gives the common case one line (`resistances: aligned('fire')`) and leaves
  every exception open. Rules text states it as a convention, not a law, because an exception is
  now legal.
- **The element cycle** — the shape `aligned()` draws from: **fire → wind → earth → lightning →
  water → fire**, plus
  light ↔ dark as a mutual pair outside it. 1.5× strong, 0.75× resisted. Every element in the cycle
  beats exactly one and loses to exactly one, so a five-enemy encounter built from it has no dead
  matchups. Lightning was added with the elemental Understudies and only moved one existing edge:
  earth used to beat water and now grounds lightning, with lightning conducting into water. Both
  read without explanation, which is the test a matchup wheel has to pass.
- **Stats are one offensive number and two defensive tracks.** `attack` drives physical hits,
  magical hits *and* healing, so anything that raises ATK is worth the same to a blade, a staff and
  a healer. Defence splits into `physicalDefense` / `magicalDefense`, which is why a shred can be
  pointed at one of them.
- **Timed modifiers replaced flat buffs.** `Unit.modifiers` is a list of
  `{ability, stat, amount, turns, by}`; the old `atkBuff` / `defBuff` pair — two numbers decaying
  10 a turn, applied to both defence tracks at once — could not express a duration, could not tell
  two sources apart, and could not name a track. See **§5.2b** for the stacking and percentage
  rules, which are the part with teeth.
- **Damage**: `ATK × power × (K / (K + DEF)) × elementResist`, then passive modifiers — where `DEF`
  is the track matching the ability's **damage type**, including any modifiers on it.
- **Mitigation is a ratio, not a subtraction.** `K / (K + DEF)` has diminishing returns, never goes
  negative, never reaches immunity, and buys a constant slice of effective HP per point.
  Subtractive `ATK − DEF` has none of those: it needs clamping at zero, creates hard thresholds
  where an attacker flips from useful to useless, and makes many small hits worthless against
  armour.
- **`K` is anchored to the ATTACKER's `powerScale`, and that is the whole trick.** With a fixed
  `K = 100` the formula quietly expires: stats grow with level but the constant does not, so
  mitigation drifted 0.69 → 0.24 between level 1 and 80 and the *same* fight stretched from 7.5
  hits to 22. Scaling `K` with the attacker holds an even fight at a constant length —
  **9.4 hits at level 1 and at level 80** — and because `DEF` still carries the defender's scale, a
  level gap falls out of the same expression for free.

> **No separate level-difference multiplier exists, deliberately.** The anchor already produces one:
> an out-levelled attacker is resisted, an over-levelled one cuts through. Adding an explicit term
> would count level twice — and its swing is bounded (±10 levels is ×0.42 to ×1.62) so it stays
> under composition's ×3.55 ceiling and cannot displace `BATTLE_DESIGN.md` §1.

**Encounters carry an `enemyLevel`**, which is the difficulty dial for the idle layer: the same five
creatures at level 30 are a wall the same five at level 1 are not. Re-using an encounter at a higher
level is the intended way to build a stage ladder — authoring thirty bestiaries to say the same
thing would be work with no design in it. Enemies with genuinely different *behaviour* still earn
their own defs. Levelling happens inside `createBattle`, so every entry point fields an encounter at
the level it declares without having to remember to.
- **Three damage types.** `physical` and `magical` read the target's matching defense, so a stat
  block can say "armoured, but soft to magic"; `true` is mitigated by nothing. Blades and shields
  swing steel, staves cast, and every attack in content sets its type explicitly so nothing relies
  on the default. True has to be *priced* rather than balanced — as a full-strength type it would
  never be wrong, and the never-wrong option erases the decision. At ~55% power its crossover sits
  at **exactly DEF 80**: worse than typed against a mob, better only against something armoured on
  both tracks.
- **A guard buff and a defensive star node raise both tracks.** Splitting them would halve every
  defensive ability without adding a decision worth making; per-type warding is elemental
  resistance's job, which is a separate axis.

### 5.2a The turn loop

Each side's turn is **Start → Resolve → End**, and the two bookends are simultaneous for that whole
side. Nothing at Start or End belongs to a particular unit's place in the order, so a regen tick
and an expiring buff land together and no effect's lifetime depends on who happens to be listed
first.

One round, in order:

1. **Start Turn (player)** — `beginPhase`. Regeneration ticks, cooldowns count down, the shared
   pool is rolled. The dice are visible before anything is planned.
2. **Enemies declare** — every living enemy picks an ability and a target, and both are shown.
3. **The player plans**, queueing actions into a resolution order. Dice are reserved as each is
   queued, so the tray always shows what is genuinely left.
4. **Commit.** The queue resolves top to bottom, one action at a time.
5. **End Turn (player)** — `endTurn`. Durations count down and anything reaching zero expires.
6. **The enemy turn runs the same three phases**, acting on what was declared in step 2.

**Expiry is at the End, never the Start**, and that is the load-bearing half. A modifier applied on
a turn has to cover that turn, so it is counted down at the end of it; ticking at the start would
silently make every duration one turn longer than it reads. It also means a buff can never lapse
between the second and third ability of the same plan.

`endTurn` only ticks modifiers applied **by** the side whose turn is ending (`Modifier.by`), which
is what makes "3 turns" mean three of the *buffer's* own turns.

| function | does |
| --- | --- |
| `planAction` / `planUpgrade` | queue an action, reserving its dice |
| `unplan` / `clearPlan` | take it back, returning the dice |
| `movePlanned` | reorder — this is the strategy |
| `commitNext` | resolve the front of the queue, return what happened |
| `commitPlan` | drain it, for headless use |

**Planning and resolving are separate on purpose.** If actions landed as they were clicked,
ordering would be a probe — cast the cheap thing, look, then decide the rest — and the order would
stop being a decision. Building the whole turn before any of it happens is what makes "which of
these goes first" a real question.

> **Nothing is re-validated at resolution.** An action whose target died earlier in the same queue
> **fizzles, and its dice are gone.** That is the cost of ordering badly, and refunding it would
> delete the decision. Verified: two attacks queued at a 1 HP enemy produce one kill, one
> `fizzle`, and two spent dice.

`commitNext` is stepped rather than all-at-once so the UI can animate one action, let it land, then
run the next. Resolving a whole turn in one frame would collapse an ordered plan into a single
indistinguishable flash, throwing away the readability the ordering was meant to buy. `commitPlan`
is verified to reach identical state.

### 5.2b Modifiers, effects and cooldowns

Three rules, and the second is the one that matters.

**Stacking: refresh within an ability, stack across abilities.** The same ability recast refreshes
its own modifier rather than stacking with itself — Rally cast twice on one ally is one modifier
with its clock reset. Different abilities stack as separate entries with separate clocks, so two
sources of +20% give +40% and each expires on its own schedule.

**Percentages resolve to a flat amount at cast time, from a named source.** A modifier stores a
*number*, computed once when it lands, and every ability states what its percentage is a percentage
**of**:

| `of` | reads | two 20% buffs give |
| --- | --- | --- |
| `targetBase` | the recipient's own unmodified stat | +40% of base — additive, no compounding |
| `casterCurrent` | the **caster's** stat, including their own live modifiers | whatever the caster was worth at that moment |

Without this, "+20% then +20%" silently means +44% and the second buff is worth more than the first
for no reason a player could predict. Resolving to a flat number also makes expiry a subtraction.

`casterCurrent` is a design tool rather than a default: the buff is worth whatever the *caster* is
worth, so building that Performer up is how they help the team, a Performer can be buffed and then
pass that strength along a turn later, and the gift quietly stops mattering once the recipients
outscale them. Benjamin's Rally is the first user (`BATTLE_DESIGN.md` §8).

**An ability is an ordered list of effects.** `Ability.effects` runs top to bottom — damage, heal,
or modify, each with its own optional target (`target` / `self` / `allies`). This is the whole
answer to "does the self-buff apply before or after the damage": it applies where it is written,
and the ability is **worded** in that order too, so the rules text and the execution agree by
construction. Kits still authored the old way (`kind` + `power`) fall back to the legacy path, and
`describeAbility` reads whichever is present.

> A brief bug worth remembering: `describeAbility` kept reading the legacy fields after the effect
> list landed, so the ability panel described a damage-plus-shred as a plain hit and a percentage
> buff as "+20 ATK". The generator's promise is that it *cannot* drift from the engine — adding a
> second way to author an ability is exactly how that promise breaks.

**Cooldowns work for the player now.** `Unit.cooldowns` and its per-turn countdown were always
side-agnostic, but only the enemy path ever set or read them, so a player ultimate with a cooldown
could be cast every turn. `checkAction`, `commitAction` and the auto-battler's planner all respect
it — the planner too, or idle play would quietly get a better kit than manual play. A cooldown is
set to `cooldown + 1` on use because Start Turn counts every cooldown down including the turn it
was cast on, so **a 2-turn cooldown locks out the next two turns** and is ready on the third.

### 5.3 Enemies are NOT built like player characters

This is the single most important content distinction.

- **Enemies roll no dice.** Every enemy acts every turn. Because they act every phase instead of
  ~3.6 of 5, their per-hit numbers are **roughly half** a player character's.
- **They declare in advance.** At the top of the player's phase each living enemy commits to an
  ability and a target, and the player sees both. `chooseIntents` runs then rather than when the
  enemy acts, because a declaration made at the moment of acting is too late to plan against.
- **Which ability is chosen by weight** (`Ability.weight`, default 1, so an unweighted kit is
  uniform). **The odds are never shown** — the player sees the choice, not the distribution. That is
  what keeps this round solvable and the next one uncertain; published odds would make every fight
  arithmetic, hidden choices would make planning a guess.
- **The target is picked uniformly at random** among legal ones. Targeting is not where the interest
  lives, and a deterministic "always hits the weakest" would make the reveal redundant — you would
  know it without reading it.
- **The declared action is what happens.** The enemy phase executes the intent rather than
  re-choosing; re-choosing would break the promise the reveal makes. The only fallback is when the
  named target has since died, which is itself a legitimate answer to the reveal.
- **Trash mobs** get one ability and usually no passive. **Elites** get passives. **Bosses** get
  several, with hidden activation odds.
- **Telegraphed attacks**: an ability with `telegraph: 1` announces its target area this turn and
  lands at the start of its next phase. Distinct from an intent — a telegraph is a wind-up you have
  a whole turn to answer, an intent is what happens at the end of this one.
- Enemies resolve **sequentially inside one uninterruptible phase**, not strictly simultaneously.
  The player cannot act between them, which is the property that matters for burst, but a kill by
  the first does change what the third finds. Logged as open in `BATTLE_DESIGN.md`.

`Ability.priority` is the older selector and is now vestigial; the current kits still carry it and
are about to be rebuilt anyway.

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
- Summon rates: **4% / 26% / 70%** for 5★/4★/3★. 30 shards per pull, 270 for ten. The rate table is
  printed on the page from the same constants the roll uses, so displayed odds cannot drift from
  applied odds — but see §9 for the empty-tier caveat that currently defeats that.
- **Rarity runs 3–5, with 5 rarest.** It was 1–3 with 3 rarest; the renumbering is a hazard rather
  than a rename, because `rarity: 3` stayed valid while coming to mean the opposite. The compiler
  flags every 1 and 2 and silently accepts every 3, so each character was re-assigned deliberately.
  All five starters are 3★ — they are tutorial unlocks.

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
| The turn is queued and committed, not clicked and resolved | Immediate resolution turns ordering into a probe: cast the cheap thing, look at the result, then decide. The order stops being a decision. |
| A queued action whose target dies **fizzles**, dice spent | Refunding it would remove the cost of ordering badly, which is the only thing making the order matter. |
| Enemy intent reveals the TARGET, not just the ability | "Judgment → whole party" supports shielding, pre-healing, or racing the caster. "Judgment" alone supports nothing. |
| Enemy activation odds are hidden, the choice is shown | Published odds make a fight arithmetic; hidden choices make planning a guess. Showing the pick keeps this round solvable and the next one uncertain. |
| Target scope is one / self / all, with no radius | A radius over formation slots made the player hold the enemy's grid in their head, and had almost no middle ground to offer — three columns wide means radius 2 caught nearly everything. |
| Output fingerprints are content hashes, not mtimes | Git does not preserve mtime, so an mtime fingerprint reported every file as foreign after any checkout and the guard silently skipped the whole roster. |

---

## 7. Content authoring

### Characters

All content lives in `src/engine/content.ts`. A character needs identity (id, name, rarity, element,
role), stats (maxHp, attack, defense), 3–4 abilities including one `wildcard: true` basic, 3 upgrade
tiers, and a `starTree`.

A kit may instead be authored with **`effects`**, an ordered list (§5.2b) — that is the shape every
redesign should use, and Benjamin is the worked example.

**When designing a kit, check cost coverage across the whole roster.** Current spread, after
Benjamin's rebuild moved him off 3/5/9:

```
 1: Aethis     2: Kael, Rebar   3: Maxine          4: Kael, Benjamin
 5: Aethis     6: Rebar, Benjamin   7: Kael, Maxine    8: Aethis
10: Maxine, Benjamin   11: Rebar
```

Costs 3, 5 and 9 lost a claimant and 4, 6 and 10 gained one. That collision is real but temporary:
Benjamin took the best seats deliberately because he is the tutorial Performer, and the other four
will be authored around him rather than the other way round.

**`acting/phase` currently measures 2.9 of 5**, not the 3.60 recorded during the side-view rewrite.
The pool is tighter than that older figure suggests, and any kit-design argument resting on 3.60
should be re-checked.

### Encounters

An `EncounterDef` is a backdrop plus party and enemy slot arrays. `STANDARD_PARTY_SLOTS` and
`STANDARD_ENEMY_SLOTS` in `formation.ts` cover the default 5-v-7 stage; a Production wanting a
different arrangement supplies its own.

### Art pipeline

Authored against **`SPRITE_STYLE_GUIDE.md`**, which is the source of truth. Read §10 of it before
generating any animation — that section exists because of the bugs listed below.

**Stills.** Two spec revisions are in the roster at once while the 128px migration runs, and the
pipeline tells them apart **by which files exist** rather than by a list of names — so migrating an
actor is only ever a matter of dropping the new files in.

| | v1 (Kael, Rebar, Maxine, Aethis) | v2 (Benjamin) |
| --- | --- | --- |
| Native grid | 64px | **128px** |
| Measured from | `<name>_LQ.png` (256px, ÷4) | `<name>.png` — it *is* the native canvas |
| Ships | `<name>_HQ.png`, smoothed | `<name>.png`, nearest-neighbour |
| Detected by | `<name>_LQ.png` present | `<name>_LQ.png` absent |

`<name>_preview.png` is a review aid, **not** shipped: the guide requires it to be an integer
nearest-neighbour enlargement of the same pixels, so shipping it would ship a pre-scaled duplicate.

Size and pixels stay separate questions: how big a character is comes from their native grid, which
pixels get drawn comes from the best available render. Stature is the **ratio** `nativePx /
nativeCanvas`, and both travel together into `sprites.generated.ts` — measuring a 128px actor
against a hard-coded 64 would draw them at twice everyone else's height.

**Enemies.** One flat `art/enemies/creatures/<name>.png` per creature, authored to the same v2 spec
as a Performer — 128px canvas, green screen, binary alpha. A creature is that spec minus everything
a Performer needs on top: no 64px master to reconcile, no portrait crop, no animation set, so it is
a file rather than a folder. It packs through the same key, outline and crop, and outputs to
`public/sprites/<name>/` like everyone else, which is what lets the metrics scan, the prune and the
stamp guard treat it identically instead of needing a parallel tree.

**Animations.** Sheets go in `art/actors/<name>/animations/<name>_<clip>.png`. The frame grid is
inferred from the image's own dimensions — gcd of width and height, read row-major — so `7680×640`
is 12×1 and `1448×1086` is 4×3. That assumes **square** cells, which v2 broke by giving each clip
its own canvas: a 6-frame attack at 192×128 arrives as `1152×128`, and 192 is not recoverable from
those two numbers. Name such a sheet `<name>_attack_6x1.png` and the grid is read off the filename.

Sheets named `*_old`, `*_previous` or `*_deprecated` are **skipped**, so a superseded sheet can be
kept beside the live one without being packed and shipped as a clip called `idle_old`.

**Pixel art is never re-coloured or feathered.** `key_flat_background` keys the backdrop and stops
there when the palette is small; only painted art goes through `unmatte`, which rebuilds the edge
ring by spreading interior colours outward and giving it partial alpha. That is right for a render
that was genuinely anti-aliased and destructive for a drawn one-pixel outline — it turned a
60-colour sheet into 1,209 colours with a quarter of its pixels semi-transparent, which on screen
read as "the outline is gone and it looks blurry". The two cases are told apart by counting colours,
which is not a close call: the guide caps a sprite at 64, the live sheets use 23 and 60, and the
painted sheets run to 144,000.

#### Pre-flight for a new or rebuilt actor

Everything here has already cost a debugging session at least once.

1. **Body height 82–92 native px**, feet baseline y=112, margin ≥8px on a 128×128 canvas. Benjamin
   is the reference — he audits with zero notes.
2. **Green screen `RGB(0,255,0)`**, except **Aethis, who must be on magenta**. He wears green and
   gold; the hue key that produces the outline and cleans the icon cannot tell a green costume from
   a green screen. The pipeline reads the key colour from the corner and does not care which it is.
3. **Do not draw the outer outline yourself.** The pipeline adds a 1px ring outside the silhouette.
   Draw one too and you get 2px, which reads heavy. Internal outlines (chin over neck, cape folds)
   *are* yours to draw — they cannot be derived, see below.
4. **Delete the v1 files** (`_LQ`, `_HQ`, `_base_native_64`) once `<name>.png` exists. Harmless if
   left — `<name>.png` wins and the run reports them — but they are dead weight.
5. **One clip, named `<name>_idle.png`**, a single row of square 128×128 cells. Non-square cells
   need the count in the filename (`<name>_attack_6x1.png`); square ones are inferred. The battle
   picks up a clip named `idle` automatically.
6. **Icons ≥64px**, and do not leave key colour in them. The pipeline keys and integer-upscales
   them, but a clean crop is better than a rescued one.
7. **Old sheets**: suffix `_old` or delete. Suffixed ones are skipped, never packed.

Drop the files in with `npm run dev` running; each actor packs and the page reloads on save, with
measurements and audit notes printed to the terminal.

> **Why internal outlines are yours and not the pipeline's.** The outer ring is derivable because
> the alpha mask *is* the silhouette — ground truth. Internal outlines need the pipeline to tell
> "two overlapping forms" from "shading within one form", and those are the same signal in the
> pixels: a hair highlight beside a hair shadow looks exactly like a chin beside a neck. Every
> variant tried either shredded the face (1,271–1,671 pixels overwritten) or, once gated by region
> size to protect the face, still streaked the hair. At an 85px figure the face is ~10px tall, so
> one wrong pixel is a quarter of a feature — and unlike the silhouette ring, internal ink must
> *overwrite* art rather than grow into empty space. Large forms only (cape over tunic) are
> derivable; the fine features you actually want are not. **More resolution is the real fix** — on a
> 256 canvas with a ~170px figure there is room, and with integer snapping that renders at exactly
> 1×, about 70% larger on screen than today.

**Icons are keyed by hue and grown by whole factors.** They are full-bleed portrait crops, so the
corner flood cannot key them — the corner is usually the character. `key_chroma` keys by hue
instead, gated on **area**: peak chroma alone fires on any saturated highlight (Kael's icon reaches
209 on an orange trim pixel, Aethis 255 on a red one) and keying either punches a hole through the
portrait. A backdrop covers ground — Maxine's key was 8.01% of her icon against those two at 0.02%
and 0.00%, so the 1% floor sits 400× clear. Small icons are then enlarged by an integer factor with
nearest-neighbour, because the panels draw them at 40–56px and a 32px icon was being
smooth-upscaled 1.75×.

**A bold outline is generated, not drawn.** The generators anti-alias, and the outline arrives
*broken* rather than missing: 84% of Benjamin's silhouette boundary was already very dark and the
other 16% was where the softening ate it. A boundary that is bold in most places and gone in the
rest is what reads as blur, and no amount of keying puts back a pixel the generator never committed
to. `OUTLINE` in `pack_sprites.py` maps actor → ring width in native pixels; `add_outline` dilates
the alpha mask and fills the new ring with `outline_ink` — the art's own most common near-black, so
the ring joins the palette instead of adding a 65th colour to a sheet the guide caps at 64.

Preferred over hand-editing frames for reasons beyond effort: it derives from the alpha mask, so it
is *identical* on all 8 frames and cannot jitter between them, and it survives regenerating the art.
It is drawn into the guide's 8px safe margin rather than by growing the canvas, which would put
every outlined sprite 2px over the specified 128×128. The margin check discounts what it spent —
reporting the pipeline's own deliberate pixel as art drift is how a lint teaches you to ignore it.

> **Only the OUTER silhouette.** An internal separation — an arm against a torso, the gap under a
> scarf — is not on the alpha boundary, so it cannot be derived and still has to be drawn.

> **A bigger canvas means a bigger creature, not a sharper one.** Stature is `nativePx /
> nativeCanvas`, and it is tempting to read that canvas off the file — which is wrong, and briefly
> was: dividing the 203px boss by its own 256px file normalised away exactly the size that makes it
> a boss, leaving it **1.19×** a Performer, barely above the trash it commands. Against the shared
> 128px **density grid** it is 2.39×, which is what the art says. The canvas division exists only to
> reconcile art authored at different densities — the old 64px grid against the 128px one — so a v2
> sprite measures against 128 whatever size its file is. The file's own size is still read, but for
> *geometry* checks (canvas, margin, ground line), which are facts about the image.

**Stature is audited against a declared scale class**, not one band for everybody. `SCALE_CLASS` in
`pack_sprites.py` maps a sprite to `small` (58–72), `standard` (82–92) or `large` (92–104) from the
guide's §4; anything undeclared is audited as Standard. It records INTENT and changes no rendering —
a sprite declared `small` and drawn large is reported, never silently shrunk, because stature still
comes from the measured art. Without it the lint can only say "not Standard", which is noise for a
character that was never meant to be, and noise is how a lint teaches you to stop reading it.

The measured height **discounts the outline the pipeline itself drew**, for the same reason the
margin check does: the guide's bands are about the art. It is a uniform 2px on every v2 sprite (one
row top and bottom), so it shifts every reading equally and changes no relative stature.

> **A caveat the guide states and the pipeline cannot honour.** §3 says to scale a character by the
> BODY, not the total bounding box — hats, plumes and weapons must not shrink the body. `nativePx`
> is measured from the content box, so it is the total silhouette: Maxine's 106 includes her hat and
> the Understudies' 93 includes a feather plume. Separating the two automatically is the same
> unreliable problem as internal outlines — a wide hat brim is indistinguishable from shoulders by
> pixel width alone. Until something better exists, keep silhouettes comparable in the art.

**Pixel art is drawn at whole-number scale.** Nearest-neighbour is only faithful at integer factors;
at the 1.208× the stage's proportions happened to ask for, some source pixels are one screen pixel
wide and their neighbours two, so a one-pixel outline comes out thick in places and thin in others.
`src/web/crisp.ts` rounds a figure to the nearest whole multiple of the art's own height (never
below 1×), using the real file dimension `pxH` rather than the design-canvas measurement.

Two functions, because the two screens size in different units — and getting that wrong has already
cost a bug. `Figure` sizes in CSS pixels, so `crisp()` is plain arithmetic. The battle sizes in
**fractions of the stage** (`SLOT_H = 0.155`, rendered as `cqh`), where the pixel size is not known
until layout, so `crispCss()` defers to CSS `round()`. Applying the pixel version to a stage
fraction rounded `0.13` up to `83` and drew the cast 638× too large.

Smoothed art is left alone: it is drawn 0.28–0.34× of a 320px sheet, so rounding it to whole sheet
heights would snap every character to one enormous step.

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
    "stepMs": 120,
    "frames": [{}, { "hold": 2.5 }],
    "order": [1, 0, 2, 4, 5]
  }
}
```

| Key | Scope | Meaning |
| --- | --- | --- |
| `placement` | Whole clip | `scale`, `dx`, `dy` against the foot anchor |
| `stepMs` | Whole clip | Ms per plain frame; omit for `DEFAULT_STEP_MS` (105) |
| `frames` | Per frame | `hold` weight, `dx`, `dy` |
| `order` | Whole clip | Playback sequence; omit for natural order |

Offsets are percentages, so corrections hold at any render size. `hold` is a **weight**, not a
duration, so `stepMs` still means "how long a plain frame lasts."

The lab's **Preview size** slider is the one control that is deliberately NOT saved — it zooms the
lab so a clip can be judged at more than one size, and is labelled as such. A character's size in
battle comes from how tall they are drawn on their native canvas (`nativePx / nativeCanvas`), so
making one bigger means redrawing them taller, not turning a knob.

`stepMs` is per clip because a bounce idle and a celebration are not the same tempo, and the sheets
they come from are not drawn at a common frame rate either. It was the one lab control that had no
authored home: the slider lived in React state, `save()` never sent it, and the battle used a
hard-coded constant — so it moved the lab preview and nothing else.

> **`frames` is indexed by SOURCE frame, not by playback position.** That is what lets a hold or a
> nudge stay attached to the drawing it was authored for when `order` is rearranged underneath it.
> A frame missing from `order` is disabled — still in the image, never played — which beats
> re-exporting a sheet to drop one bad frame.

**The animation lab** (`?dev=1#anim`, or the dev badge's **▶ Anim lab** button) is where all of this is judged and
edited: swap character and clip, scrub frames by hand, play a one-shot into whatever it settles
into, ghost the still behind the clip — or the **incoming frame**, the last frame of whatever clip
settles into this one, which is the pose an ending actually has to continue from — reorder and
disable frames, tune placement and timing live, download a single frame as PNG — and **Save**,
which writes the JSON
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

**Battle balance is not tracked, and deliberately so.** The simulator that used to report it is
abandoned (§2) and the system it measured is being replaced (`BATTLE_DESIGN.md`). For the record,
its last reading was a **100% player win rate with 4.94 of 5 survivors over 300 battles** — the
party out-damaged enemies roughly 2:1 per action, had 14% more HP, and healed on top. Do not tune
against that. The kits and the enemies are both being rebuilt.

The diagnosis is still useful as a warning, because the same trap is easy to re-create: enemy
damage was **flat** (312 per turn, every turn), and flat damage is always healable — one Sanctuary
healed 315 for two dice, so a single Performer spending two of five dice cancelled five enemies.
`BATTLE_DESIGN.md` addresses this structurally, via simultaneous enemy phases that cannot be healed
through mid-burst, rather than by raising enemy numbers into a sustain cliff.

**Cast** — all five have sprites and idle animations, and **all five are 3★**, the common tier, as
tutorial unlocks: Benjamin (elementless blade, **rebuilt**), Kael (wind blade), Rebar (light
shield), Maxine (water staff, artillery), Aethis (earth staff, healer).

**Benjamin is the only redesigned kit.** He is specced in `BATTLE_DESIGN.md` §8 and built: Quick
Cut (wildcard), Sunder (6, damage then a physical-defence shred), Rally (4, buffs an ally by a % of
*Benjamin's current* stats), Perfect Form (10, self-buff then a large strike, 2-turn cooldown).
Authoring him is what drove the turn phases, timed modifiers, ordered effects, player cooldowns and
elementless attacks into the engine. **The other four are still disposable** — treat their
abilities as placeholders authored for a system that is going away.

**Art migration to style guide v2 (128px) is in progress:**

| | spec | still | idle |
| --- | --- | --- | --- |
| Benjamin | **v2** | 85 native px, audits clean | 8 frames |
| Maxine | **v2** | 108 native px — over the guide's range, see §9 | 8 frames |
| Kael | v1 | 42 native px | — |
| Rebar | v1 | 37 native px | — |
| Aethis | v1 | 43 native px | — |

The remaining three are to be rebuilt at 128px with **a single idle each**. The pipeline detects
which spec an actor is on from their files, so migrating one is just dropping the new files in — see
[`art/` in, `public/` out](#art-in-public-out) for the full contract and the pre-flight list.

**Enemies:** five elemental **Understudies** — Red (fire), Yellow (lightning), Blue (water),
Orange (earth), Green (wind) — one per element in the cycle, identical in every other respect so
any difference in outcome is the matchup and nothing else. **All five have art.** The older
five-enemy lineup is kept as `BESTIARY` for reference, not deployed.

**Stages are generated, not authored.** `sceneFor(n)` fields the Understudies for nine stages then
**The False Lead** on every tenth, with `enemyLevel` tracking the stage (bosses run 3 hot, because a
gate cleared at the corridor's level is not a gate). A deliberate testing ladder rather than a
content plan: it exercises levelling, idle accrual and the whole battle loop against a *predictable*
rotation, so a change in outcome is a change in the systems and not in the encounter.

**The False Lead** is the first boss. Each round it is **immune** to one element and freshly
**vulnerable** to another, both revealed before planning, so a party leaning on one damage type runs
out of answers on the turns that element is locked out. A coverage check, not a stat check. It
fields no elemental attacks itself — giving it an element to be countered in turn would muddy what
the fight is asking. It stands in the **back rank** behind its retinue, which `range` makes
mechanical rather than decorative: melee cannot reach it until the Understudies are cleared.

**Encounters:** Curtain Call, fielding five `Understudy` — one creature repeated, with two abilities
weighted 75 / 25. Deliberately one creature: the thing being exercised is the selector and the
reveal, and five different kits would make a bug in the machinery indistinguishable from a quirk of
one enemy's abilities. The old five-enemy lineup is kept as `BESTIARY` for reference, not deployed.
Numbers are placeholders, not a balance pass.

**Hub screens:** Home (idle scene + claim), Characters (roster, stars, levels), Summon (working
gacha), Inventory (currencies real, items labelled placeholders), Events (real countdowns,
everything disabled and labelled "Not implemented").

---

### The level-to-stage curve

Measured from the damage formula rather than the AI (which is abandoned, and whose verdicts describe
its own priorities). Rounds-to-lose over rounds-to-win, so **>1.0 favours the party**. The table is
the lowest party level at which each stage is an even fight:

```
stage      1    5    8    9  *10   11   12   15   19  *20   21  *30
even at    1    3    6    7   13    9    9   12   16   23   17   32
```

**Regular stages want roughly party level ≈ stage − 3.** Early stages are generous, which is right
for an opening, and the corridor stays a corridor: you walk it at the level the last fight left you.

**Bosses ask for about four levels more than the corridor around them.** Stage 9 breaks even at
level 7 and the stage-10 boss at level 13, so the gate costs a few fights' worth of grind rather
than an act's worth. Clearing it also over-levels you for a while — a level 13 party runs stage 11
at 1.77 — and the corridor catches back up by about stage 15. That rhythm is deliberate: a wall,
then a downhill stretch, then the next wall.

The gate is built from **two** multipliers, not three. The boss runs +3 levels and carries its own
4200 HP; what it no longer does is bring the entire Understudy line with it. It fields a guard of
**two**, rotated by Act so a second lap is not a replay, and those two stand in different columns so
the boss is still behind two live ranks and out of melee reach. Stapling a whole second encounter to
the front of a boss was what turned three multipliers into a fifteen-level wall, and it was the one
of the three that cost the boss nothing to remove — every point of its HP and every degree of its
rotation survived the cut. It also leaves room for the planned *summon more Understudies* ability to
mean something: a boss that starts with two and calls the rest back is a fight, where one that opens
with all five is just a bigger opening.

**Dev tooling exists for exactly this**: a party level box beside the stage picker re-derives every
sheet from the base roster, so any stage can be tried at any level without grinding to it.

## 9. Known issues and open items

**Gameplay**

> Several long-standing issues here are **resolved by design** in `BATTLE_DESIGN.md` and should not
> be fixed in the current system — the fix would be thrown away:
>
> - *Enemies are far too weak* → addressed structurally by simultaneous enemy phases and enemy kits,
>   not by raising stats.
> - *Telegraphs have no counterplay* → revealed intent plus one-round statuses is the answer. You
>   see the attack coming and blind the caster.
> - *Rebar has no identity* → symbols give a guardian a home: a Performer whose symbol is common,
>   who exists to complete other people's chains.

- **Rules text now reads the effect list** (`describeAbility`). It briefly did not, and the ability
  panel confidently described Sunder as a plain hit and Rally as "+20 ATK" — the legacy `power`
  field — while the engine did something else entirely. The generator claims it "can never drift
  out of sync with what the engine actually does", and adding a second way to author an ability is
  exactly how that claim breaks.
- **The auto-battler cannot evaluate an enabler.** `scoreAction` is myopic and greedy: it scores the
  damage an action deals *now*, to the target it names. Benjamin's kit is worth things that land
  later or on somebody else, and the solver cannot see any of it. Measured value per die at level 5:

  | | cost | dice | score | per die |
  | --- | --- | --- | --- | --- |
  | Quick Cut | wildcard | 1.00 | 71 | **71** |
  | Sunder | 6 | 1.42 | 97 | 68 |
  | Perfect Form | 10 | 2.58 | 176 | 68 |
  | Rally | 4 | 1.34 | 36 | **27** |

  Sunder and Perfect Form are scored on their damage alone — the defense shred and the self-buff
  are invisible — and Rally is valued off the legacy flat `power` rather than what it actually
  grants. So the free basic beats everything and the AI plays Benjamin as a stick: in a 400-battle
  sim he casts Quick Cut 5.0% of the time, Rally 1.0%, and Perfect Form **0.1%**.

  This is the `allocate.ts` independence assumption that §4's chains were expected to break, and
  Benjamin reached it first. It matters beyond tuning, because idle is a real game mode: a Performer
  the auto-battler cannot use is useless in AFK play however well he reads by hand. The fix is the
  same one chains need — score an action against the plan it belongs to, one level up, rather than
  in isolation.
- **Stage progression does not exist.** `profile.stage` is always 1; winning does not advance it or
  grant rewards. The battle and idle layers are not yet connected. **Unaffected by the battle
  redesign — safe to build now.**
- **Party is the first five owned characters**, in roster order. No lineup management UI.
- **The summon screen advertises rates it cannot deliver.** Rarity runs **3–5**, and all five
  starters are 3★, so the 4★ and 5★ tiers are empty. `summon()` falls back to the whole pool for an
  empty tier, which means the screen shows 4% / 26% / 70% and hands out 3★ characters 100% of the
  time. Not a code bug — the rate table and the disclosure are still the same value, which is the
  property that matters — but it breaks the "displayed odds cannot drift from applied odds"
  guarantee until 4★ and 5★ content exists. Either add that content or have the screen show only
  tiers with characters in them.
  *(This replaces the old "the 1★ pool is a single character, so 70% of pulls are Aethis" issue,
  which the 3–5 renumbering resolved: every starter now sits in one tier and pulls spread evenly
  across all five.)*
- **No dark character**, so nothing on the roster is strong against the Fallen Seraph.

**Art**

- **The cast has no agreed scale, and the mobs inherit the problem.** Body heights, with the
  pipeline's own outline discounted: Rebar 80, Benjamin 83, Kael 90, Understudies 91–93, Aethis 95,
  Maxine 106. That is a 32% spread with no stated intent, so "the mobs are too tall" has no fixed
  reference — they are taller than three Performers and shorter than two.
  The Understudies at 91–93 are **approved as they are**; three of the five sit 1px over Standard
  and the audit says so, which is close enough to ignore. Settling the Performers' own scale
  classes is the larger and more useful decision — Rebar (80) and Maxine (106) are the two real
  outliers.
- **Maxine is 108 native px**, past the guide's Standard band (82–92) *and* Large (92–104). She sits
  at 0.84 of her canvas while everyone else is 0.58–0.66, so she reads as the tallest of the cast by
  a wide margin. Either bring her to ~86–90 with the rest or make the deviation deliberate — the
  audit will keep reporting it until the numbers agree.
- **Kael, Rebar and Aethis are still v1** and carry the old defects: Kael has 4 delivery px of
  margin where the guide wants 16, and Rebar and Aethis sit 3 native px above the ground line. All
  three are moot once they are rebuilt at 128px, which is the plan — do not fix them in place.
- **The generators anti-alias**, which the guide forbids (§ "no anti-aliasing"). The pipeline copes:
  it keys the backdrop, skips `unmatte` on pixel art, and redraws the silhouette outline. But a
  clean hard-edged export would make three separate heuristics unnecessary — worth trying to get
  right at the prompt.

**Technical**

- **Save is client-side localStorage.** Trivially editable, and the clock is the player's own.
  Acceptable for a friends-only project; see roadmap.
- **Enemies choose by a visible d20 roll, not a hidden weight.** `Ability.roll` is an inclusive
  band (`[1, 15]` fires on 1–15); the roll is made once, kept, and shown. A number can sit at a
  creature's feet where an ability NAME could not — at six enemies there is no arrangement of six
  words that misses everybody. d20 rather than d6 because four abilities on a d6 gives 16.7% steps
  and no way to author "this ultimate fires one time in ten"; d20's 5% steps leave room to shape a
  boss, and it is visibly not the player's die.
  The cost is that a number means nothing until you know the table, so **the detail panel lists the
  creature's whole spread with the current roll highlighted** — that panel is what makes showing a
  roll worth doing at all. A roll landing in a gap, or on something on cooldown, falls through to
  the nearest usable band: a truthful reading of the table would waste the creature's turn.
- **Intents render in one layer over every slot, and health bars are gone from the stage.** The
  label sat above its creature and covered the face of whoever stood behind — with six enemies
  staggered for depth, a label over one head lands on another. Moving it to the feet was not enough
  on its own: rendered *inside* a slot it inherits that slot's stacking context, and a slot's
  z-index comes from its depth, so a nearer creature covered the label of the one behind. Only a
  single layer above all slots escapes both. The feet were free because the health bars left —
  six coloured slivers under six creatures competed with the art, and health is better read in the
  team lists, which show every unit at once.
- **Enemy portraits are derived from the sprite, not drawn.** `derive_icon` pads the whole figure to
  a square. A head crop was tried first and abandoned: it needs the pipeline to know where a face
  is, and it does not — the Understudies wear a plume over the top quarter with the mask below, so
  a crop anchored at the top of the figure returned feathers and a shoulder. Every fix is another
  guess about anatomy, which is the losing game already documented for internal outlines. A shrunk
  full body is honest rather than nearly right, and colour and silhouette are enough to tell five
  variants apart in a 26px row. A hand-drawn `<name>_icon.png` still takes precedence.
- **The battle is two bands, not one with overlays.** The stage takes the top; a dock holds the
  team lists, dice, queue and detail panel across the bottom third. They used to be one layer, and
  it failed twice over: a `.stage-slot` sets its own `z-index` from its depth on the stage (up to
  ~190) against the HUD's 10, so a creature standing low enough **drew over the dice and swallowed
  the click**. Raising the HUD's z-index would have fixed the click and left the panels covering
  the art instead. Docking fixes both and needs no z-index at all, because nothing on the stage
  can reach a sibling row.
  Two things only showed up once the stage got shorter: its backdrop **tiled** into the letterbox
  bars (the frame keeps a 16:9 aspect, and the surround had no `background-size`), now a dimmed
  cover crop; and the two team lists need ~360px stacked against a 300px dock, so they sit side by
  side rather than both being permanently scrolled to one and a half names each.
- **The dock's three columns are sized against the content, not by eye.** Teams | dice and
  abilities | the selected unit's detail. Three separate mistakes made the team lists scroll while
  hundreds of pixels sat unused a short distance away:
  - The teams track was a flat `420px`, so each of the two cards got 195px, every name longer than
    "Rebar" wrapped to a second line, and the enemy card overflowed its band by **61px**. The track
    is now `clamp(420px, 36vw, 700px)` and `.roster .nm` cannot wrap — a row that cannot wrap has a
    height the card can be sized against, and the wider track is what stops the truncation from
    ever biting at desktop widths.
  - The detail track was a flat `310px`, which a fixed grid track reserves whether or not anything
    is in it — a permanent empty column on the right of every fight. It is `auto` now, so it
    measures **0px** until a unit is selected, and `clamp(320px, 34vw, 620px)` once one is.
  - **The detail panel is multi-column.** A selected Performer's sheet is 462px of content against
    a 262px band, so at one column it was 235px into a scrollbar. It is `columns: 210px 2` — and
    multicol rather than grid deliberately, because the content is a *sequence*, not a layout: a
    Performer shows abilities and an upgrade track, an enemy shows a roll table and neither, and
    passives appear only sometimes. Grid would need every group assigned to a column by hand and
    would leave a hole whenever one was absent.
    What may break is the whole trick, and getting it wrong is instructive: forbidding breaks on
    every child looks tidier and packs terribly. The four-ability list is one indivisible 224px
    block against a 262px column, so no column holding anything else could also hold it, and the
    panel spilled sideways into a third column — **trading a vertical scrollbar for a horizontal
    one**. Blocks stay whole, the *lists* flow (`break-inside: auto`) and their rows do not. That
    fits 462px into two columns with zero overflow in either direction, for a Performer, a
    Performer with passives, and an enemy with a roll table.
  - Making that work took two further fixes, both worth knowing. The panel's `width: 310px` was
    silently beaten by a **later shared rule** setting `width: auto` on all three bands at equal
    specificity — order alone decided it. And once the width applied, `min-width: auto` (a grid
    item's default, meaning its content's min-content size) let the stat row's four figures push
    the panel to **490px** anyway. It takes `min-width: 0`, placed after the shared reset, to hold
    the declared width.
- **The battle narrates itself.** A message box above the dice reads "Benjamin uses Cross Slash on
  Red Understudy!" as each action resolves. It sits in the dock, not over the artwork: the
  conventional place for a message box is the bottom of the scene, but the bottom of *this* scene
  is where the front rank stands and where enemy intents are drawn at their feet — a box there
  would cover the two things the sentence is about. Its slot holds its height whether or not
  anything is being said, so the dice never jump.
  Phrasing follows `scope`, since naming a slot for an ability that hit five creatures reads as a
  bug, and the target is looked up among **all** units rather than the living ones — by the time an
  action resolves its target may be down, and that is exactly the line you want when they die to
  it. `actionLine` and `floaterClass` live in `narrate.ts` rather than in the component: they are
  pure mappings with a wrong answer available for every input, and reading sentences off a screen
  one battle at a time is not a test.
- **Floating numbers are coloured by element and flagged on a critical.** Colour says *what hit
  you*, which the number cannot; deliberately not the matchup, because a number that turned green
  for "resisted" would collide with healing. A critical is drawn as a different **event** rather
  than a bigger number — larger, gold, and labelled `CRIT` — which is what makes the one crit among
  five AoE hits legible.
  Legibility over busy scenery comes from a real outline: `-webkit-text-stroke` with
  `paint-order: stroke fill`, so the stroke sits *under* the glyph instead of eating it, with an
  eight-way `text-shadow` as the fallback where `paint-order` is not honoured.
  The floater's *amount* still comes from diffing HP, which catches every source at once —
  including ones that log nothing. The log supplies only the element and the crit flag. Combining
  the two is what lets one merged number per victim stay correct while still being styled.
- **Criticals exist as of this change** (`CRIT_PERCENT`, `CRIT_MULTIPLIER` in `combat.ts`, rolled
  in `applyAbility`). Rolled where the hit *lands*, never inside `computeDamage`, which has to stay
  pure because the forecast panel calls it — a forecast that rolled its own dice would be a
  different number from the one the attack deals, so the forecast shows the ordinary hit and a crit
  is always upside. Rolled per **target**, so an AoE can crit on one victim and not the next, and
  suppressed at zero damage, because "CRIT 0" against an immunity is a worse lie than a plain 0.
  Measured over 300 battles at **12% for x1.5**: a 12.0% rate, no zero-damage crits, 17.2% of all
  damage dealt landing as criticals — a 6% uplift on expected output, which is a flourish rather
  than a second damage system.
  A flat chance for everyone is a placeholder like the rest of the bestiary; the natural next step
  is a crit stat on `CharacterDef` so a Performer can be built around it.
- **Roster rows show the level** (`levelOf`, derived from `powerScale` rather than stored — see
  `levels.ts`). The enemy side is the reason: how far ahead or behind the stage is running was
  previously only inferable from the detail panel's stat line.
- **Two global CSS namespaces** (`styles.css` for battle, `hub.css` for the hub) have now caused
  three collisions: a `.ghost` class made a hub button inherit an absolutely-positioned battle
  overlay and render as a screen-sized ellipse; a `danger-pulse` keyframe was caught the same way;
  and `.unit.enemy { background }` silently beat `.battle .sprite-unit { background: none }` on
  **identical specificity**, painting a dark box behind every enemy that had art. That last one was
  invisible for months because nothing sets a background for player units, so it only appeared the
  day enemies got sprites. CSS modules or a prefix convention would prevent the whole category.

---

## 10. Roadmap

**Next up, roughly in order:**

1. **Rebuild the art at 128px** — Kael, Rebar and Aethis, each with a single idle. Benjamin and
   Maxine are done. The pipeline is ready; see the pre-flight list in §3.
2. **Build the new battle system** — `BATTLE_DESIGN.md`. **Enemy intent, the turn loop, damage
   types, elemental resistance, turn phases and timed modifiers are done.** Remaining, largest
   first: **symbols and chains** (§4), an **auto-battler that can price an enabler** (see §9 — the
   same `allocate.ts` limitation, and the blocker on both), then **statuses** proper (paralyze,
   burn and friends; modifiers already share their clock).
3. **Redesign every Performer's kit** against that document. Damage types, symbols and costs
   authored deliberately against the payability table. The current kits are disposable.
   **Benjamin is built** (`BATTLE_DESIGN.md` §8) — and building him landed most of the remaining
   engine work: Start/End turn phases, timed per-track modifiers, percentage modifiers resolved
   against a named source, ordered effect lists, player-side cooldowns and elementless attacks.
   What he still needs is chains, and an auto-battler that can see what an enabler is worth.
4. **Enemy kits** — mobs currently have one 1.0-power attack each, which is why party actions were
   worth 2:1. Enemies need 1–4 abilities with hidden activation odds.
5. **Enemy art** — they are role badges on a painted stage; the most visible gap.
6. **Stage progression** — winning advances `profile.stage`, grants rewards, raises the idle rate.
   The missing link between the two halves of the game, and **independent of the battle redesign**,
   so it can be built any time.
7. **Party / lineup management** — choose which five perform, and in what order.

**Deliberately dropped:**

- **The balance simulator** (§2). Not the measuring instrument this game is designed around.
- **Enemy difficulty tuning in the current system.** The system is being replaced; tuning it now
  produces numbers that describe mechanics that are going away.

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

- **The Vite dev server died mid-session and the tab kept reloading itself.** `@vite/client`
  reloads the page whenever its WebSocket reconnects, so a dead or restarting server looks exactly
  like the app resetting at random — battles dropping back to the hub, `performance.now()` starting
  over, screenshots timing out. `performance.now()` is the cheap tell, and a `beforeunload` handler
  recording `new Error().stack` names the culprit (`handleMessage` in `@vite/client` means the
  server sent it). Check the server is actually up before debugging the app.
- **Editing files while verifying invalidates the verification.** Vite HMR arrives seconds later
  and Fast Refresh remounts `App`, which resets `inBattle` and drops you to the hub mid-test. Half
  a session's confusing results traced to this. Let edits settle, then test.
- **A hidden or fully occluded tab freezes the document timeline**, so CSS animations sit at frame 0
  and `animationend` never fires. Verified animation logic by seeking with WAAPI (`anim.currentTime
  = t`) instead, which works regardless.
- **Recording only transitions is not enough to verify an animation.** An early check deduplicated
  consecutive identical values, so it could not detect a doubled frame — which was exactly the bug
  (`animation-direction: alternate` with `steps()` holds both endpoints twice).
- Screenshot the UI rather than assuming. It caught the invisible AoE preview, the ellipse button,
  and several sprite scale problems.

**Verification habits that paid off**

- **Measure the pipeline, not just the art.** The audit was reporting "758 semi-transparent pixels;
  guide requires binary alpha" as a delivery defect when the *pipeline* was creating it — `unmatte`
  was feathering pixel art. A lint that reports your own deliberate acts is a lint people learn to
  ignore, so discount them: the margin check now subtracts the outline width it spent.
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
  curve that §5.1 is built on — and under `BATTLE_DESIGN.md` it also changes how affordable chains
  are, which is the whole composition axis. Do not eyeball one; work out what it does to the
  payability table first.
- Sources: story progression, boss victories, achievements, events, Theater upgrades, hidden
  objectives.
- Are seats positional — does a front-row member matter more? Positional would give the upgrade
  system something to sell beyond raw count.

### 12.3 Chains — settled, and moved out

**This section has been superseded by `BATTLE_DESIGN.md` §4.** Chains are no longer a backlog idea;
they are the centre of the battle redesign. Its open questions were answered:

| question then | answer now |
| --- | --- |
| What is a symbol? Element, or something orthogonal? | **Orthogonal**, deliberately. 8–12 in the pool, 2 per character — the density that gives 2–3 live options per team without making chains automatic. |
| Pairs only, or does a 3-chain escalate? | Chains read **forward** from the arming symbol, so a 3-ability chain fires two triggers naturally. Whether to cap at pairs is still open, for the `allocate.ts` reason below. |
| What does a chain do? | **An effect authored on the chaining ability**, not on the symbol — so the same symbol does different things depending on who chains it. |
| Does order matter? | **Yes, and it is the point.** The turn is a planned resolution queue. |

The one prediction from this section that held up exactly: the two composition axes pull in
**opposite directions**. You want costs that do not collide so your team acts often, and symbols
that do collide so your team chains. One roster slot, two competing pressures, no dominant answer.

**The `allocate.ts` warning still stands and is the sharpest technical risk in the redesign.**
`bestPlan` optimises dice→ability assignment assuming each assignment's value is *independent*.
Chains break that: the worth of giving one Performer a 4 depends on whether another also acts. Two
ways out — keep the solver's job as "enumerate affordable sets" and score chains one level up where
the candidate count is small, or restrict chains to pairs to keep the interaction term tractable.

### 12.4 Standing questions from the rewrite

Both of these are now **answered by design** rather than open (see §9):

- **Rebar needs an identity.** Symbols give a guardian a home — a Performer whose symbol is common,
  who exists to complete other people's chains.
- **Telegraphs need counterplay.** Revealed enemy intent (`BATTLE_DESIGN.md` §5) plus one-round
  statuses (§6) is the answer: you see the attack coming and blind the caster. A one-round debuff
  has an exactly legible worth — you negated one enemy action.
