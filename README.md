# Rollbound

A web-based idle gacha game with a Fire Emblem–style tactical battle system driven by dice.

This document is a handoff. It covers what exists, why it was built that way, and what is planned.
Read the "Design decisions worth knowing" and "Gotchas" sections before changing anything — several
choices look arbitrary but were made to fix specific problems.

---

## 1. The game

**Idle layer.** You accrue gold, summon shards, and character XP over real time, capped at 8 hours
offline. Clearing stages raises the rate. This is the loop the game is built around.

**Battle layer.** 5 characters versus 5 enemies on a terrain grid. Each turn you roll **5d6 into a
shared pool**, and abilities cost exact dice sums. A 9-cost ability needs two dice, which means one
teammate does not act. Choosing who sits out is the core decision.

**Progression.** Summon characters, spend duplicates on a branching star tree, spend XP on levels
(gated so your whole roster must keep pace), and buy temporary upgrades mid-battle.

### Platform decision

Web only, no app stores. Vite + React + TypeScript, no game engine. The battle engine is pure
TypeScript with **zero rendering dependencies**, which is what lets the same code resolve idle
stages headlessly and run balance simulations over thousands of battles.

---

## 2. Quick start

Requires **Node 22.18+** — the CLI tools run TypeScript directly via `--experimental-strip-types`,
no build step.

```bash
npm install
npm run dev          # dev server, usually http://localhost:5173
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server with hot reload |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the built output |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run play [seed]` | Watch one full AI-vs-AI battle in the terminal |
| `npm run sim [n]` | Balance report over N simulated battles |
| `python scripts/pack_sprites.py` | Process raw character art into board sprites |
| `python scripts/make_favicon.py` | Regenerate the site icon (SVG + ICO + apple-touch) |

`npm run sim` is the most useful tool in the repo. It has caught every balance and AI bug so far.

---

## 3. Repo layout

```
src/
  engine/          Pure game logic. No React, no DOM, no rendering.
    types.ts       All shared types: Ability, CharacterDef, Unit, Passive, StarNode, SpriteSheet
    rng.ts         Seeded mulberry32. Every battle is reproducible from its seed.
    grid.ts        Terrain, movement (Dijkstra), line of sight, pathfinding, distance fields
    elements.ts    Element matchup wheel
    combat.ts      Damage/heal formulas, targeting, passives, AI action scoring
    allocate.ts    Dice allocation solver — the heart of the game
    battle.ts      Battle state, turn flow, enemy AI, telegraphs, in-battle upgrades
    content.ts     ALL game content: roster, enemies, maps, star trees
    describe.ts    Generates rules text from ability data
    idle.ts        Idle accrual maths (pure, clock passed in)
    save.ts        localStorage persistence
    summon.ts      Gacha rates and rolling
    stars.ts       Star tree costs and effect application
    levels.ts      XP curve, level cap rule, stat growth
  web/
    App.tsx        Hub router + profile state
    BattleScreen.tsx  The entire battle UI (~1770 lines)
    Avatar.tsx     SVG role badges and creature glyphs
    Figure.tsx     Character renderer for menus
    TerrainEditor.tsx  Dev tool for painting map terrain
    screens/       Home, Characters, Summon, Inventory, Events
    styles.css     Battle screen styles
    hub.css        Hub styles
    stars.css      Star tree + levelling styles
  cli/
    play.ts        Terminal battle viewer
    sim.ts         Balance simulator
scripts/
  pack_sprites.py  Art pipeline
  make_favicon.py  Site icon: gold d6 showing the five face
public/
  favicon.svg      GENERATED, do not hand-edit -- see make_favicon.py
  favicon.ico      GENERATED (16/32/48)
  apple-touch-icon.png  GENERATED (180)
  maps/            Battle map artwork
  sprites/<name>/  PROCESSED character art (what the game loads)
art/
  <name>/          RAW source art. Outside public/ on purpose -- see below.
```

---

## 4. Architecture principles

These three separations are load-bearing. Breaking them will hurt.

**1. The engine never imports React.** Everything in `src/engine/` is pure. This is why
`npm run sim` can run thousands of battles in seconds, and why the server can later resolve idle
stage clears with the exact same code.

**2. Progression is folded into character sheets once, before a battle starts.**

```ts
applyStars(applyLevel(def, level), starProgress)  // → a plain CharacterDef
```

Nothing in the damage formula, the AI, or the dice allocator knows that levels or stars exist.
They see ordinary numbers. Order matters: levels first, so a star's percentage is of the levelled
stat rather than the base sheet.

**3. Rules text is generated from ability data, never hand-written.** `describe.ts` turns
`{ power: 1.4, range: 3, aoeRadius: 2 }` into *"Deals 140% of ATK as Fire damage to all enemies
within 2 tiles of a target up to 3 tiles away."* Retune a number and the text follows. A node or
ability can never claim something it does not do.

---

## 5. Systems

### 5.1 The dice economy

Five d6 into a shared pool each turn. Abilities cost an exact sum; wildcards take any single die.

**Simulation over all 7,776 rolls produced two findings that shaped the whole design:**

- **Low costs are the least reliable.** A 1-cost needs a literal `1` on some die — 59.8% of rolls.
  A 9-cost can be assembled dozens of ways — 90.7%. Reliability peaks at 6 (97.4%) and falls off in
  *both* directions. Costs 4–6 are the safe band; 1–2 and 13+ are fragile edges to be used as
  deliberate drawbacks.
- **Cost collision is the real balance lever.** Teams whose ability costs overlap starve each other
  for dice (3.2 of 5 acting); teams with spread costs reach 4.3 of 5. This is *why cost spread earns
  a seat as surely as raw stats do* — Rebar's 2/6/11 barely overlaps anyone, so it acts on turns
  nobody else can.

**Every character has a wildcard "basic"** costing any single die. This removed dead rolls entirely
(dice utilisation is now 4.99/5) without removing the tension: measured over 955 full-strength
turns, 3–4 of 5 characters act, and all-five-act happens only 6.3% of the time. The relationship is
exact:

```
characters acting = 5 − Σ (dice each ability uses − 1)
```

Every die an ability consumes beyond its first benches exactly one teammate.

### 5.2 Grid and combat

- **Terrain**: `plain`, `forest` (+15 def), `hill` (+25 def), `water` (impassable), `building`
  (impassable + blocks sight), `rubble` (+10 def). Movement uses Dijkstra over variable terrain cost.
- **Line of sight** is a separate property from passability — water blocks walking but not shooting;
  buildings block both. Traced with Bresenham; endpoints never block, so adjacent targets always
  connect. Units do not block sight, only terrain.
- **Movement is free and does not cost dice.** A character may move once per turn without ending its
  turn. Using an ability ends the turn outright and forfeits unused movement. So move → act works;
  act → move does not.
- **Elements**: fire → wind → earth → water → fire, plus light ↔ dark (mutual). 1.5× strong,
  0.75× resisted.
- **Damage**: `ATK × power × (100 / (100 + DEF)) × element`, then passive modifiers.

### 5.3 Enemies are NOT built like player characters

This is the single most important content distinction.

- **Enemies roll no dice.** Every enemy acts every turn. They pick the highest-priority ability that
  is off cooldown and has a target. Deliberately predictable — you should be able to look at the
  board and know what is coming.
- Because they act every phase instead of ~2 of 5, their per-hit numbers are **roughly half** a
  player character's.
- **Trash mobs** get one ability and usually no passive. **Elites** get passives. **Bosses** get
  several abilities on cooldowns with priorities, plus multiple passives.
- **Telegraphed attacks**: a boss ability with `telegraph: 1` announces its target area this turn and
  lands at the start of its next phase. Critically it resolves **on the tile it named**, not where you
  moved to — that is the entire point. The danger zone pulses red during your turn.

Passives available: `regen`, `thorns`, `resilient`, `frenzy`, `lifesteal`, `swift`.

### 5.4 In-battle upgrades

Three tiers per player character at **6 / 8 / 12 dice**. Each grants +10% cumulative stats and
unlocks a passive. Costs the character's action, same as casting. The max-HP gain is granted as
healing so upgrading mid-fight does not leave you at a smaller fraction of a bigger bar.

### 5.5 Star tree (permanent, spends duplicates)

Five rungs shaped **choice → converge → choice → converge → choice**. Costs escalate 1, 2, 3, 4, 5
duplicates — 15 total, so 16 pulls of a character maxes them.

The converging rungs (★2, ★4) are deliberately plain stat gains: they are where the branches rejoin,
so they cannot carry an identity-defining effect only half of players would own. All specialisation
lives on the three choice rungs.

Effects are data (`{ kind: 'stat', stat: 'attack', percent: 9 }`), supporting stat percentages,
movement, passives, and ability modification (power / range / dice cost).

**Spare duplicates are derived, never stored**: `copies − 1 − starSpend(level)`. A save cannot drift
into a state where spares and star level disagree.

### 5.6 Levels (spends XP)

Shared XP pool; you choose who receives it. Growth is additive on the base sheet (+8%/level).

**The cap rule** (from the original design brief): the ceiling is set by your **fifth-highest**
character, rounded up to the next multiple of 5.

```
levels [25,25,25,25,20] → cap 25    ← the 20 blocks everyone
levels [25,25,25,25,25] → cap 30
```

Reaching level 26 means dragging five characters to 25 first. This is what keeps a bench worth
investing in. With fewer than five characters owned, the lowest sets the pace.

### 5.7 Idle and summoning

- `ratesFor(stage)` → gold/shards/XP per minute, scaling with stage. Capped at 8 hours offline.
- `accrued()` and `claim()` are **pure and take `now` as an argument** — they never read the clock.
  This is deliberate so the same code can move server-side, where the timestamp is the one thing a
  client must never own.
- Summon rates: **4% / 26% / 70%** for 3★/2★/1★. 30 shards per pull, 270 for ten. The rate table is
  printed on the page from the same constants the roll uses, so displayed odds cannot drift from
  applied odds.

---

## 6. Design decisions worth knowing

Non-obvious choices, each made to fix a real observed problem.

| Decision | Why |
| --- | --- |
| Enemy AI advances every turn regardless of whether it acted | Universal wildcards meant a unit could self-buff forever without closing. Gating advance on "did nothing" left whole teams at spawn until the turn cap — **78% draws**. |
| Movement AI uses a Dijkstra **distance field**, not straight-line distance | Greedy hill-climbing walked units into buildings and stranded them in map corners while the battle happened elsewhere. |
| Buff scoring estimates *actual added damage*, not a flat multiplier | A flat `power × 2 × targets` made a 5-target +30 ATK buff score 300, beating almost every attack. The AI turtled and 25% of battles timed out. |
| Camera and zoom are **derived during render**, not stored in an effect | Measuring the window after mount raced Vite's script-injected CSS in dev, so the board framed at the wrong scale — inconsistently. |
| Camera easing is opt-in (`.world.smooth`) | An unconditional transition made every drag frame animate over the previous one; the map trailed the cursor. |
| Walk animation replays the path with `findPath` | A CSS transform transition interpolates a straight line, sliding characters through walls. |
| Units z-sort by board row | Tall sprites were clipped by whoever stood on the tile above. |
| Sprites are positioned by a measured **foot anchor**, not centred | An outstretched weapon drags the image's centre sideways; centring puts the character off their tile. |
| Damage reactions diff HP rather than parse the log | Catches direct hits, AoE splash, thorns, lifesteal and regen in one place, with exact amounts, and needs no name matching. |
| Health bars sit **inside** the tile, overlaying the sprite's feet | Hanging below the token cut across the head of whoever stood on the next row. |
| Spent characters are **darkened**, not faded | Transparency let the map show through and they became hard to find. |

---

## 7. Content authoring

### Characters

All content lives in `src/engine/content.ts`. A character needs: identity (id, name, rarity, element,
role), stats (maxHp, attack, defense, move), 3–4 abilities including one `wildcard: true` basic,
3 upgrade tiers, and a `starTree`.

**When designing a kit, check cost coverage across the whole roster.** Current spread:

```
2: Kael, Rebar    3: Dart    4: Kael, Tide, Vesper    5: Dart, Vesper
6: Tide, Rebar    7: Kael    8: Vesper    9: Dart    10: Tide    11: Rebar
```

Nothing occupies cost 1 since Cairn was replaced. That is fine — 1 is the least reliable cost in
the game (59.8%) and the wildcard basics already soak lone dice — but it is free real estate for
the next kit that wants a deliberately unreliable option.

### Art pipeline

Raw art goes in `art/<name>/`; run `python scripts/pack_sprites.py` to produce
`public/sprites/<name>/`. The script trims to content, downscales (1.1MB → ~95KB), keys out solid
backgrounds by **flood-filling from the corners** (a colour key would punch holes through dark
armour), and computes the foot anchor. It prints the exact block to paste into `content.ts` and
skips characters whose source is missing.

**Convention: source art faces RIGHT.** The renderer mirrors it when moving or attacking leftward.

### Maps

Map art is a background image behind the tile grid, stretched to `100% 100%` so it aligns at any
zoom. Terrain is authored as character shorthand (`'BBBRPRRPPPPRBBBRP'`) so the town is legible in
source. Use the in-app **Terrain editor** to paint terrain and place spawns over the real artwork,
then "Copy map data" and paste the block into `content.ts`.

---

## 8. Current state

**Balance (60 simulated battles per map):**

```
Market Quarter (17×22)     W60  L0  D0   avg 15.7 turns
Riverside Crossing (10×8)  W54  L0  D6   avg 21.9 turns
```

**Zero losses on either map.** In-battle upgrades, Kael replacing Gale, stars and levels have all
been added on top of enemies that were tuned before any of them existed. An enemy difficulty pass is
the most overdue piece of work in the project.

**Roster:** Dart (3★ fire blade, sprite), Kael (2★ wind blade, sprite), Rebar (2★ light shield,
sprite), Tide (2★ water staff), Vesper (1★ dark dagger).
**Enemies:** Ash Husk, Bog Wisp, Crag Golem, Pale Shade, Fallen Seraph (boss, telegraphs Judgment).
**Maps:** Market Quarter, Riverside Crossing.

**Hub screens:** Home (idle scene + claim), Characters (roster, stars, levels), Summon (working
gacha), Inventory (currencies real, items are labelled placeholders), Events (real countdowns,
everything disabled and labelled "Not implemented").

---

## 9. Known issues and open items

- **Enemies are far too weak** — see above. Start here.
- **The 1★ summon pool is a single character.** Rebar replaced Cairn at 2★, so Vesper is the only
  1★ left and 70% of all pulls are now the same unit. Not a code bug — the rate table is fine, the
  content behind it is thin. The fix is more 1★ characters, not a rate change.
- **No earth character.** Replacing Cairn broke the fire→wind→earth→water wheel on the player side,
  so nothing counters water enemies like the Bog Wisp. Rebar took light instead, which is the roster's
  first, and does counter the Pale Shade. Worth filling with the next earth unit.
- **Stage progression does not exist.** `profile.stage` is always 1; winning a battle does not
  advance it or grant rewards. The battle and the idle layer are not yet connected.
- **Party is the first five owned characters**, in roster order. No lineup management UI. The order
  only decides camera focus and the "next hero" cycle.
- **Scattered spawns on Market Quarter** (edited via the terrain editor) put two characters alone in
  a corner; they used to die piecemeal. Worth revisiting if that map feels unfair.
- **Enemy pathfinding has no dead-end awareness.** It routes around buildings correctly but has no
  concept of retreating from a cul-de-sac.
- **Save is client-side localStorage.** Trivially editable, and the clock is the player's own.
  Acceptable for a friends-only project; see roadmap.
- **Raw art must stay out of `public/`.** Vite copies `public/` into `dist/` wholesale, so source
  art parked there ships to production. This already happened: Rebar's raws under `public/spites/`
  plus a stray `Dart_HQ.png` sitting in the *processed* folder put ~1.9MB of never-requested
  megapixel PNGs into every build. Both now live in `art/`, which is outside the served tree.
  (This also retired the old `public/spites/` folder, whose name was a typo for `sprites`.)
- **Two global CSS namespaces** (`styles.css` for battle, `hub.css` for the hub) already caused one
  collision: a `.ghost` class meant a hub button inherited the battle's absolutely-positioned
  movement-preview circle and rendered as a screen-sized ellipse. CSS modules or a prefix convention
  would prevent the whole category.

---

## 10. Roadmap

**Next up, roughly in order:**

1. **Enemy difficulty pass** — scale enemies to a roster that levels, stars, and upgrades.
2. **Stage progression** — winning advances `profile.stage`, grants rewards, raises the idle rate.
   This is the missing link between the two halves of the game.
3. **Party / lineup management** — choose which five fight, and in what order.
4. **More maps and enemy compositions**, so stages feel distinct.

**Planned, further out:**

- **Server-authoritative idle** via Supabase. The client sends `claim`; the server computes
  `now() − last_claimed_at` against the stage rate and writes the reward and timestamp in one
  transaction. The client never sends a number or a time. `idle.ts` is already shaped for this.
- **Item system** — the Inventory screen lists the four planned slots (upgrade materials, skill
  tomes, element cores, stage keys).
- **Event system** — the Events screen is a shell with real countdowns and no behaviour.
- **Character animations** — idle and attack sprite sheets. This was built once and then removed in
  favour of static art; see the git history of `pack_sprites.py` for the strip-packing approach
  (repack a ragged grid into one horizontal strip, animate with CSS `steps()`).
- **Skill trees** beyond the star tree, per the original design brief.
- **Sprite mirroring already works**; per-character walk/attack animations would slot into `Figure`
  and `UnitChip`.

---

## 11. Gotchas for the next session

**Environment**

- Windows + Git Bash. **Bash heredocs mangle backslashes and sometimes break on quoted content** —
  several edits failed silently this way. Prefer the Write tool or Python scripts with explicit
  UTF-8 for anything containing escapes or unusual characters.
- `dist/` is deleted on every build. **Never leave source art there.**
- Headless Edge screenshots (`msedge --headless=new --screenshot`) work well for verifying UI, but
  intermittently hang against the Vite dev server. Building and using `vite preview` is more
  reliable. Purely a dev-tooling issue, not an app one.

**Verification habits that paid off**

- `npm run sim` after every balance-affecting change. It found the buff-scoring bug, the AI stall,
  the pathfinding stranding, and the boss HP sponge.
- Screenshot the UI rather than assuming. It caught the invisible AoE preview (a CSS specificity
  bug), the ellipse button, sprite scale problems, and misaligned sprite sheets.
- Render candidate values side by side (sprite scales, HP bar positions, movement-range colours)
  instead of iterating one guess at a time.

**Art quirks already hit**

- Sheets from the same artist may disagree on baseline and scale. Dart's idle feet sat at y=238 and
  his attack feet at y=203, and the attack frames were drawn ~1.45× smaller. Always check alignment
  across animations before packing.
- Automated size detection is unreliable when a weapon is the topmost or lowest content. Verify by
  rendering.
