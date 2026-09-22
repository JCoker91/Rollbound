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
  as it actually stands; the two agree except where §5 says otherwise. Chains, statuses, three-rank
  positioning and the mutable dice pool are all **built**. `BATTLE_DESIGN.md` §8 holds the
  per-Performer kit specs; **Benjamin and Rebar are built, four are not.** The bottleneck is now
  **enemy kits** — nothing in the bestiary is worth using any of it on.
- `STAGEBOUND_STORY_REFERENCE.md` — premise, tone, terminology, and the long-term mystery.
- `SPRITE_STYLE_GUIDE.md` — the art standard every sprite is generated against. Non-negotiable
  for anything that ships.

---

## 1. The game

**Idle layer.** You accrue gold, summon shards, and character XP over real time, capped at 8 hours
offline. Clearing stages raises the rate. This is the loop the game is built around.

**Battle layer.** A side-view, Final Fantasy–style turn-based battler: five Performers on the left
against up to seven enemies on the right. Each turn you roll **5d6 into a shared pool** — plus
whatever your line-up contributes — and abilities cost exact dice sums. A 9-cost ability needs two
dice, which means one teammate does not act. **Choosing who sits out is the core decision.**

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

> **Looking for a command or a tool?** `DEV_TOOLBOX.md` is the reference — every script, what it is
> for, and the traps around it. This document carries the reasoning; that one carries the usage.

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

### The simulator is not a balance authority — but it is the only instrument

`npm run sim` and `npm run play` still run, and **their balance verdicts should not be used to make
decisions.** The game is not being designed around them.

**There is a line worth drawing, because the useful half gets used constantly.** The simulator is
worthless for *"is this fight fun / fair / the right length"* — that is an AI playing a game no
human plays. It is excellent for *"does this mechanic do what it claims"*, which is a question about
the engine and not about the design:

- `resilient 10` claimed 10% and delivered **1.3%**. Found by simulating, not by reading.
- The dice pool reads `6 6 6 … 6 5 5 5` across the turn Benjamin falls — the contributed-die rule,
  verified in one line.
- Rally was **25.0% of every player action**, which is what exposed `scoreAction` reading
  `Ability.power` as a flat stat buff for effect-list abilities.

Use it to ask whether a number is real. Do not use it to ask whether a number is right.

They were built before the playable game existed — the wrong order — and the cost showed up twice.
First they measured an AI playing a game no human plays, so their verdicts were about the AI's
priorities rather than the design's. Second, and worse, the battle system they measure is being
replaced wholesale (`BATTLE_DESIGN.md`), so every balance figure they have ever produced describes
mechanics that are going away.

The AI would also need substantial rework to play the new system at all: it scores single actions in
isolation, with no notion of resolution order, chains, or spending a debuff against a revealed
intent. **And it is never going to get that rework**, because there is no auto-battle and no skip —
every stage is played by hand, decided and reasoned in `BATTLE_DESIGN.md` §1.

> It is still worth keeping *honest*, though, for the reason above: a lying AI produces lying
> measurements. `buffStatGain` was a real fix — the buff heuristic read `Ability.power` as a flat
> stat amount, which is true only under the legacy authoring, so Rally's vestigial `power: 20` read
> as twenty flat stat points and the auto-battler spent a quarter of every turn casting it. Fixing
> it dropped Rally from 25.0% of player actions to 2.7% and the corridor fight from 5.2 turns to
> 2.9. Every turn-count figure recorded in this file before that fix was inflated by it.

So the player-side planner has no future use. `simulateBattle` is reached only from `src/cli/`;
`endPhase` and `runAiPhase` are headless-only; `bestPlan` and `nextDiceStep` are reachable only
through those. **Safe to delete whenever they get in the way** — nothing in the game calls them.

One piece of it is still live and must keep working: `scoreAction` backs `chooseEnemyAction`, which
is the fallback an enemy uses when the target it declared has died since the reveal.

### Dev tools

The game ships as it is played — no authoring UI visible. Tools are hidden, not deleted.

### The dev badge

Two fixed elements in the **bottom-right corner** (`DevBadge.tsx`), rendered outside the hub/battle
branch so they are there on every screen — hub tabs, the lab, and mid-fight:

- **The switch**, alone in its own pill. Just the word **Dev** and a lamp. One control, one shape,
  in both states — it briefly grew a row of buttons when flipped on, which meant the thing you
  click kept changing size and position depending on its own state.
- **The panel it raises**, stacked directly above it and titled *Dev tools*: **▶ Anim lab**,
  **▦ Stage lab** and **Reset save**, in a column so the list can grow downward without the switch
  ever moving.

In the hub they sit above the nav bar; in a fight they drop to the corner, which is free there —
the dock stops well short of the right edge. Mid-fight only the switch appears, since neither the
lab nor a save wipe is reachable without leaving the battle first.

**The test-party builder.** **Party** in the battle dev bar opens a builder: pick any Performers
from the whole roster, set a level and star count on each, and field them. **Save roster** names the
result and keeps it in `localStorage`, so a composition survives a reload — which is the whole
point, since the party override is React state and dies with the page.

Sheets are rebuilt from the BASE roster, never from the live party (which already has levels folded
in and would compound), levels before stars so a star's percentage is of the levelled stat. Star
picks are derived: **the first node of every tier, always**. A star level alone does not determine a
sheet — each odd tier is a choice of two — and something has to choose. First is arbitrary but
*stable*, which is what a test party needs: the same saved roster must rebuild to the same numbers
next week, or a comparison between two runs means nothing.

Stored under `stagebound.dev.rosters`, deliberately apart from the player's profile: a test party is
not progress, and wiping one should never touch the other. Entries are validated on read rather than
trusted — the file outlives the roster it was written against, and a member naming a since-renamed
character is dropped rather than allowed to crash the party build.

### Playback speed

A cycling button in the top bar (`▸ 1×` → `▸▸ 1.5×` → `▸▸▸ 2×`), remembered in `localStorage`.
**`2×` is the pace every duration constant in `BattleScreen.tsx` is written at**, so the top of the
range is exactly what the game did before the control existed, and the default is half of it.

A button rather than a dropdown because there are only three stops and they are ordered: a transport
control reads as "more of the same thing" at a glance, where a menu has to be opened before it says
what is in it. It is held to a fixed width, since a label stepping `1× → 1.5×` would resize the
button under the cursor between one click and the next.

**It scales the performance, not the transit**, and that split is the whole design. Stretched: the
clip, the impacts riding its frames, the bursts, the flinch, the tumble and the floating numbers.
Not stretched: the walk downstage, the pause at the mark, the walk home, and the gaps between turns.

That was measured, because the instinct was to scale everything. Benjamin's four abilities run
480–2415ms of clip inside a 2060–3995ms beat — a turn is already more waiting than acting, since
`STEP_OUT_MS + SETTLE_MS + STEP_BACK_MS` is a flat 1580ms of travel and pause whatever the ability
is. Scaling that too would have doubled a second and a half of nothing per Performer, about eight
seconds a round with a full party, and made the game slower without making anything easier to read.
What is hard to read is six numbers landing across a 2.4s swing, and that is what this stretches:

| | mean turn | 5-Performer phase |
| --- | --- | --- |
| `2×` (as before) | 3158ms | 15.8s |
| `1.5×` | 3624ms | 18.1s |
| `1×` (default) | 4556ms | 22.8s |

Two mechanisms, one number. JS timers multiply by `slow` (`FULL_SPEED / speed`); CSS animations that
belong to the performance are written `calc(<base> * var(--slow, 1))` and read a `--slow` custom
property set on the battle root — so a duration does not have to be posted into each element from
React. The `--beat` the walk runs on is JS-side, via `beatOf`, whose `holdStart` / `holdEnd` are
proportions: a stretched clip automatically makes the same 260ms walk a smaller share of a longer
beat, which is the "transit does not scale" rule drawing itself.

The speed lives **only** in the battle. `stepMsFor` is untouched, because it answers "what pace was
this clip authored at" and the animation lab is tuning the drawing, not watching a fight.

### Two layouts: the dock, and cinema

The battle screen has **two arrangements of the same components**, toggled by `▣ Cinema` in the top
bar and remembered in `localStorage`. Nothing is rewritten between them — the same tray, sheet,
rosters and controls, placed differently — so the two cannot drift apart in what they say, only in
where they say it.

**Docked** is the safe arrangement: two grid rows, the stage on top and a 37vh band below holding
everything else. Nothing ever overlaps the artwork, and every number has a fixed place to live. It
costs the picture a third of the screen on every fight.

**Cinema** gives the whole window to the stage and floats the panels. That only works if they earn
their space, and most of the work below is about what "earn" turned out to mean.

#### What is on screen, and when

| | docked | cinema |
| --- | --- | --- |
| dice | pyramid in the bottom band | one slim row under the top bar; hidden while focusing |
| the selected Performer | full sheet in the dock | a **menu**: Abilities · Upgrades · Reposition |
| an enemy, or a hovered roster row | the same sheet | a read-only **card** |
| end phase | pinned in the tray | alone at the bottom centre |
| the opposite roster | always | hidden while focusing |

**A menu, not a flattened sheet.** The first cinema attempt floated the whole sheet, and it failed
twice over: 46vw of panel sat on the cast, and the ability list was below its own fold — so it
covered the characters *and* hid the one thing needed every turn. A dock can afford to show a
Performer's whole sheet at once; a floating layer has to earn every pixel, and what it has to earn
is the list you click. Everything else is one hover away.

**Two hovers, two answers.** Pointing at a **roster row** is a request to *read* somebody: it
focuses the camera on them and opens the full card — stats, matchups, what is on them, their whole
kit. Pointing at the **figure on the boards** is a glance: it puts their action menu up and does
nothing else, no camera move and no card. That is what the menu is good at and the card is not —
running your eye along the line to see who has a chain mark lit.

A peek forces the **Abilities** door open. Inheriting whichever door happened to be open for the
character you last commanded would make the answer to "what can she do" depend on something you did
two turns ago.

Enemies fall through to the card from either hover, because an enemy has no menu — offering
"Abilities" over one implies you could cast theirs.

> **A peeked menu takes no pointer at all** (`pointer-events: none` on the panel *and* its children,
> since `.hud > *` turns it back on one level down). That is load-bearing, not tidy: the panel is
> centred on the screen and the thing being hovered is a body on the boards, so the two overlap. If
> the panel took the pointer, the sprite would lose the hover the instant the menu covered it, the
> menu would close, the sprite would get it back, and the pair would strobe at the frame rate.
>
> The cost is that you cannot hover an ability *row* while peeking, so the rules strip stays empty —
> the marks and the costs are all visible, the sentences are not. Fixing that properly means a hover
> bridge (hold the peek while the pointer is over the menu, cancel on a timer), which is real
> machinery for a preview panel; refusing the pointer is the version that cannot flicker.

The peek is suppressed wherever the pointer already means something else: while an ability is in
hand the cursor is a targeting reticle and `hover` is what aims it, and while the turn resolves
nothing on the board is a control. It also feeds the docked layout's sheet, so pointing at a body
there shows that body's sheet — the dock has no menu, and the alternative was one hover meaning two
different things depending on the layout.

**An action menu and an info card are different objects.** A menu is a list of things to *do*, which
only makes sense for a Performer of yours that you have picked and who can still move. An enemy or a
hovered character is a question about what something *is*, and the answer is a card you read.
Offering "Abilities" over an enemy implied you could cast theirs.

**The card shows a creature's d20 band where a Performer's cost goes.** `Ability.roll` — `[1, 15]`
fires on a 1 through 15 — is what selects an enemy ability, and `cost` is authored at 0 on every
creature. Printing the cost showed a price for something that has none. The band is a rounded
capsule rather than a square chip, because the two answer the same question with different kinds of
answer: a price you choose to pay, versus odds you read.

#### Four things that took more than one try

**Where the panel goes.** It chased the character through four versions — the slot's rect, a
per-frame re-measure to survive the camera, a fixed anchor on the sprite to survive pose changes
(each clip carries its own `placement.scale`, so a Performer cycling idle stances dragged the menu
with every switch). All of them shared one flaw: *a panel beside the character is a panel on the
character*, because once focus pushes in, the character **is** the frame. The answer was to stop
following. Focus slides an ally left and an enemy right, so the panel simply lives in the half that
leaves empty, just inside the centre line. No anchor, no frame loop, nothing to drift.

**The focus offset, and a trap the code already documented.** `LOOK_ROOM`'s comment says the camera
offset is applied *before* the scale, so a fraction written there is multiplied by the zoom. A flat
`0.2` therefore became **113% of the frame** at the ~5.6× focus zoom characters actually get, pushing
them clean off screen. `CARD_ROOM` is divided by the zoom at the point of use, so the number means
what it says: 16% of the frame, at any zoom.

**The paper edge.** The sticker rim — card, ink line, white edge, matching the sprites — was tried as
a spread `box-shadow` and then as an `outline`. Both live *outside* the border box, where a
neighbouring panel paints over them: the white showed at the corners, where nothing is adjacent, and
vanished along the sides. Nothing outside the border box is reliable in a layout made of panels
sitting against each other. The white is now the **border** and the ink line an **inset** shadow,
both part of the element's own painting, leaving `box-shadow` free to do only the lifting.

**Nothing may move under the cursor.** Two separate versions of the same bug. The stack hung from
its bottom, so opening a list pushed the menu *upward* out from under the pointer; and the hover
description was a flow sibling, so it grew the stack and slid the next row under the cursor,
changing the description to something never asked for. The stack is now anchored by its top and the
description is absolutely positioned.

#### Cinema changes one rule of play

**Either order.** The dock is dice-first: you roll, affordable rows light up, you click one —
`chooseAbility` refuses anything the dice do not cover, and `toggleDie` clears the chosen ability on
every toggle. Cinema asks the opposite: "Reposition" is a menu item you click because you have
decided to move, and only then work out which die to spend. Under the docked rule that click did
nothing at all — no error, no highlight, no hint that dice were wanted. Both guards are skipped in
cinema, which is safe because neither was ever what made spending correct: `checkAction` validates
the dice when the action is queued, and always did. The dice then **pulse gold** while an ability is
waiting on them, because the prompt belongs on the control the answer is given with.

**A readied Performer is not selectable.** Their turn is decided; opening their menu offers a second
action they cannot take. Removing the action from the queue makes them available again — the same
gesture as changing your mind about it.

**The battle screen is a stage with two flanking rosters, over one full-width dock.**

- **The rosters sit in the darkened surround** either side of the letterboxed backdrop, centred on
  the STAGE ROW — each side's list on that side of the board. They are grid items sharing the
  stage's cell, not absolutely positioned: abspos centred them on the *window* instead, because a
  grid container is not a containing block by default, so `top/bottom: 0` resolved against the
  initial one. Setting `position: relative` on the container to fix that re-anchored the stage as
  well and collapsed the layout entirely — `align-self: center` on a grid item is the answer.
- **The dock spans the whole width**: the **turn controls** on the left, then the selected unit's
  sheet and a fixed **inspect slot**. Both panels stretch to fill the band. A four-ability kit lays
  out in columns rather than scrolling sideways in a 320px track, which is what it did while the
  dice held the middle.
- **The dice are a pyramid** — three along the bottom, two nested in the valleys above. The trick is
  `flex-wrap: wrap-reverse` on a container exactly three dice wide: the five wrap 3 + 2, reversing
  puts the first line at the bottom, and centring the short line lands it at
  `(3d + 2g − 2d − g) / 2` = half a die plus half a gap, which is exactly the offset that nests each
  one between two below. No per-die placement, and it still reads as a pyramid at 3 + 3 if the pool
  grows to six.

**The sheet is three explicit sections**, not a column flow: identity (portrait, stats, role line,
turn state), the kit (abilities, or an enemy's roll table), and extras (passives, upgrade tiers,
enemy ability text). Each scrolls on its own when it runs long, so the upgrade column outgrowing its
space does not move the abilities beside it.

It was a multi-column box, picked because the content is a sequence whose groups are optional — a
Performer has abilities and an upgrade track, an enemy has a roll table and neither. What multicol
could not do is keep a group *whole*: balancing split the four-ability list down the middle and
stranded the turn badge at the top of a column away from the stats it reads with. The layout was
deciding what grouped with what, and had no way to know.

**Every upgrade tier is shown**, not just the next one — bought ones green with a ✓, the next one
live (gold when the dice cover it), later ones dimmed. Showing only the next tier hid what the pip
track was *for*: it said "three of these exist" and nothing said what the other two were, so the
choice to spend 6 now or hold for 12 could not be made from the panel where it is made.

**The selection survives the turn.** Committing, queueing an action and buying an upgrade all used
to `setSel(NO_SELECTION)`, so the sheet blanked at the exact moment the plan was resolving — the
panel emptied just as you wanted to watch what your turn did to the Performer you were reading. All
three now keep the unit and clear only what is genuinely consumed (the spent dice, the chosen
ability). Note the commit was never the real culprit: queueing cleared it first, so by the time you
pressed commit there was nothing left to preserve.

**The sheet states elemental matchups** for allies and enemies alike — *weak* and *resists* rows of
element-coloured chips, in the identity block under the role line. Resistance is one signed field on
the stat block (negative is weak, positive is resistant), so both rows come from it and the sign
decides which. Two deliberate details: the percentage is written as the **damage** change rather
than the resistance value (a `-50` resistance reads `+50%`, because the question is "what happens
when I hit it", and a negative number under the word *weak* is two negatives to resolve); and a unit
with neither says **"no elemental weakness or resistance"** rather than showing nothing, because
that is a real property — Benjamin is deliberately unaligned — and blank space reads as a panel that
failed to load.

**Every marking on a figure composes into one filter, through variables.** `filter` replaces rather
than adds, and seven rules each set it on `.unit` — so whichever matched last or hardest won
outright and the rest silently vanished. Which one that was depended on game state: selecting a
Performer an enemy had named showed the *threat* glow and no selection glow at all, so the blue
silhouette appeared for some characters and not others depending on who was being aimed at that
round. The same collision kept dropping the grounding shadow, which `.threatened` had to restate by
hand to stop figures floating off the stage floor.

Two channels now, because they answer different questions and both can be true at once:

| | set by |
| --- | --- |
| `--mark` | what the **player** did — selected, queued, in reach, caught by the hovered splash |
| `--threat` | what the **enemy** declared — threatened, or aimed at by the creature under the cursor |

composed as `filter: var(--ground) var(--threat) var(--mark)`. Within a channel the last matching
rule wins, which is the priority order. The danger pulse is the one exception — an animation's
`filter` outranks the composed one, which is right since danger is the loudest state, but it has to
carry the grounding shadow itself.

**A committed Performer glows; they are not boxed.** `queued` was an `outline`, which drew a
rectangle around an irregular sprite and read as a box floating beside the figure. A numbered badge
at the feet was tried next and is worse for the party than it is for enemies: the formation
overlaps, so a label at one Performer's feet lands on the body of whoever stands in front. The
ORDER is already stated in the queue list, where it can also be changed — the board only needs to
say which of them are spoken for, so it is a rim glow.

**Reach is shown on the cast, not with markers under them.** Choosing an ability adds `aiming` to
the stage frame: legal targets get a rim light, everyone else (bar the caster) drops to 32%. It was
an ellipse at each target's feet — a second object per creature, competing for the same few pixels
the intent badges already occupy. Lighting the figures says the same thing with no new furniture,
and it reads faster because the contrast is across the whole board rather than inside one slot. The
gate matters: without `aiming` the board would sit half-dimmed during ordinary play.

> The AoE splash highlight is written **after** the target highlight at the same specificity, so a
> target caught by the hovered blast still turns orange. Reorder them and that feedback silently
> disappears.

**The tray shows no running total.** "10 — 1 ability ready" counted something the ability list
already says, and says better: a row the dice buy is lit gold and one they do not is dimmed. A number
plus a count is a second, worse rendering of the same fact, in the one strip that has to stay narrow.
What it said that the list does not — that a total pays for an upgrade, or for something still
cooling — is visible on the thing itself, since the upgrade chip lights like an ability and a cooling
ability wears its own count. `coolingMatch` went with it.

**A picked die is inverted, not tinted.** It was a slightly bluer fill with an accent border, which
is a difference you can find if you go looking and not one you notice — and "which dice am I
spending" is read at a glance, several times a turn, while looking elsewhere on the board. Swapping
ink and paper cannot be missed and needs no colour of its own.

**The splash preview is chain-aware.** A `scope: 'all'` ability needs nothing special — `unitsHit`
returns the whole side and `canTarget` makes every slot a legal aim point, so hovering any one of
them lights all of them. A chain that *retargets* is the case that broke: Rally is a single-target
buff whose trigger turns it into a whole-team one, so aiming it with the chain live asked for one
ally, glowed on one ally, and then buffed five. `scope` cannot express that, because the widening is
not a property of the ability — it is a property of that particular cast. The preview now asks
`chainFires(armedAfter(plan, armed), ability)` and, when the trigger carries a `retarget`, highlights
what the cast will actually reach. `armedAfter` lives in `battle.ts` beside `chainPreview` and shares
its arming step, because a second copy of the arming rule in the UI would drift from `commitNext` the
first time that rule changed.

It still asks for one body, because that is what the engine does — it resolves the aim and *then*
moves the effects. The click is the same click; only the consequence is wider, which is what the
highlight is there to say.

**A live chain is marked on the ability that would fire it.** `chainFires(liveArmed, a)` per row:
the symbol chip lights (the same `.sym.on` the queue uses), a gold edge runs down the left of the
row, and the trigger's own text appears under the meta line. Until then the only way to know a chain
was live was to remember what had been queued and check the chip against it — and the chip alone
cannot say that Rally is about to buff the whole team instead of one ally, which is the entire
reason to cast it *now* rather than next turn.

The ring is a `::before` sitting in the 6px gap between rows, carrying its own border and glow.
`.ability.ready` already spends the row's border *and* box-shadow on the gold "your dice buy this"
state, and both states can be true at once — a pseudo-element competes for neither, so a ready
chained row reads as both, and `ready`'s glow survives where a second `box-shadow` rule on the row
would have replaced it rather than added to it. The marker is computed from the round, not from the
selection, so it reads the same on a previewed Performer's sheet as on the selected one's.

**The stack is on screen.** The status bar draws every mark in play this round, beside the turn
count — in the bar rather than a panel of its own, because that is what it is, a fact about the
round sitting next to the phase and the turn, and because a bar both layouts already share costs no
new positioning. Two states, and the difference is the decision: a **solid** mark is out, so
anything chained to it fires the moment it is cast; a **dashed** one is only promised by an action
sitting in the queue, true in the order you have arranged and false again the moment you move that
action below the ability meant to use it. Dashed rather than faded — faded reads as "less
important", and this is not less important, it is conditional, which is the thing the reorder
buttons act on. Its tooltip names the queued action doing the arming, since "do I put my chained
ability after that one" needs a name and not just a shape. The engine clears `armed` each turn, so
an empty stack draws nothing at all.

**Cinema's ability rows carry the mark too**, right-aligned so the marks form a column down the menu
— "which two of these four chain together" is a question you answer by scanning, not by reading. It
had been left off deliberately, on the rule that the menu holds only what you need to *choose* and
the hover strip holds what you need to *understand*. The chain mark turns out to be on the other
side of that line: it is not a fact about the ability but about the **board**, and it is the reason
to cast this one now rather than next turn. Without it a player in cinema could watch a chain fire
and never see one coming.

**The chain line shows on every ability that carries a symbol**, in both layouts. Cinema had gated
it on `chainFires`, so it appeared only while the chain was *already* live — which is exactly when
you least need telling, and never while you are deciding whether to set one up. It read as "works on
some abilities and not others" because what it actually depended on was the state of the board. The
same paragraph was also scoped `.rules .sub.chain`, a wrapper only the docked panel has, so on the
occasions cinema did draw it, it came out as an unstyled icon and a run of body text. Both fixed:
the selector stands on its own at two classes, and the lead reads **`Chains now:`** rather than
`Chained:` while the chain is live.

**The mark sits in the corner of the rules box**, not at the bottom beside the clause — a label on
the card, the way a suit sits in the corner of a playing card, so it reads as *what kind of thing is
this* before the sentence under it is read at all. At the bottom it was competing with the chained
clause for the same line and losing.

> A carrier gets the mark and **no text**. There was briefly a `describeArming` returning *"Plays
> Anvil for whoever acts after it."*, written and then removed a turn later: a carrier's entire
> contribution is "this mark will be out", the corner mark says that by being there, and restating a
> shape in prose is exactly the waste the symbols replaced prose to avoid.

**A live chain breathes.** The ring went from 1px to 2px and now pulses on a 1.6s cycle, with the
symbol chip pulsing in step so the two read as one signal. A static gold ring was one more gold edge
on a screen where `ready`, the cost badge and the row border are all static gold, so it read as
decoration — and what it has to say is *available right now, and not next round*. Slow and shallow
deliberately: it is on screen for a whole turn and must not become the thing you are trying to
ignore while reading the row underneath. Under `prefers-reduced-motion` the animation stops but is
held at the **bright** end rather than reverting to the quiet ring; the prominence is the point and
has to survive the preference.

**The cost sentence is gone from the battle screen.** *"Spend any dice totalling exactly 9. Then
unavailable for 3 turns."* was restating, in prose, two controls on the same row: the cost is a badge
on the ability you are reading and a cooldown is a counter drawn over it while it runs. `describeCost`
itself is untouched and the Characters screen still calls it — that page is where a kit is read end
to end, away from the board, and the cooldown has no other home there at all.

> **The cooldown now has no pre-use home in battle.** The counter only appears while an ability is
> actually cooling, so its length is no longer readable before the first cast. That is a real loss
> and a deliberate one; a small `⟳3` chip beside the cost would close it if it turns out to matter.

**The ability list is never hidden.** A kit describes the character; it is not a menu that exists
only while it can be used, and hiding it emptied the widest part of the sheet at the exact moment
the turn was playing out — which is when you most want to read what they can do. While a Performer
is queued or spent the list is marked `inert`: dimmed as one block rather than four separately
disabled controls, since the buttons were disabled anyway (`ready` needs dice selected for that
unit, and a committed one has none).

There is **no "action available" badge**. One existed, and grew to three states — available, queued,
spent — while the kit was being hidden and something had to say why. With the kit always shown and
dimmed when inert, the badge said the same thing twice: `inert` already means "not acting", and the
queue list already names who is committed and in what order. `planAction` guards it either way
(`isPlanned`), so nothing is lost but a line of duplicate text.

**Every Performer has one innate passive**, named, shown as a chip in the identity block and
explained in the inspect slot on hover — the same slot an ability's rules use, so the sheet stays a
list of names and one panel explains whatever is under the pointer. It sits with identity rather
than with the upgrade tiers because it is not something you buy: it is true before any dice are
spent, and it is the line that states what the Performer is *for*.

**`Reposition` is a second chip below it, not a fifth ability.** It is a rule of the **board**
rather than a thing this kit chose — every Performer has it and none of them authored it — so
listing it among four authored abilities said it was part of the kit, which is the one thing it is
not. It is also what made the sheet scroll: five rows did not fit the band, and the correct
structure and the layout fix turned out to be the same move.

It is shaped like the passive chip (both answer *"what is true of this Performer regardless of their
kit"*) but coloured like an ability, because unlike the passive it is a thing you click and spend a
die on. `kind: 'move'` is what separates the two lists, so a future board action lands beside it
automatically rather than back in the kit. **Measured: zero overflow on every panel, for all five
Performers and an enemy.**

| | passive | |
| --- | --- | --- |
| Benjamin | **Drillmaster** | the party rolls an extra die while he stands — see below |
| Kael | Second Wind | frenzy 20 — the reward for being hurt makes walking in a plan |
| Rebar | **Winterhide** | frosted enemies deal 4% less damage per stack, cap 5 — see below |
| Maxine | **Killing Frost** | +10% damage to frosted enemies, +20% to frozen — see §8 |
| Aethis | Quiet Bloom | regen 4 — mends unasked, which frees her turn for somebody else |
| Brax | Slagskin | resilient 10 — flat reduction, for a wall that is not the one attacking |

> **The vocabulary used to be the limit, and Benjamin is why it is not any more.** `Passive` was
> five numeric self-buffs — regen, thorns, resilient, frenzy, lifesteal — so it could say *durable*,
> *vengeful*, *thirsty*, *regenerating* or *desperate* and nothing else. Benjamin's intent is
> **enabling**, and none of those say it; he carried a placeholder `resilient 8` for exactly that
> reason, which this file recorded at the time as "the nearest honest fit rather than the right
> one".
>
> `extraDie` is the sixth kind and the first that is not a number applied to its owner: it puts a
> die in the **shared pool** (§5.1). It is not the general aura mechanism — a passive that reads
> other units is still unbuilt, and is still what the type would need to carry every intent — but it
> settles the one character the gap was blocking, and it is the precedent for the next one.

> **The panel shows INNATE passives only.** `activePassives()` also returns the ones bought upgrades
> granted — correct for the engine, wrong for this panel now that the tiers are all visible.
> Rendering both printed every purchase twice under two different names: Aethis bought *Herbalist*
> and grew a second entry called *regen* doing exactly the same thing.
- **Nothing overlays the stage**, so the cast stands on the floor the backdrop draws.

Five arrangements of the controls were tried before this one, and each failure is worth not
repeating:

| arrangement | what broke |
| --- | --- |
| in the dock's middle column | took the widest space in the layout; the sheet scrolled sideways |
| floating wholly on the stage | fine at rest, but the queue grows a row per action — at three it was 312px tall with every unit behind it, and so unclickable |
| its own `auto`-height band | the stage shrank as you queued, squeezing the artwork to a strip |
| straddling the dock line, full width | reached the team lists, which then needed clearance they had no room for |
| straddling, column 2 only | worked, but the overhang forced the formation off the stage floor — the cast no longer stood on the stage |

One sizing constraint holds the current one together: the dock row is **37vh**, which is what lets
the longest kit fit without scrolling in either direction. (The controls used to need ~560px so the
dice and commit button could share a row — the three-column grid removed that constraint, and the
width it gave back went to the sheet.)

> **Sprite sizes are quantised, so "shrink them a bit" is not available.** `crispCss` snaps each
> figure to whole multiples of `snapPx`, so Benjamin draws at 85px for any target between ~43 and
> ~128 — the next step down is *half*. Reclaim stage space by moving the formation, not by scaling.

**Hovering an ability must not move the page.** Two separate causes, both fixed and both easy to
reintroduce:
1. `.rules` was a block inside the sheet's multi-column flow, so hovering inserted content and every
   column rebalanced — the whole kit jumped under the pointer. It lives in a sibling slot now, of
   fixed width, rendered whether or not anything is hovered.
2. The slot growing could tip the band into overflow, and the scrollbar appearing took ~4px of
   width and reflowed the columns. `scrollbar-gutter: stable` reserves it.

Verified by hovering every ability and comparing every row's position: **0 of 8 move anything.**

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
| **party lv** box | Re-derives the whole line-up from the *base* roster at that level. Empty means "use the real save". |
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
    types.ts       Shared types: Ability, CharacterDef, Unit, Passive, Die, StarNode, SpriteSheet
    rng.ts         Seeded mulberry32. Every battle is reproducible from its seed.
    formation.ts   Slots (2-1-2 party, 2/3/2 enemies), depth reach, stage layers
    hitSplits.ts   GENERATED by the animation lab — how multi-hits divide damage
    elements.ts    Element matchup wheel
    dice.ts        The pool: rolling, paying, and mutating dice (§5.1)
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
    camera.ts      The battle camera: rest framing, focus zoom, centre clamp
    Avatar.tsx     SVG role badges, creature glyphs, ElementIcon, SymbolIcon
    Figure.tsx     Character renderer for menus
    clipAnimation.ts  Sprite-strip keyframe generation and clip geometry
    animationData.ts  Loads the authored art/actors/*/*.anim.json settings
    sceneData.ts   Loads art/scenes/*.json; maps a battle stage to a scene
    stageLayer.tsx    One stage piece, drawn identically in the battle and the lab
    crisp.ts       Rounds figures to whole multiples of one baseline-canvas pixel
    narrate.ts     Turn sentences and floater classes — pure string mapping
    dev.ts         Dev-mode flag (?dev=1)
    DevBadge.tsx   The dev overlay's own control
    devRoster.ts   Dev-only saved test parties (localStorage)
    screens/       Home, Characters, Summon, Inventory, Events,
                   AnimationLab, StageLab
    styles.css     Battle screen styles
    hub.css        Hub styles
    stars.css      Star tree + levelling styles
  cli/           ABANDONED — see §2
    play.ts        Terminal battle viewer
    sim.ts         Balance simulator
scripts/
  pack_sprites.py  Art pipeline: art/ → public/, plus generated metrics
  make_favicon.py  Site icon: gold d6 showing the five face
vite.config.ts     Build config + the dev-only save endpoints (anim, scene, hits)
art/               THE ONLY PLACE ART IS UPLOADED
  actors/<name>/   One Performer: sprite set, icon, animations/,
                   <name>.pack.json (generated), <name>.anim.json (authored)
  background/      Scenery, mirrored verbatim into public/background/
  scenes/          One <id>.json per stage set — AUTHORED in the stage lab
  objects/         Props (not yet consumed)
  enemies/creatures/  One flat 128px PNG per enemy — packed like a v2 actor
public/            ENTIRELY GENERATED — see below
documents/
  README.md                    This file — what IS, and why
  BATTLE_DESIGN.md             The battle system's design doc, and the kit specs
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
rules out of components and lets a server later verify or resolve progression with the exact same
code. It is also what made the abandoned simulator possible — but the principle earns its keep
without it, so keep it.

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

> **The battle layer's MECHANICS are built; its CONTENT is not.** Everything in `BATTLE_DESIGN.md`
> §2–§6 now exists — the turn loop, split defences and elements, symbols and chains, enemy intent,
> timed modifiers, and frost/freeze/sleep. What is missing is things to use them on: four of six
> kits are still placeholders and every enemy has one ability.
>
> The dice economy in §5.1 survives the rebuild unchanged; it is the game's identity and is
> format-independent. §5.5–§5.7 (stars, levels, idle, summoning) are unaffected throughout.

### 5.1 The dice economy

Five d6 into a shared pool each turn, plus any die a Performer contributes. Abilities cost an exact
sum; wildcards take any single die.
**This survived the battle-system rewrite untouched** — it is the game's identity and is entirely
format-independent.

**Simulation over all 7,776 rolls produced two findings that shaped the whole design:**

- **Low costs are the least reliable.** A 1-cost needs a literal `1` on some die — 59.8% of rolls.
  A 9-cost can be assembled dozens of ways — 90.7%. Reliability peaks at 6 (97.4%) and falls off in
  *both* directions. Costs 4–6 are the safe band; 1–2 and 13+ are fragile edges to be used as
  deliberate drawbacks.
- **Cost collision is the real balance lever.** Teams whose ability costs overlap starve each other
  for dice; teams with spread costs act far more often. **Cost spread earns a seat as surely as raw
  stats do**. Rebar's rebuild took him to 2 / 8 / 12, which is uncontested at every step — a
  cheap heal, a mid guard and an expensive ultimate that collide with nobody, so he acts on
  turns the rest of the party cannot afford to.

**Every character has exactly one wildcard "basic"** costing any single die. This removed dead
rolls entirely without removing the tension, and it is the design rather than an exception — a
Performer can always do *something*, whatever the roll.

**The tension is breadth against power, not participation.** Five basics means all five act and
none of them hit hard. One expensive ability eats two or three dice and benches a teammate to pay
for it. The relationship is exact:

```
characters acting = pool size − Σ (dice each ability uses − 1)
```

Every die an ability consumes beyond its first benches exactly one teammate. Measured
`acting/phase` sits near **2.9 of 5**, which is the AI choosing power over breadth roughly twice a
turn — not a shortage of things to spend dice on.

> A stale comment in `types.ts` used to read *"keep wildcards rare; two wildcards on one team
> pushes 'all 5 act' to 70%"*, written when they were scarce. Every Performer now carries one, so a
> five-person team has five, and the warning was steering kit design against the actual design.
> Corrected — but worth knowing the sentence existed, because it argues for the opposite game.

#### The pool is a list of DICE, not of numbers

`BattleState.dice` is `Die[]` — each with an `id`, a `spec` (its faces), the `value` it is showing,
the `rolled` face it landed on, and its own `spent` flag. It replaced a `number[]` beside a parallel
`boolean[]` of what had been spent, which was exactly enough while the pool was five identical d6
rolled once a turn and touched by nothing.

Three rules, in `dice.ts`:

- **Dice are named by `id`, never by index.** Two parallel arrays and a stored index are the same
  bug waiting in two places. Queued actions and the tray's selection both hold ids, so the pool can
  be added to, thinned, or reordered without invalidating a plan built against it.
- **A blank (`value === 0`) is not a small die, it is an absent one.** It can never be spent, on a
  wildcard or on a sum, and `payingMasks` will not return a mask that touches one. That filtering
  used to live in each caller and was missed in one of them.
- **`rolled` is kept beside `value`.** An ability that changes a die has to be legible as having
  changed it, or the pool quietly shows a different number than the one that was rolled. The tray
  draws the original struck through in the corner.

Bitmasks are still how subsets are searched — the right shape for "every subset summing to exactly
7" — but they are computed fresh against the current pool and converted to ids before storage.
`setDieValue`, `doubleDie` and `addDie` are the mutation surface; the shape an ability like *"double
a chosen die this round"* needs is already there.

#### Contributed dice

A passive may put a die in the pool: `{ kind: 'extraDie', die: DieSpec, ladder?: DieSpec[] }`. It is
the first passive that is not a percentage applied to its owner, which is what forced the union to
widen — the other five kinds are self-buffs and cannot express a Performer whose intent is that the
*troupe* does more.

`poolFor` rebuilds the pool every turn from who is **still alive**, which is the whole counterplay:
the die is gone the turn after its owner falls. Verified in simulation — the player's pool reads
`6 6 6 … 6 5 5 5` across the turn Benjamin goes down.

> **Faces are the balance, and blanks are the only lever.** A wildcard costs any single die whatever
> its value, so *lowering* a die's numbers does not weaken it. Over all 7,776 rolls of 5d6:
>
> | added die | cost 1 | 3 | 6 | 10 | 12 | +dice/turn |
> | --- | --- | --- | --- | --- | --- | --- |
> | nothing (5d6) | 59.8 | 78.2 | 97.4 | 92.6 | 89.9 | — |
> | true d6 | 66.5 | 85.5 | 99.1 | 97.9 | 98.3 | +1.00 |
> | d3 | **73.2** | **92.8** | **99.6** | 98.1 | 97.9 | +1.00 |
> | d6, 3 blanks (1–3) | 66.5 | 85.5 | 98.5 | 95.3 | 93.9 | **+0.50** |
>
> A d3 *beats* a true d6 at every cost from 1 to 12 — small dice are precision tools for exact sums.
> Only blanks move the number of dice a turn actually has. A "d3 now, true d6 later" progression is
> therefore a downgrade path, and the blank count is what a ladder should ramp.

### 5.2 Formation and combat

The tile grid is gone. There is **no terrain and no line of sight**, and nobody moves for free — a
Performer holds one slot unless an ability moves them.

**Both sides are three ranks**, and this is a team-building axis rather than decoration:

- `withinReach` computes the *defender's* side and counts **their occupied ranks**, so an enemy's
  `range: 1` means "the party's frontmost occupied rank". The rule is symmetric and always was; the
  party used to be two ranks deep, which left it with nothing to bite on.
- **Occupied**, so hiding everyone in the back just makes the back the front. The formation cannot
  be gamed by evacuating it, which is what lets "attack the front row" be a common enemy shape.
- **A tank is therefore valuable for standing somewhere**, before it has a single tank ability.
  That is why Rebar's kit assumes he is in the front rank and never mentions taunting.

#### The party is a 2-1-2

**Five slots for five Performers**, and both axes are mechanical:

| | asks | read by |
| --- | --- | --- |
| **column** (`x`) | *who can reach me* — rank, front to back | `withinReach` counts the defender's occupied columns |
| **row** (`y`) | *how many of us does this catch* | `scope: 'column'` and `scope: 'row'` |

That second one is what makes it a formation rather than staging. Before, `y` was decorative: moving
a Performer up or down changed nothing any rule could read. **`row` and `column` scopes cut the
formation along either axis**, so the same five Performers catch one attack or three depending on how
they are spread — and the two axes pull against each other, because the column that keeps you out of
an enemy's reach is also the column a column-attack cuts through.

The shape is **two in front, one in the middle, two at the back**. The pairs sit on rows 0 and 2 and
the centre on row 1, so all three horizontal cuts still mean something: `row` 0 and `row` 2 each
catch a front and a back Performer, and `row` 1 catches the one in the middle. A pair sharing rows 0
and 1 would have left row 2 empty and made one of the three cuts free.

> **It was a 3×3 with four slots empty.** The argument for the spare slots was that repositioning
> needs somewhere to go. That stopped being true when repositioning became a swap with any slot —
> a full formation is navigable because you *trade places* rather than step into a gap. What the
> spare slots were really buying was a three-wide front rank, and nothing ever wants three
> Performers in front. Empty slots still occur, but only as casualties: the marker filter is on
> `alive`, so a slot opens when somebody falls, and stepping into a dead ally's place is a real move
> with real consequences for who the enemy can reach.

**Repositioning is a wildcard action every Performer has** — `REPOSITION`, injected into every
player character in `createBattle` rather than authored on a kit, so a new Performer cannot ship
unable to move and nobody has to remember. On the sheet it is a chip in the identity block rather
than a row in the kit list, for the same reason it is injected: it is the board's rule, not theirs.
It costs **any single die and the Performer's action**, the same price as their basic attack, which
is the whole design: moving is not free and not a separate resource, it is *the attack you did not
make*.

**Any slot on your own side.** A reposition may reach any of the five, swapping with whoever is
standing there.

> **This used to be one orthogonal step**, on the reasoning that free placement makes the grid a
> menu and that one step prices the corners — a centre slot has four neighbours, a corner two. That
> is a real argument and it was overruled deliberately. Once marks are placed by hand per scene,
> adjacency stopped reading off the board at all: a player cannot tell which squares are one step
> away, because the squares are wherever the scene author put them. The rule was charging a cost
> nobody could see to protect a decision nobody could make on purpose. What still prices the move is
> the part that was always doing the work — a die and the whole action.

**Where a Performer stands to act** is `DOWNSTAGE`, one mark per side, and both cross the middle
toward the opponent. A scene may override them with its own `acts` marks (§7 Scenery).

Two type-level pieces make it work, and both are narrow on purpose:

- **`scope: 'slot'`** aims at a *square* rather than a unit, occupied or not. That is the one thing
  `one`/`all` cannot express, and it is why the fizzle guard now checks `scope === 'one'` rather
  than `!== 'all'` — an empty square is the point, not a failure.
- **`do: 'reposition'`** walks the caster into the aimed slot, **swapping** with any occupant. The
  swap is what makes it safe under commit-and-lock: a reposition queued behind another can never
  find its destination taken and fizzle, which would be a silent loss of the die it was paid for.
  Every reposition resolves.

It carries **no symbol**, deliberately — arming a chain with the cheapest action in the game would
make repositioning the best chain opener, and the arming decision is supposed to cost something.

**Performers walk.** `.stage-slot` transitions `left` and `top` over 420ms, so a reposition is a
figure crossing the stage and a swap is two of them passing each other — both animate off the same
state change. It works because units are keyed by character id, so React keeps the DOM node to
animate; unkeyed they would be torn down and rebuilt at the destination, which is a teleport.
Slower than the 220ms lunge on purpose: a lunge is a jab that snaps back inside one action.

**Aiming at slots needs the floor clickable, which is a different problem from aiming at bodies.**
A `.stage-slot` is a box the height of its sprite, so a unit in a nearer row has a box covering the
slots behind it — the click landed on a bystander's *transparent pixels*. The `moving` class (set
when the aimed ability is `scope: 'slot'`) is what fixes it, and the load-bearing part is
`pointer-events`, not paint order:

| while `moving` | |
| --- | --- |
| bystanders | `pointer-events: none`, opacity 0.2 |
| **the mover's own box** | `pointer-events: none`, opacity 0.72 |
| swappable neighbours | clickable, **green** rim — a trade, not a hit |
| footprints | `z-index: 250`, above every unit |

The mover being click-through *and* semi-transparent is not belt-and-braces: rows are ~13% of the
stage apart while a sprite is ~30% tall, so **the slot behind you is always somewhere on your own
body**. The figure most likely to be covering the footprint you are trying to read is you.

> **Two z-index traps, both silent.** The footprint carried an inline `zIndex` copied from the unit
> pattern, and an inline style beats the stylesheet — so the `z-index: 250` meant to lift it over
> every sprite never applied and footprints sat at 161–183, *among* the units. Depth ordering was
> wrong for them anyway: a marker is not a body. And the green swap glow was written before the
> `.aiming` rules at **equal specificity**, so order alone silently discarded it — the third time
> that has happened in this file.

> **A `Pos` does not say where on the stage something is.** The party occupies columns 0–2 and the
> enemy block 2–4, so **column 2 is both the party's front rank and the enemy's** — a deliberate
> overlap the rules are fine with, because every reach question is asked about one side at a time
> (`withinReach` resolves the defender's side first). A *renderer* is asking a different question,
> and `slotAt` searched the party first and took the first match: every col-2 enemy drew at a party
> slot, so **the front two enemies' intent dice appeared under the front two Performers**. It takes
> a `Side` now, and so does `Floater` — anything mapping a position to a drawing needs to know whose
> board it is on.

> **A fill list masquerading as a board.** `slotFor` looked a unit up in `encounter.partySlots` —
> which is a *fill order*, and back when the board was a 3×3 it listed only seven of the nine — so a
> Performer who repositioned into either of the other two found no slot and **rendered as nothing**.
> It reads the whole `PARTY_SLOTS_ALL` now. Anything that maps a position to a drawing must use the
> board, never the deployment list. The 2-1-2 makes the two lists the same five, which hides the bug
> rather than fixing it; the fix is that they are no longer the same *lookup*.

> The AI scores `kind: 'move'` at **zero**. It has no positional sense at all, and an auto-battler
> that repositions at random is worse than one that never does. That is correct behaviour, not a gap.

**The older relative `move` effect still exists** — `{ do: 'move', ranks }`, shifting whole ranks,
with one unit swapping and a group *shifting* so a blocked line stays a line rather than shuffling.
The two coexist on purpose: a kit ability that shoves a line back a rank does not want the player
picking destinations, and a Performer choosing where to stand does. No kit uses it yet.

**Which Performer starts where is the party's own order** (`STANDARD_PARTY_SLOTS` is a fill order
over the five). The default spread is deliberately *reasonable rather than optimal* — a
starting formation with nothing wrong with it gives the mechanic nothing to do. Rebar stands in
front because he was moved to second in `ROSTER`, which is a stopgap and commented as one; in-battle
repositioning is the interim answer to the missing lineup screen.

**Slots carry two coordinate systems, deliberately kept apart:**

| | Used by | Purpose |
| --- | --- | --- |
| `col` / `row` | The rules | Integer formation grid |
| `xPct` / `yPct` | The renderer | Where to draw on the backdrop |

Splitting them lets the art be arranged for stage perspective — staggered, foreshortened, nudged
onto a painted floor — without the rules caring, and lets the rules be reasoned about as a small
tidy grid without the art being forced onto one.

Party: 5 slots over 3 columns, 2-1-2. Enemies: 7 slots over 3 columns in a 2 / 3 / 2 pattern.

> **The rules grid is packed TIGHT while the draw positions are spread out.** A first attempt
> staggered the rules grid to match the art, every slot ended up 2 apart, and a radius-1 AoE could
> only ever hit its own target — War Cry and Hallowed Grove fell to 0.1% usage in simulation.

**`range` means depth reach**, not distance: how many enemy ranks an ability can reach into,
counting **only columns that still hold someone alive**. Counting occupied columns is what stops
melee being locked out — clear the front rank and the next becomes the front. This is what makes
formation worth arranging: a boss behind two ranks of adds cannot be touched by a melee basic until
the adds are gone. Support abilities are exempt; gating heals on
depth would add fiddle without adding a decision.

**Target scope:**

| `scope` | reaches | `range` applies? |
| --- | --- | --- |
| `one` (default) | a single unit | yes, for attacks |
| `self` | the caster, and nothing else | no |
| `all` | every living unit on the affected side | no |
| `column` | everyone sharing the aimed slot's column — one rank, front to back | yes |
| `row` | everyone sharing the aimed slot's row — one file, across all ranks | yes |
| `slot` | a *square* on the caster's own side, occupied or not | no |

`column` and `row` are named by the **line** they cut, not by the slot pointed at — "every enemy in
one rank" is what the player arranges against, and which square was clicked to say so is an input
detail. `slot` exists for repositioning and nothing else.

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
- **The stat scale is small, but not so small that rounding eats it.** A level-1 Performer has about
  **50 HP** (the five 3★ starters average exactly that); the average hit across a battle is **13**,
  so it takes ~4 of them to drop a Performer. Basics land for 4–9, ultimates for 10–27. An HP bar
  the player can count is worth more than one reading 780, and −15 of 44 registers as an event in a
  way −53 of 780 never did.

  > **It was ~12 HP first, and that was too small.** At an average hit of 2.8, **27% of all damage
  > landed on the `max(1, …)` floor** — so every percentage effect in the game was being partly
  > discarded, and `resilient 10%` delivered 1.3%. Multiplying HP and ATK by four (DEF untouched —
  > mitigation is a pure ratio and already scale-free) moved the average hit to 13 and dropped
  > floor-hits to **0.0%**. Every percentage now delivers what it claims, exactly.

  Two things carried the old
  balance across the change: `DEF` and `MITIGATION_ANCHOR` were divided by the **same** number, so
  every mitigation percentage is exactly what it was; and everything scaling off ATK — damage,
  heals, lifesteal, thorns — moved together, so their ratios held. Heal powers were then trimmed
  ~35%, because damage is rounded *after* mitigation shrinks it while heals are not mitigated at
  all, so at this scale rounding is all downside for one and all upside for the other (left alone,
  a heal was worth 1.4× what it used to be against the same hit).
- **ATK and DEF are in TENTHS of a damage point** (`ATK_PER_DAMAGE = 10`). That is what lets a sheet
  read `ATK 26 · P.DEF 50` while the hit it pays for lands as 2 on an 11 HP bar. Small HP forces
  damage to be a small integer, and a stat that moved in whole damage points would have no
  resolution left — ATK 2 to ATK 3 is a 50% step where the roster was authored at 37%, and +10% of
  it rounds to nothing. So the stat is measured in a finer unit than its output and the formula
  divides once, at the end. **Every stat on every sheet is a whole number**, which is what let the
  fractional-stat plumbing this replaced be deleted: `baseStat`, `applyLevel`, star nodes and
  `resolveModifierAmount` all round again.

  > Anything comparing a stat against a damage figure has to divide. The AI's buff heuristics do,
  > and that was where a real bug was hiding — see `buffStatGain`.
- **Percentage passives bank their remainder** (`Unit.carry`). 4% of a 9 HP healer is 0.36, and
  both roundings are wrong: down means regen never fires at all, and a `max(1, …)` floor pays a
  whole point every turn — 11% of the pool instead of 4%. Banking the fraction until it is worth a
  point makes the tuning number mean what it says. Regen, thorns, lifesteal and `resilient` all use
  it, and they still need it after the units change: those bank fractions of **HP and of damage**,
  which really are small integers.
- **`resilient` was the worst case of it, and it was silently broken.** It multiplied damage before
  rounding, and damage is usually 1, 2 or 3. Measured against the damage the game actually deals, a
  stated 8% delivered **0.7%** and a stated 10% delivered **1.3%**, while 18% delivered 21.3%.
  Re-tuning could not have fixed it: 3 is the modal hit and `3 × 0.85` rounds back to 3, so a single
  point of resilience flips 37% of all damage at once — a cliff, not a curve.

  | stated | at ~12 HP, unbanked | at ~12 HP, banked | at ~50 HP |
  | --- | --- | --- | --- |
  | 8% | 0.7% | 5.4% | **8.0%** |
  | 10% | 1.3% | 6.7% | **10.0%** |
  | 15% | 7.8% | 10.0% | **15.0%** |
  | 18% | 21.3% | 12.1% | **18.0%** |
  | 30% | 27.9% | 20.0% | **29.9%** |

  **Banking fixed the cliff; the scale fixed the shortfall.** Both were needed and both are still
  needed — banking is what makes a percentage exact rather than lumpy, and it is still doing work on
  regen, thorns, lifesteal and `chill`. Author against the right-hand column: numbers now mean what
  they say.

  > Split into `peekResilience` and `spendResilience` because **`computeDamage` has to stay pure**:
  > the forecast panel calls it to show what a hit *would* do and the AI calls it dozens of times a
  > turn, and neither may advance the defender's bank. `strike` spends it once, where the hit lands.
  > Both read the same carry, so the forecast is exact. Forgetting the spend fails closed — a bank
  > that never advances never reaches a whole point, so resilience just stops applying.
- **Stats are one offensive number and two defensive tracks.** `attack` drives physical hits,
  magical hits *and* healing, so anything that raises ATK is worth the same to a blade, a staff and
  a healer. Defence splits into `physicalDefense` / `magicalDefense`, which is why a shred can be
  pointed at one of them.
- **Timed modifiers replaced flat buffs.** `Unit.modifiers` is a list of
  `{ability, stat, amount, turns, by}`; the old `atkBuff` / `defBuff` pair — two numbers decaying
  10 a turn, applied to both defence tracks at once — could not express a duration, could not tell
  two sources apart, and could not name a track. See **§5.2b** for the stacking and percentage
  rules, which are the part with teeth.
- **Damage**: `ATK × power × (ATK / (ATK + DEF)) × elementResist`, then passive modifiers — where
  `DEF` is the track matching the ability's **damage type**, including any modifiers on it.
- **Armour is measured against the ATTACKER. There is no mitigation constant.**

  | | lands | effective HP |
  | --- | --- | --- |
  | DEF = 0 | 100% | ×1.0 |
  | DEF = half their ATK | 67% | ×1.5 |
  | **DEF = their ATK** | **50%** | **×2.0** |
  | DEF = twice their ATK | 33% | ×3.0 |

  **Equal stats halve the blow.** That is the whole reason this replaced a fixed `MITIGATION_ANCHOR`
  of 100: `DEF 50` meant nothing against `ATK 104` — the two were the same size by coincidence and
  unrelated by construction, so nothing on a sheet told a player what a point of armour was worth.
  Now DEF is read against the ATK opposite it.
- **Mitigation is a ratio, not a subtraction.** `K / (K + DEF)` has diminishing returns, never goes
  negative, never reaches immunity, and buys a constant slice of effective HP per point.
  Subtractive `ATK − DEF` has none of those: it needs clamping at zero, creates hard thresholds
  where an attacker flips from useful to useless, and makes many small hits worthless against
  armour.
- **Level-invariance is structural, not a trick.** Both sides of `ATK / (ATK + DEF)` carry the same
  level scale, so it divides out: **mitigation measures 0.722 at levels 1, 20, 40 and 80**, and a
  fight is 4.7 hits at every one of them. The previous form needed `powerScale` threaded into the
  damage formula to cancel the defender's growth — one more thing that could go stale, and it is
  gone. `powerScaleOf` was deleted with it.

> **No separate level-difference multiplier exists, deliberately** — the opposed form produces one
> for free, because the two sides' scales no longer match when levels differ.
>
> **But it is small, and the docs used to credit it with far more.** Measured, mitigation moves only
> **1.19× to 0.86×** across a ±10 level gap. The real level-gap effect is large — a level-20 party
> has a **5.06×** advantage at stage 10 and **1.05×** at stage 30 — but it comes from ATK and HP
> scaling on opposite sides, *not* from mitigation. An earlier note here claimed the anchor gave
> "×0.42 to ×1.62", which would have sent anyone tuning it to a lever that does almost nothing.

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
  never be wrong, and the never-wrong option erases the decision. At ~55% power its crossover sits where
  **DEF is about 80% of the attacker's ATK** on both tracks: worse than typed against a mob, better
  only against something genuinely armoured against everything.
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

**Live modifiers are shown, with their clocks.** They were stored, resolved and expired correctly
and displayed nowhere — `ATK 130` on the sheet is not a fact about Benjamin, it is a fact about
Benjamin *this turn*, and nothing said which part of it was about to lapse. `modifierGroups` in
`narrate.ts` groups a unit's modifiers **by the ability that applied them**, which is how the engine
stores them: one cast of Rally is one thing with one clock that happens to move three stats, and
three flat rows would read as three buffs that might expire apart. They cannot.

The sheet is the only surface: a chip per cast — source, amounts, turns left — under the stat row,
because these are those numbers' second half. A pair of `▲`/`▼` stage badges was built first and
removed. A unit can carry three modifiers on three schedules and a badge has room for one clock, so
it could only answer by picking a winner and implying the rest were not there; anything honest
enough to fix that is a list, and a list does not belong on a character's head. Hovering a Performer
already exists to answer exactly this class of question — the same glance that reads their dice
costs now reads what is on them. Statuses stay on the stage because frost *is* one number, and one
the design asks you to count before spending dice.

The chips also make the stacking rule visible: recasting Rally rewrites its chip's numbers and
resets its `t` rather than adding a second one, while Perfect Form lands beside it as its own chip
with its own clock.

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

> **`scope` and `on` are different questions, and pinning one does not answer the other.** `scope`
> decides where an ability may be POINTED; `on` decides where each effect LANDS. Three abilities had
> effects pinned to `on: 'self'` and no `scope`, so they defaulted to `one`: Hibernate, Frost Armor
> and Bulwark all offered every ally as a legal target, applied to the caster whichever you picked,
> and printed "heal · any ally" underneath. All three are `scope: 'self'` now.
>
> **The same confusion made Bulwark's chain trigger inert.** `retarget` deliberately moves only
> effects aimed at the ability's own target and leaves anything pinned to `self` alone — a trigger
> that widened a self-buff would be changing what the ability *is*. Bulwark's effect was pinned, so
> the chain fired, the log announced *"guards the whole team instead of himself"*, and **exactly one
> unit was buffed**. Scoped to self with the effect left on the default `target`, the base case is
> identical and the trigger works: measured, 6 units buffed instead of 1.
>
> The general shape: **if an ability only ever affects its caster, say so in `scope`.** Pinning the
> effects says it too quietly, and the parts of the engine that ask "where may this be aimed" and
> "what does a trigger move" both read `scope` and `on` respectively.

> **The effect-list heal forgot to divide by `ATK_PER_DAMAGE`, and nothing caught it for a session.**
> `computeHeal` (the forecast) divided; the resolution path in `battle.ts` multiplied ATK by the
> power and stopped. Hibernate healed **54** while the panel beside it promised **5** — a factor of
> ten, in the direction that looks like generosity rather than a crash. Both now call one function.
>
> This is the third instance of the same shape: **two readers of the same authored field, disagreeing**
> (`describeAbility` vs the engine, `scoreAction` vs the engine, now the forecast vs the engine). When
> a value can be read two ways, make one function the only reader.
>
> `do: 'heal'` also gained `of: 'attack' | 'maxHp'`. Support heals scale off the caster's ATK so a
> healer cannot out-damage the blades; a **tank's self-heal** scales off max HP, because the ATK rule
> gates them on the stat they are deliberately worst at. Rebar's Hibernate is the only user.

> A brief bug worth remembering: `describeAbility` kept reading the legacy fields after the effect
> list landed, so the ability panel described a damage-plus-shred as a plain hit and a percentage
> buff as "+20 ATK". The generator's promise is that it *cannot* drift from the engine — adding a
> second way to author an ability is exactly how that promise breaks.

**Cooldowns work for the player now.** `Unit.cooldowns` and its per-turn countdown were always
side-agnostic, but only the enemy path ever set or read them, so a player ultimate with a cooldown
could be cast every turn. `checkAction` and `commitAction` respect it, which is what the player
meets; `bestPlan` respects it too, though nothing reachable from the game calls that. A cooldown is
set to `cooldown + 1` on use because Start Turn counts every cooldown down including the turn it
was cast on, so **a 2-turn cooldown locks out the next two turns** and is ready on the third.

**Ultimates default to 3 turns.** `Ability.ultimate` is a flag, not a number, and
`cooldownOf(a) = a.cooldown ?? (a.ultimate ? ULTIMATE_COOLDOWN : 0)` in `types.ts` is the only
thing that reads it. All three cooldown set-sites in `battle.ts` and the describer go through it,
so raising or lowering `ULTIMATE_COOLDOWN` moves every ult at once while a hand-written `cooldown`
on one ability still overrides it — which is how these numbers are expected to be tuned. The seven
ultimates carry the flag and no number.

The cooldown is **stated on the sheet** now: `describeCost` appends "Then unavailable for N turns."
It used to appear only in `describeEnemyUsage`, so a player's own ultimate declared its cooldown
nowhere and the lockout arrived as a surprise. In battle a cooling ability stays in the list under a
dark sheet with **N turns** centred on it — shown rather than hidden because the count is the point,
and deliberately a different look from `.locked` ("no dice in this roll can pay"), which comes back
the moment the dice do.

Two things that cost a revision each. **Where the number goes:** it sat on the cost badge first, then
in a pill at the row's right edge, and both read as a price — a small numeral anywhere on an ability
row joins the scan the player is running down the cost column against their dice, whatever it means.
Covering the row says "not this one" before the number is read at all. **What dims the row:** not
`opacity`. It composites the whole subtree, so anything faded takes the counter with it and no child
rule can rescue it (`filter: opacity()` clamps at 1, and composites after the parent rather than
against it). The base `button:disabled { opacity: .4 }` applies to every cooling row, so
`.ability.cooling` sets `opacity: 1` and the dimming is the overlay's own alpha.

### 5.2c Statuses — frost, freeze, sleep

`Unit.statuses` holds `frost`, `freezes`, `frozen`, `asleep`. The rules and the reasoning are in
`BATTLE_DESIGN.md` §6; what a reader of the code needs:

- **Frost is a shared resource, not an effect.** It does nothing on its own. Reaching
  `3 × (freezes + 1)` freezes the target, **spends** the stacks and raises the bar. Consumption is
  what makes 3 / 6 / 9 an escalation — leaving them on would make every freeze after the first cost
  the same three.
- **It decays 1 a round**, at the End Turn of the side that **carries** it, so a stack always
  survives exactly one of the frosted unit's own turns. It used to decay on the *applier's* End
  Turn, which ran before the frosted side had acted — `startEnemyPhase` ends the player's turn and
  then hands over — making any one-stack-a-round source **inert** rather than weak: a Performer acts
  once a round, decay cancelled it exactly, and the stack never existed for chill or the bar to
  read. The rate is unchanged, so accumulation speed did not move; only whether the stack is alive
  for the turn it was meant to affect.
- **One stack a round still nets zero, and that is a use.** It cannot reach the bar alone, but it
  *holds* the target at one stack — chill reads it every enemy phase, and the target stays one step
  nearer the threshold for anyone else feeding it. That is the job of a **wildcard**: spending a die
  that would otherwise go unused to keep the frost from melting is maintenance rather than
  construction, and a specific reason to cast one. Accumulation still takes more than one stack a
  round or more than one Performer, which is the composition goal enforcing itself — below ~3 a
  round a frost team gets one freeze a fight.
- **Frost does not stack on the frozen — it shatters** for `SHATTER_PER_STACK` (4) damage each, flat
  and unmitigated. Freezing something must not also be the cheapest way to set up freezing it again,
  and nothing is lost by spending frost into a frozen target.
- **A freeze is held for the whole phase it denies** and consumed at that phase's End Turn, for both
  sides — one place, symmetric. It used to be burned per-unit in two different places, which cost
  nothing in balance and almost everything in legibility: the chips vanished one at a time as the
  enemy phase walked the line. Frozen from the instant the stacks max out, frozen for the entire
  phase being missed, thawed when it is over.
- **Freeze costs an action, not a turn.** Frost landing on your turn cancels the enemy phase that
  follows, including a declared intent; frost landing reactively, mid-swing, takes the next action
  instead of being wasted. One rule, both directions.
- **A frozen enemy declares no intent**, which is the payoff — the player sees the gap before
  planning and spends the turn elsewhere.
- **The count is on the CREATURE**, in the badge column above it: `❄ 2/3`, or a filled `❄ frozen`
  when it lands. It was on the roster rows only, which is the one place it could not do its job —
  the design rests on the count and the bar being visible so freezing is a decision made *before*
  the dice are spent, and a number in a side panel is not competing on equal terms with the intent
  die drawn at the creature's feet. Shown as a **fraction** because the bar is the half that moves:
  after a freeze it reads `2/6`, which is the escalation stating itself without a word of
  explanation.
  > Rendered for **both sides**. Nothing frosts the party yet, but `frost` is a status like any
  > other and a party that could not see its own would be a bug waiting for the first enemy that
  > applies it. Sleep is already player-side — Rebar puts himself under.
- **Sleep wakes on any damage**, and a sleeping unit cannot be planned.
- **Regen is a COUNT of heals owed, not a duration.** `Statuses.regen` holds charges; one is spent
  at Start Turn for 10% of max HP. A duration could not keep the promise on the sheet: a status
  applied mid-turn has already missed that turn's Start, so "2 turns" counted down at End Turn
  leaves exactly **one** tick. Charges make the number honest whenever it was applied — the same
  shape `frozen` already uses for actions owed.
  > This is the line §6 calls "two clocks — do not conflate them": **`Modifier` is the thing with a
  > duration, `Statuses` are counters.** Tick effects belong on the counter side, and reaching for a
  > duration is what makes an N that does not deliver N.
- `Modifier.riposte` is the one reactive hook: *"frost the attacker when the holder takes damage of
  this type."* It rides on the modifier so it expires with the buff, and no code anywhere has to
  know the string "Frost Armor".
  > **Reactive frost is worth less than proactive frost.** A riposte stack lands mid-enemy-phase,
  > after the attacker has already swung, and melts at that phase's End Turn — the player cannot
  > bank it. No single decay point serves both, because the two application moments sit at opposite
  > ends of the round; the proper fix is aging stacks individually, which is not worth the machinery
  > until a second reactive source exists.

`Modifier.stat` is a `ModKey` — a `ModStat` **or** an `Element`. Timed elemental resistance shares
the modifier list rather than living in a parallel structure, because it wants identical behaviour
and the two unions are disjoint. None of the duration machinery had to be written twice.

### 5.2d Conditional power — reading the board into a number

A family of mechanics added with Maxine, all resolving inside `computeDamage` rather than at
resolution time. **That placement is the whole point**: `computeDamage` is what the forecast panel
calls, so a conditional payoff is visible *before* dice are committed. Under commit-and-lock a bonus
the player cannot see until afterwards is one they cannot plan around.

| on | field | means |
| --- | --- | --- |
| `Ability` / damage `Effect` | `versus: { frozen: n }` | REPLACEMENT power against a target in that state |
| `Ability` / damage `Effect` | `perFrost: n` | added power per frost stack on the target |
| `Passive` | `exploitCold { frosted, frozen }` | this character deals x% more to cold targets |
| `Passive` | `frostFervor { percent }` | +x% ATK per stack landed on the other side, this turn |
| `Passive` | `freeCastOnFreeze { ability }` | on any freeze, that ability next costs one die |
| `ChainTrigger` | `sharpen: n` | added to `perFrost`, where scaling already exists |

`powerAgainst(ability, target)` is the single place the first two resolve. **`versus` replaces
rather than multiplies** because the sheet says *instead*: a multiplier would compound with the
element wheel and with crit, and the ability would pay more than its own text promises.

**`perFrost` is capped by a rule that already exists** rather than by a number: a creature cannot
hold more than `3 × (freezes + 1) − 1` stacks without freezing and spending them, so the reachable
bonus rises only as that creature is frozen more often. It also carries its own drawback — a frozen
creature has just spent every stack, so `perFrost` pays its minimum against exactly the targets a
`versus.frozen` ability pays its maximum against.

`exploitCold` is `frenzy`'s twin pointed at the victim rather than the attacker, and needed its own
kind because one percentage cannot describe two board states. It **sums across sources**, so an
upgrade tier granting a second one stacks with the innate one.

`freeCastOnFreeze` writes `Unit.freeCast`, a charge spent on use. It is stored on the unit and never
on the ability, because ability definitions are shared content — writing to one would make every
later copy free for everybody. **`paysAsWildcard(ability, freeCast)` in `dice.ts` is the only place
that knows what "costs one die" means**; every cost check, the planner and the UI call it, because
two implementations of that question would drift the first time the rule moved.

### 5.2e Taunt

Kael's, and the second of the three tanking shapes (README §10 lists the third, cover, as unbuilt).

- **Cast at an enemy**, not an ally. Everything that creature does comes to the taunter. Cover is
  the mirror — cast at an ally, taking what is aimed at *them* — and is the only one of the two that
  could catch a whole-side attack.
- **It rewrites the declared intent**, which is on screen before the player plans, so the redirect
  is visible before anything is committed. No roll.
- **It cannot move a whole-side attack**, a heal, or a self-buff. Each refusal is logged with a
  reason rather than silently doing nothing.
- **It overrides reach.** `range` is what a creature *chooses* to reach; a taunt is it being forced,
  and `Intent.forced` carries that past the depth check at execution. Without this a taunt only
  works on creatures that could already hit the taunter, which makes it little more than a way to
  pick which front-row body eats the attack — and it would force both tanks to queue for the same
  front-rank slot. It overrides depth, **not existence**: a taunt onto someone who has since died
  falls through to a fresh choice.
- **It is also a state** (`Unit.taunt`), so it can outlive the intent it rewrote. At the base one
  turn that record does nothing; Kael's `lastingTaunt` upgrade carries it into the next declaration,
  where `chooseIntents` picks the taunter instead of rolling.

### 5.2f Multi-hit — one ability, several blows

A damage effect may carry **`hits`**, a list of **ratios**: `[1, 1, 1]` is three equal thirds,
`[1, 1, 2]` is a quarter, a quarter and a half. `splitPower` normalises them against their own
total, so an author writes whichever form reads better for the ability and never has to make the
numbers add up to anything in particular. Benjamin's *Perfect Form* is six even hits; *Quick Cut* is
two.

**Each blow is a real strike** — mitigated on its own, rolled for critical on its own, logged on its
own with a `hit` index. That is the whole reason to have the mechanic rather than printing one
number in pieces: it interacts with per-hit effects the way a volley should, and the engine already
has several that count hits rather than damage. The cost is that rounding happens once per blow, so
six thirds out-damage one whole hit against something that mitigates down to fractions. That was
weighed and accepted: the `max(1, …)` floor only bites at the very bottom of the range, and §5.2's
stat-scale work moved the game out of it (floor-hits measure 0.0%).

**The split is authored in the animation lab, not in `content.ts`.** It lands in
`src/engine/hitSplits.ts` — machine-written, one flat object keyed `<character id>/<ability name>`,
regenerated whole so a bad write breaks the build loudly instead of half-applying. Two decisions
inside that are load-bearing:

- **It is under `src/engine/`, not `art/`.** Tuning a volley is balance, and balance the headless
  simulator cannot see is balance nobody checks — `npm run sim` has no art pipeline and no browser.
  A `hits` written on the effect in `content.ts` still wins; the file is folded into the roster at
  load, so authoring in source and authoring in the lab do not fight.
- **It is TypeScript, not JSON**, because a JSON import needs an import attribute Node and the
  bundler disagree about, and the file is machine-written either way.

The split says only *how much*. **When each blow lands is the animation's business** — `impacts` in
the clip tuning (§7), which is why the two are edited on the same screen and written by the same
Save.

`describe.ts` states an uneven split in the rules text (`over 3 hits of 25% / 25% / 50%`) and stays
quiet about an even one, since "six hits" already says thirds without arithmetic.

**The board shows the total once the action has landed.** Six numbers flying past in two seconds is
six numbers nobody adds up, so an action that dealt damage over **more than one blow or to more than
one target** puts its total in a box above the middle of the stage, with the shape of it underneath
(`6 hits`, `5 targets`, or both). A single strike on a single target gets nothing: its floater
already IS the total, and restating it larger a few inches away reads as two different numbers
before it reads as one.

It sums the **damage log events**, not the HP diff. The diff is the right source for the floaters --
it is what actually left the unit, so it catches overkill trimming and regen with no name matching
-- but the box is answering "what did the ability deal", and the events are exactly that, and are
the same events the per-blow floaters are built from, so what is on screen adds up to what is in the
box. **Thorns is excluded**: it is logged as damage like everything else but it is the target
hitting back, and counting it would put the attacker in the list of people the ability struck --
enough on its own to push a plain single strike over the two-target line.

It fires on the **last** blow. A running subtotal is a number that changes while you are reading it,
which is the problem rather than the fix.

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
- **Bosses escalate.** `CharacterDef.ramp` grows the creature's damage every turn past a grace
  period — **linear**, `1 + percent/100 × (turn − after)`. The False Lead runs 5% after turn 10:
  ×1.20 at turn 14, ×1.50 at 20, ×2.00 at 30.

  This is the structural answer to the turtle, and it is the inverse of the failure recorded in §8.
  Mitigation (`resilient`, defence buffs) is a **fraction** of incoming damage, so it scales with
  the ramp and can never cancel it; healing is a **flat** amount per cast, so a growing damage
  source beats it outright. Flat enemy damage is always healable — a ramping one is not.

  When it was built, simulation at stage 10 showed exactly what it was for: 7.3% of level-10 attempts
  ended in a **draw** at the 40-turn cap, and the ramp turned every one of those into a loss while
  leaving every level at or above the gate byte-identical.

  **That measurement no longer reproduces, and the reason is worth recording.** Those long fights
  were partly an AI bug: `scoreAction` read `Ability.power` as a flat stat buff for abilities whose
  real numbers live in `effects`, so the auto-battler valued Rally at twenty flat stat points and
  spent a quarter of every turn casting it. With `buffStatGain` reading the actual effect, Rally
  fell from 25.0% of all player actions to 2.7%, the AI attacks instead of buff-looping, and the
  stage-10 fight runs 13.2 turns rather than 19.5 — below the ramp's grace period, so it barely
  fires:

  | party | win, no ramp | win, ramp | draw, either | avg turns |
  | --- | --- | --- | --- | --- |
  | Lv 10 | 100% | 99.3% | 0.0% | 13.2 |
  | Lv 13 (the gate's level) | 100% | 100% | 0.0% | 10.0 |
  | Lv 16 | 100% | 100% | 0.0% | 8.5 |
  | Lv 20 | 100% | 100% | 0.0% | 6.6 |

  **The mechanic stays anyway**, because the thing it guards against is a *player* strategy the AI
  never played: a composition built on defence buffs and healing, which can extend a fight far past
  anything the auto-battler produces. `after: 10` now sits just past a cleanly-played fight, which
  is where the grace period belongs. Re-measure it against a deliberately defensive party rather
  than against the AI.

  Three decisions worth keeping. **Linear, not compounding**: 5% compounding is ×2.65 by turn 20 and
  ×7 by turn 40, which stops being an anti-stall and becomes a difficulty setting. **`after` is what
  keeps it honest** — starting at turn 1 makes the *normal* fight 65% harder, a tuning change
  dressed as a mechanic. **Bosses only**: a corridor fight ends in ~6 turns and would never reach it.

  It is written as an ordinary **stat modifier** on the creature's attack rather than a special case
  in `computeDamage`, which buys three things free: the forecast panel reports the ramped number
  because it reads the same stat, the roster row's attack chip shows it, and `computeDamage` stays
  pure. And it is **shown** — a `×1.15` badge above the intent die, plus a line on the sheet.
  BATTLE_DESIGN's rule that a fight must be plannable applies to a ramp as much as to a dice roll: a
  boss quietly doubling its damage is indistinguishable from the numbers being broken.
- **Telegraphed attacks**: an ability with `telegraph: 1` announces its target area this turn and
  lands at the start of its next phase. Distinct from an intent — a telegraph is a wind-up you have
  a whole turn to answer, an intent is what happens at the end of this one.
- Enemies resolve **sequentially inside one uninterruptible phase**, not strictly simultaneously.
  The player cannot act between them, which is the property that matters for burst, but a kill by
  the first does change what the third finds. Logged as open in `BATTLE_DESIGN.md`.

`Ability.priority` is the older selector and is now vestigial; the current kits still carry it and
are about to be rebuilt anyway.

Passives available: `regen`, `thorns`, `resilient`, `frenzy`, `lifesteal` — all percentages applied
to their owner — plus two that are not: `extraDie` (§5.1, *Contributed dice*) and `chill`, the first
that reads the **other side**. `chill` is an aura owned by a living defender and keyed off the
ATTACKER's frost stacks, which is why `computeDamage` takes the defending side as an argument.

### 5.4 In-battle upgrades

Three tiers per player character at **6 / 8 / 12 dice**. Each grants +10% cumulative stats and
unlocks a passive. Costs the character's action, same as casting. The max-HP gain is granted as
healing, so upgrading mid-fight does not leave you at a smaller fraction of a bigger bar.

**A tier grants any `Passive`, including `extraDie`** — `activePassives` folds bought tiers in
alongside innate ones and `poolFor` reads that list, so a tier can put another die in the shared
pool with no new machinery. Benjamin's third does.

**The stat half is not filler, and for one character it is the whole point.** Rally copies
Benjamin's *current* stats onto an ally — the whole team when it chains — so every tier he buys is
+10% on every Rally for the rest of the fight. Nobody else converts personal stats into team stats,
which is what makes "spend a turn investing in yourself" his enabling play rather than a selfish
one. Worth knowing before authoring anyone else's: for the other five, the stat bonus really is a
flat personal gain and the passive has to carry the tier.

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

#### Every revamped character's tree is being redone — DEFERRED

The trees predate the kit rewrites and none of them has been revisited since. Benjamin's, Rebar's
and Maxine's all offer rungs that duplicate an upgrade tier or reference a mechanic their kit no
longer has — Maxine's ★3 is `lifesteal 12` / `frenzy 28`, neither of which touches frost.

**They are being redone together, after the remaining kits**, not one at a time. A tree is the place
a character's identity is specialised, so it can only be authored once that identity is settled, and
doing them as a batch is also the moment to give rarity a say (below). Treat every existing
`starTree` as placeholder content and do not tune against it.

#### The rarity ceiling — DECIDED, NOT BUILT

The intended relationship between rarity and stars, which no kit has been authored against yet:

| | is worth about |
| --- | --- |
| a **maxed 3★** | a **rank-3 5★** |
| a **maxed 4★** | a **rank-4 5★** |
| a **rank-5 5★** | game-breaking — raw damage, or utility past what the rest of the cast can reach |

**This is not a statement about raw stats.** It is about what the character is worth in a fight, so
a 3★ may reach parity through utility, matchup or conditional spikes rather than through numbers.
The desired shape is that **a maxed 3★ elemental specialist out-damages a mismatched rank-1 5★** —
so that sometimes fielding a lower rarity is the correct answer to a specific fight, not a
concession. What must *not* happen is 3★ being sought in preference to 5★. 3★ damage dealers falling
short of 5★ damage dealers at equal investment is correct and intended.

**3★ should star up more slowly**, because the draw rates hand you far more of them. Two things this
needs are absent from the code today:

- `starCost(level) = level + 1` **has no rarity term** — every rarity costs the same 15 duplicates
  to max, so "3★ grow slower" is not expressible.
- **The tree shape is identical at every rarity**: the same choice / +12% HP / choice / +10% ATK /
  choice for everyone. A 5★'s rungs are not worth more per rung, and there is no capstone slot for
  the game-breaking fifth.

Neither blocks authoring a 3★, which is why they are recorded rather than built — but both have to
land before a 4★ or a second 5★ can be tuned against anything.

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
| Damage reactions diff HP rather than parse the log | Catches direct hits, AoE splash, thorns, lifesteal and regen in one place, with exact amounts, and needs no name matching. **Impact effects read a wider set** — the diff in both directions plus the action's own `modify`/`frost`/`freeze`/`sleep` events — because a buff changes no HP and left every effect with nobody to play on. |
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
 1: Aethis                    2: Rebar, Kael          3: Maxine (Blizzard)
 4: Benjamin, Kael            5: Aethis, Brax         6: Benjamin
 7: Kael, Maxine              8: Rebar, Aethis, Brax
10: Benjamin, Maxine, Brax   12: Rebar
```

**Among the four finished kits, only cost 2 collides** (Rebar's Hibernate, Kael's Disarm) — the rest
of the table is one claimant apiece. Placeholder kits still sit where an older system put them and
will move as they are authored.

> Superseded, kept for the shape of the argument: **costs 8 and 10 once had three claimants each**, which is the most crowded the roster has been.
That is a consequence of authoring two kits deliberately and leaving four placeholders in place:
Benjamin and Rebar took the seats their designs wanted (6 and 12 respectively are uncontested by
anyone authored), and the four disposable kits are still sitting where a different system put them.
**Re-check this table as each remaining kit is written** — it is the cheapest balance lever in the
game and it is currently drifting.

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

**Stills.** Style guide **v3.0 moved the standard canvas from 128 to 256**, so two spec revisions
are in the roster at once while that migration runs. The pipeline tells them apart by **measuring
the file**, not by a list of names — so migrating an actor is only ever a matter of dropping the new
art in, and 128 and 256 sprites stand correctly beside each other in the meantime.

| | v2 (Kael, Rebar, Maxine, Aethis) | v3 (Benjamin, Brax) |
| --- | --- | --- |
| Native grid | 128px | **256px** |
| Standard body band | 82–92 px | **164–184 px** |
| Ground line / margin | y=112, ≥8px | **y=224, ≥16px** |
| Exterior outline | 1px | **2px** |
| Detected by | canvas measures 128 | canvas measures 256 |

Every v3 threshold is exactly v2 doubled, so a character described by either revision stands the
**same height on stage** — the canvas is a detail budget, not a size multiplier, and stature stays
`body ÷ canvas`. An unrecognised canvas falls back to `CURRENT_SPEC` (v3), so a bad upload is told
to redraw at 256 rather than at the size the guide no longer asks for.

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
| `frames` | Per frame | `hold` weight, `dx`, `dy`, **`scale`, `skewX`, `skewY`** |
| `order` | Whole clip | Playback sequence; omit for natural order |
| `impacts` | Per step | Where and when a particle effect fires — see below |

Offsets are percentages, so corrections hold at any render size. `hold` is a **weight**, not a
duration, so `stepMs` still means "how long a plain frame lasts."

**Per-frame `scale`/`skewX`/`skewY` are squash and stretch**, the one thing a fixed sprite strip
cannot draw for itself. They exist because a four-frame sheet is expensive to redraw and cheap to
lean on: a wind-up frame squashed 6% and skewed two degrees reads as weight without another render.
They compose into the same generated keyframes as `dx`/`dy`, through the `.anim-pose` wrapper —
**not** onto the image itself, because the image already carries its own transform and a CSS
animation *replaces* an inline transform rather than composing with it (§11).

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

#### Impacts — when a particle effect fires

An `impacts` entry is what turns a sword swing into a hit: `{ frame, effect, at, to, scale, dx, dy,
delay, ms }`. `effect` names a particle set, `at` is `each` (once per target), `centre` (one burst
at the middle of them) or `caster` (one burst on the performer), `to` optionally narrows `each` and
`centre` to what the ability `struck` or `aided`, and the offsets and `scale` place it against
whichever body it lands on.

**Impacts land on whoever the action AFFECTED, not on whoever it hurt.** The list used to come from
an HP diff, which made every buff invisible: Rally touches allies and damages none of them, so the
list came back empty, `each` had nobody to burst on, and an ability set to show an effect on all its
targets showed nothing at all with no error to say why. It is now the HP diff in both directions
plus the action's own log events — `modify`, `frost`, `freeze`, `sleep` — resolved from name back to
id. Reading the log rather than the ability's declared targets keeps the guarantee that made this a
diff in the first place: an effect appears only where something actually happened, so a miss, an
immunity or a resisted debuff still produces nothing.

**A burst that lands on the performer walks out with them.** The step-to-the-mark animation is on
`.unit`, *inside* the slot, so a burst placed beside it stays on the mark the performer left — right
for a target, who does not move, and wrong for the caster, who is halfway downstage by the time the
flourish fires. Caster bursts render in a `.caster-fx` layer that runs the same generated
`stage-strike` keyframes off the same `--beat`/`--sx`/`--sy` the slot already carries; the rule is
declared on one line with `.unit.striking` so the two can never be retimed apart. Whether a burst
walks is decided when it **spawns**, from whether it landed on whoever is acting rather than from
its placement — a team-wide buff puts an `each` burst on the caster too, and deriving it from the
live beat instead would change the burst's container the instant the beat ended, tearing the element
down mid-animation.

**`caster` is what a buff needs.** The other two placements are defined in terms of who was hit, so
Rally — whose beneficiary is an ally — could only put its flourish on the ally and nothing on
Benjamin, and an ability affecting nobody could show nothing at all. `caster` names the one unit
that is never in question, the one whose clip is playing, so it needs no targets and picks no side.
It is a third value rather than a rule about `kind` because some abilities want both: two impacts on
one frame, `caster` and `each`, read as "he raises his sword and the light settles on her", and no
single placement says that. In the battle it costs nothing to draw — `on` is set to the acting unit
and the burst rides that unit's slot exactly as a target burst rides theirs.

> **`at: 'caster'` had never once been saved.** The lab has offered it since the placement existed,
> but `/__anim/save` validated `at` against `'each' | 'centre'` only, so every attempt came back 400
> and the impact stayed on `each`. A validator that does not know a value its own editor emits is not
> a guard, it is a silent veto — and the whole point of this paragraph was unreachable in practice.

**`Impact.to` narrows a burst to part of what the ability reached.** The rule above — that the side
is decided by who was affected and is never a choice — holds for an ability that does *one* thing.
Perfect Form damages an enemy and buffs Benjamin, so it affected two units for two different
reasons, and `each` cannot tell a sword landing from a blessing landing: it fanned both drawings
over both bodies and the hit spark went off on the Performer.

`to` is `struck` (what this ability damaged) or `aided` (what it reached without damaging), and
omitting it means everyone — which is what every impact authored before it means, and what a
single-purpose ability wants. **It filters by outcome, not by side**, deliberately: a side selector
would let a sheet declare a spark on the wrong team, which is the bug the original rule exists to
prevent, and the outcome split stays honest for an ability that damages an ally or heals an enemy.
Measured on the real case:

```
Perfect Form  log: modify:Benjamin ×3  damage:Red Understudy ×6
  all    [Red Understudy, Benjamin]     <- what `each` was fanning over
  struck [Red Understudy]
  aided  [Benjamin]
```

**Thorns damage does not make a unit struck.** It is the target hitting back, so counting it would
mark the attacker and put the hit spark on the Performer — the same bug in a different coat. The
`struck` set is read off the damage log with `matchup === 'thorns'` skipped, the same exclusion the
damage total uses. `caster` ignores `to` entirely: it names one unit and has no group to narrow.

The lab hides the control on a `caster` impact for that reason, and it is the one impact control
whose result the practice dummy cannot show — there is only one dummy and it is neither struck nor
aided, so this one is only visible in a battle.

The first effect authored for `caster` is `art/effects/buff_4x1.png`, a gold ring-and-swirl flourish, on
Benjamin's `rally` at step 2 — the long held pose — with `ms: 900` so it plays under the hold rather
than snapping out of it at the 380ms default.

The second is `defense_down` — a shield shattering over a red arrow — on **Sunder**, the ability that
actually shreds P.DEF, at step 2. One step *after* the blade lands on step 1: the shred is a
consequence of the hit rather than the hit itself, and firing both on one frame reads as a single
louder impact instead of two things happening. Note Kael's Disarm reduces **ATK**, not defence, so it
is not a user for this sheet.

> **`frame` is a STEP POSITION, not a source frame.** It indexes the *played* timeline. That
> distinction is the whole reason the field was re-specified: duplicating a frame in the lab gave
> two steps the same source index, so an impact keyed to the drawing fired on **both** copies and
> the two could never be tuned apart — which is the entire point of duplicating a frame in a combo.
> Indexing the played order also makes an impact on a step that `order` never plays simply not fire,
> which is the right answer: a blow edited out should not still land.

**Impact time is measured along the clip, and nothing else.** `impactTimes` walks the played steps
accumulating `hold × stepMs`. An earlier version added a fraction of the whole action beat to that,
which double-counted a walk the clip never waits for — measured, a frame-3 impact fired at 1571ms on
a 1343ms clip, i.e. after the animation had finished. The clip's own timeline is the only clock.

**The action beat is derived from the clip, not the other way round.** `beatOf` composes
`STEP_OUT_MS` (the walk to the acting mark) + `SETTLE_MS` (a full second of stillness) + the clip +
`STEP_BACK_MS`, and generates the `stage-strike` keyframes for that beat so the hold is exactly as
long as the clip needs. During the walk and the settle the Performer plays their **ready** clip, not
the first frame of the swing — holding frame 0 of an attack for 1.2s reads as a freeze, and it was
reported as one.

#### Per-ability clips

`abilityClipName` looks up `abilitySlug(ability.name)` among the actor's packed clips and falls back
to `attack`. **The lookup is by file name, so authoring a new animation is entirely a matter of what
the sheet is called** — drop `benjamin_quick_cut_4x1.png` into `animations/` and Quick Cut starts
using it, with no registry to update and no code to touch. The packer already derives clip names
from file names, so nothing in the pipeline had to learn what an ability is.

Falling back rather than requiring one per ability is what keeps it incremental: a character with
forty abilities and one `attack` sheet plays exactly as they did before, and every sheet added after
that upgrades one ability without disturbing the rest. Benjamin currently has `quick_cut`, `rally`,
`sunder` and `perfect_form` beside his `attack`, plus `ready` for the walk-out and `upgrade`.

**Both stills are editable in the lab.** `pain` and `death` are packed as *one-frame clips* and
added to `ANIMATION_CLIPS` alongside the real ones, purely so the lab lists them — and added at the
very end of `build_animations`, after normalisation and after the union box is computed, which is
the whole design. `normalise` scales each clip by the ratio of its figure *height* to the reference
clip's; a death pose is drawn lying down, so normalising it would blow the body up until it stood as
tall as the character does. Letting it into the union box would re-scale every other clip, which is
exactly what the glowing upgrade sheet did. Instead each is measured from its own published PNG,
which is already tightly cropped: `restFill: 1.0`, `footPad: 0.0`, `still: true` — "this image *is*
the figure", which is true of a still and never quite true of a strip.

The battle still draws both through their own paths, now reading `placementFor(who, 'pain' | 'death')`
so scale and offset tuned in the lab are what appears on stage. Without that half, the lab would
have listed two poses it could not actually change.

**There is no generic `attack` clip.** Every ability gets its own sheet; `abilityClipName` returns
`''` when there is no match rather than naming one. The fallback was not doing its job anyway —
Benjamin was the only actor who ever shipped an `attack` sheet, and once his four abilities each had
their own he stopped reaching it, while for the rest of the roster it named a clip that did not
exist. An ability with no sheet is still playable: the Performer walks out, holds their `ready`
stance for the beat and walks back, which is what everyone but Benjamin already did.

**One idle is the character; the others are things they occasionally do.**
`idle` is the base and holds the floor. Each alternate (`idle_2` and up) declares an `idleWeight` in
its `*.anim.json` entry — **loops per hundred** — and after every base loop one roll decides whether
any of them cuts in. An interlude plays once and hands straight back, so a Performer always returns
to themselves and can never string two together.

**Zero is off**, and that is the entire enable/disable control. A clip that never comes up never
plays, so there is no second switch that can disagree with the number — "enabled, weight 0" is a
state that means nothing and would sit in the data waiting to confuse somebody. The lab exposes it as
a *Cuts in* slider on alternate idles only, reading `off` at zero.

Weights are shares of the same hundred, so they read together: Benjamin's 10 / 8 / 7 means about one
idle in four is an interlude and the base holds the other three. Nothing needs to know the loop
durations to author that, which is what makes it tunable by eye. Unweighted alternates default to 10,
so a new one does something visible before it is tuned.

**Authoring an alternate is a question about two joins, not about the clip.** It is never seen on
its own: it cuts into the base and hands straight back. So the lab's *Seam* playback plays `idle`
once, the alternate once, and repeats — both joins going past on a loop, which is the only playback
that shows what a battle shows. Looping the alternate by itself shows a join it never actually
makes, itself to itself, and a pose that starts slightly higher than the base ends will read fine
that way and twitch on stage. The base leg runs at its own saved `stepMs` rather than at the speed
slider's value, or the seam on show would be one nothing ever plays. The mode is built on the
hand-off `once` mode already had — it swaps which clip is showing and lets frame count, timing,
placement, keyframes and impacts follow the name downstream, as they already do for a one-shot
settling into its ending.

This replaced an earlier scheme, and the reason is worth keeping. That one rotated through every
stance in order, one full loop each — so a Performer spent three quarters of a fight *not* in their
own resting pose, and since the variants differ from each other as much as they differ from the base,
the party read as restless rather than alive. Retiming it had not helped, because the timing was
never the problem: the shape was. Equal airtime is the wrong model for variation, whatever its clock.

The packer needed no changes for any of this: `LOOPING` matches by prefix, so every `idle_*` already
registered as a looping clip. `idleStances` lists whichever exist, base first.

Switches are scheduled against a running clock rather than by chaining delays, because `setTimeout`
fires late under load and a chain accumulates every late arrival — after enough of them a change
lands mid-loop, which is the one thing the scheduling exists to avoid. Held in state, not derived at
render: `Math.random()` in a render would re-roll on every unrelated state change and the board would
strobe. A character with one idle is skipped entirely.


**`thinking` is the stance of being decided about** — held while a Performer is selected and has not
committed yet, their menu up and the choice theirs. A **still**, joining `pain` and `death` in
`EXTRA_POSES`: one drawing held for a state, not a sequence. Packing it as a clip would put a single
frame through the strip machinery and, worse, through `normalise`, which scales every clip to a
common figure height and would resize a deliberately different pose to match the others.

All three stills are now drawn by one piece of code, since "replace the animated body with a held
drawing" is the same job each time — sized through `clipBox` against the pose's own metrics, and set
on the ground line. Which one wins is a priority rather than a choice: a character being struck is
not deliberating, and one mid-swing is doing neither. `thinking` also yields to a booked action,
which `ready` already covers, because the prop is false once a Performer is in the queue.

**`upgrade` is the one reserved clip name.** Buying an in-battle upgrade is a real action — it costs
the Performer's turn and their dice — but the engine records it as a planned action with a **null
ability**, so it had no name to look a clip up by and fell through to `attack`: the player watched
Benjamin swing his sword at nobody in order to learn Hold the Line. `lunge` takes a `prefer` clip
name for this, asked for at the one call site that can tell (`step.ability ? undefined : 'upgrade'`),
and ignored when the actor has no such clip — so it stays as incremental as the per-ability clips
are. Narration already handled it: "takes a bow — a new flourish!".

**The fallen stay on the boards.** A `death` pose — the second `EXTRA_POSES` still after `pain`,
packed as `<name>_death.png` — is held for the rest of the battle once a unit is at 0 HP. It changes
no rule: a dead Performer already could not act (`checkAction` refuses with "X is down"), could not
be found at their slot (`unitAt` filters `alive`), could not be aimed at (`canTarget` false) and was
not caught by a `scope: 'all'` area attack (`unitsHit` filters `alive`). All four were verified
against the engine rather than assumed. What changed is only that they stopped *vanishing*: every
stage pass filters on `alive`, so a party of five quietly became a party of three, which says the
fight is going badly by leaving an empty stage instead of saying whose body is on it.

Drawn in a pass of its own, not a branch inside the living one — the dead take no pointer events and
carry no marks, intent, hit reactions or walk, and a branch would have had to switch all of that off
one prop at a time. They sit in a depth band entirely below the living, since nobody standing should
be behind a body. **Sized by width**, uniquely: a death pose is wider than it is tall, and the
packer clamps a pose to the board height, so sizing it the usual way would draw a body at twice the
size of anyone standing over it. The figure height a standing Performer would have had is spent on
their length instead — lying down, you are about as long as you are tall. An actor with no `death`
pose still leaves the stage, exactly as the whole roster did before this existed.

**A clip can be a folder of frames, and that is the preferred input.**
`animations/idle_2/idle_2_01.png…` is a three-frame idle; the count is how many files are in it.
That retires two whole classes of bug — no grid to infer, so the `gcd` trap cannot fire, and no cut
to make, so a drawing that overruns a cell cannot bleed into its neighbour. It also makes a frame a
thing you can own: regenerate one bad drawing instead of a whole sheet, or lift a frame out of one
animation into another to build something the generator would not produce in one pass. A folder
beats a same-named sheet, so nothing has to migrate in a hurry.

**A clip that already has frames can be added to or started over.** `--append` continues the
numbering; `--replace` empties the folder first. The two ask for opposite things and are refused
together, and the `⤓ Drop art` screen puts them as a pair of radios with **neither** preselected,
because adding to the wrong clip buries good frames behind new ones and replacing the wrong one
deletes them. Benjamin's celebration is built by appending — a sword-raise and a back-flip generated
separately, cut, and joined.

**Replace clears rather than overwrites**, and that is not fussiness. A new sheet may hold *fewer*
frames than the old one, and leftovers keep their numbers and are read back as part of the clip — a
four-frame swing replaced by a two-frame one would play the two new drawings and then the back half
of the animation it was meant to retire. It also drops any loose sheet for the same clip sitting in
`animations/`, which a folder shadows: unread, and therefore harmless right up until somebody
deletes the folder and a sheet nobody remembers uploading comes back as the clip. Every file dropped
is named in the log.

For a **pose** (`pain`, `death`, `thinking`) there is nothing to append to — it is one drawing
installed as `<actor>_<pose>.png` — so the splitter refuses a second one unless `--replace` says to
overwrite it, and the drop page offers Replace alone.

New frames always land at the end, and the order is then set in the animation lab. That is not a
limitation: `order` in `<name>.anim.json` indexes **source** frames, so appending cannot disturb an
order already set, and the lab can move, duplicate and disable frames while the clip plays. Benjamin's
celebration carries `order: [4,5,6,7,0,1,2,3]` — the flip, then the raise. Frames from different
sheets are padded to the largest, bottom-centred, with the pack naming what it padded.

`python scripts/split_sheet.py <sheet> --write` (or `--all <actor>`) cuts a sheet into one. It
imports the packer's own `split_sheet` rather than reimplementing the cut, because the split is a
decision made once and kept forever — it has to be the decision the packer would have made.
**Verified lossless:** every frame's content box comes out pixel-identical, and 1.4% of pixels
differ at a maximum delta of 29/255, which is edge antialiasing from resampling a padded image.

**Some seams have no correct cut at all, and the tool says so.** Every split reports which seams cut
through ink. Benjamin's `idle_3` is the case that forced this: the first figure's sword tip crosses
the cut *and* the second figure's scarf reaches back past it, so the two silhouettes are one
continuous run of ink across the whole sheet — there is no x that keeps both figures whole, and no
cleverness finds one, because the information a clean cut would need is not in the image.

`--bleed [px|%]` (default 10% of a cell) cuts every window wide instead, so frame 1 keeps its entire
sword plus an unwanted slice of frame 2, and frame 2 keeps its entire scarf plus a slice of frame 1.
Redrawing a sword tip that was never captured is impossible; deleting an intruder is not — and it
usually needs no hand at all. After cutting wide, anything that is **its own connected drawing** and
sits centred outside the cell the frame owns is the neighbour's, and is erased automatically. On
`idle_3` the sword tip and the next figure's scarf overlap in x but never touch, so both frames came
out clean with no edit. Separateness is the safeguard: when two drawings genuinely touch, nothing is
guessed at and the tool reports that the frame needs hand work. The test is the fragment's **centre**,
not any overlap, because a figure's own reach routinely crosses its cell edge — that is why the frame
was cut wide in the first place.

Windows stay a uniform size and each cell's left edge sits a constant distance inside its window, so
every frame's content shifts by the same amount — which is not a change to the animation at all,
since the clip is cropped to the union of its content and a constant offset vanishes there.

Two bugs surfaced while proving that, both from `gutter_cuts` returning cells of *different* widths
once it started cutting on real gaps:

- **`normalise` resized every frame of a clip to `frames[0].size × k`.** Correct only while all
  cells are identical. Benjamin's `ability_1` cuts to 468, 548, 518 and 514 wide, so three frames in
  four were squeezed up to 15% horizontally with their height left alone — on every clip whose
  factor was not 1, which is most of them. It now scales each frame against its own size.
- **`gutter_cuts` demanded exactly `n − 1` gaps** and fell back to an even slice otherwise, so one
  touching pair anywhere threw away every correct boundary on the sheet — and an even slice bleeds
  *every* frame, not just the two that touched. It now uses each gutter it can find, matching them
  to seams by proximity, and fills only the unread seams by even spacing between known ones.

> **Iterating on a sheet is: overwrite the file in `art/actors/<name>/animations/`, keeping its
> name.** The dev server repacks that one actor and reloads the page. Two things used to make this
> confusing and no longer do. `art/samples/` is under `art/`, so dropping a new version *there*
> triggered a pack and a reload that changed nothing — it now says `art/samples/ is a drop box, not
> a source — nothing packed` and does not reload. And a pack that writes nothing no longer reloads
> at all, so "reloading" now means art really did change; the packer's last line (`N file(s)
> written` / `no files changed`) is what the plugin reads to decide.

> **The packer writes nothing it does not have to.** Every output — the metrics module and every
> PNG — goes through `write_if_changed` / `save_if_changed`, comparing the encoded bytes it is about
> to write against what is already there. This is not tidiness. `src/engine/sprites.generated.ts` is
> a *module*, imported by the battle screen, the animation lab and every hub screen, so rewriting it
> unconditionally fired an HMR wave across all of them; and `public/` is watched by the dev server,
> so rewriting a byte-identical sprite triggered a full reload. The animation lab re-packs on every
> save, which means "a pack that changed nothing" was the common case — and each one remounted the
> editor and lost whatever frame, clip and unsaved tuning was on screen. It also ends the re-encode
> churn in `git status` after a build. A pack with nothing to do now touches no file and prints
> `unchanged — no reload`.

> **The lab's stage must reserve room for the clip BOX, not the figure.** It bottom-aligns its
> figures and the clip window hangs from that baseline at `boxH` — the union of every clip the
> character owns — so the excess goes *upwards*, out of the stage and over the controls. Benjamin's
> box became 1.45× his figure the day the back-flip and upgrade clips joined it, and at a 260px
> preview his clips overflow 116–210px: `ability_3` reached far enough to cover the Save button.
> The stage now reserves `boxH − figureH` as top padding, computed in the component because only it
> knows the number, and `.lab-controls` carries `z-index: 2` as a backstop — art partly hidden behind
> an opaque panel is a much smaller failure than a panel you cannot click. Clipping the overflow
> instead would hide the very thing the box exists to show: the reach of a jump or a swing.

> **In a battle, a sprite is `position: static`.** `.battle .sprite-unit .sprite` sets it, and insets
> have no effect on a static element — so `bottom: 0` to drop a still onto the ground line silently
> does nothing and the image sits at the top of its box. Use a `translateY`, expressed as a
> percentage of the *image's* own height, which also composes with the mirror already on that
> element. This cost a round trip: fixing the size of the hit reaction without this left it correctly
> sized and floating in the air.

> **The stage has four z-bands, and the scrim is the one that catches people out.** Scenery 0, the
> focus scrim 60, standing Performers 100+, front layers 250+. Anything belonging to the *cast* must
> be above 60 or it is dimmed along with the set whenever somebody takes a turn. Fallen Performers
> were first put at 0–40 — on the set's side of it — and mostly vanished into the backdrop. They now
> sit at 65–95: above the scrim because a body is cast, below the living because it is on the floor.

> **A tight-cropped still is not the same height as the clip box.** The unit element is as tall as
> the clip box — the union of every clip a character owns, as tall as their highest jump — and the
> figure fills only `restFill` of it. The hit reaction was drawn at `height: 100%` of that, so it
> rendered at `1 / restFill` of its proper size: **1.45× for Benjamin**, which looks like a
> deliberate pop-on-hit rather than a bug, and is exactly what it was reported as. Both stills now
> size through `clipBox` against their own packed metrics, which is what listing `pain` and `death`
> in the clip catalogue bought: `restFill` is 1 for a tight crop, so the box is the figure height,
> and each pose uses its own `anchorX` rather than the board sprite's. `bottom: 0`, because the unit
> element's bottom edge *is* the ground line — the animated path lands its feet there by pushing the
> clip down by `footPad`, so a still whose feet are its own bottom edge simply sits on it.

> **Packed strips carry a 2px transparent gutter between frames**, and the reason is worth knowing
> because the symptom points at the wrong thing. Frames were butted together, and a frame that
> reaches its own cell edge is normal — the shared crop box is exactly as wide as the widest frame's
> content, so whichever frame set that width touches both sides of it. With no gap, the neighbour's
> ink is the very next pixel. The renderer shows one frame by making the strip N times the box width
> and sliding it, and the box is whatever fraction of the stage the character works out to — almost
> never a whole number of pixels. Sampling at a fractional boundary reaches across it, and a sliver
> of the next drawing appears at the edge of this one. **Every "the frames are clean but I can still
> see the next one" report is this, not the cut** — the source PNGs are innocent. `anchorX` and
> `aspect` are restated against the padded cell, so the gutter buys clearance without moving anybody:
> the foot sits 2px further into a box that is 4px wider, and the renderer's anchor transform cancels
> it exactly.

> **Adding a clip re-normalises every other clip that character owns.** The packed box is the union
> of all of them, so Benjamin's `upgrade` — a raised sword and a starburst above his head — made the
> box taller and re-emitted all seven of his sheets at a new scale (`restFill` 0.810 → 0.743,
> `anchorX` 0.573 → 0.536). That is the system working: the renderer divides the intended figure
> height by `restFill`, so his size on stage is unchanged. But the per-clip `placement` nudges in
> `*.anim.json` were authored against the old anchor, so they are worth a glance in the lab after a
> clip with a big reach joins a set. The changed `public/sprites/<name>/*.png` are genuine output
> here, not the 1-byte re-encode churn §11 warns about — check the dimensions to tell them apart.

**The animation lab** (`?dev=1#anim`, or the dev badge's **▶ Anim lab** button) is where all of this is judged and
edited: swap character and clip, scrub frames by hand, play a one-shot into whatever it settles
into, play an alternate idle in **seam** with the main one, ghost the still behind the clip — or the
**incoming frame**, the last frame of whatever clip settles into this one, which is the pose an
ending actually has to continue from, or **frame 1 of the main idle** behind an alternate — reorder,
duplicate (`⧉`) and disable frames, tune placement, pose and timing live, download a single frame as
PNG — and **Save**, which writes the JSON
through a dev-only endpoint (`vite.config.ts`).

It also carries the two tools this session's work needed:

- **A practice dummy.** Particle effects had no home to be judged in — the only way to see one was
  to start a battle, pick the ability and watch it go past once. The dummy stands in as a target so
  impacts fire, at the offsets and scale being edited, on every replay. A `caster` impact plays on
  the performer instead, in a box the dummy's size laid over the figure — the dummy's size and not
  the clip's box, because `scale` is a fraction of the body a burst plays on, and the clip box is as
  tall as the highest jump and as wide as the widest swing. Those previews are not gated on the
  dummy being switched on, since an animator turning it off to see the figure clearly is the most
  likely person to be tuning one.
- **The damage-split editor**, writing `src/engine/hitSplits.ts` (§5.2f). It sits beside the impacts
  because the two halves of a multi-hit are the same decision seen twice — how the damage divides
  and when each piece lands — and splitting them across two screens means authoring a six-hit combo
  by memory.

> **One Save, not two.** There were briefly two buttons, and the obvious one did not write the
> split — so adding a hit and pressing Save appeared to reload the page and discard the work. Any
> screen that authors two files writes both from one control, or it is a trap. A browser cannot write to the repo and the
alternatives are both bad: downloading leaves you to move the file by hand, and copy-paste makes
every small nudge a chore. The endpoint is `apply: 'serve'` so it never exists in a build, and it
still validates its inputs — a dev server is reachable from the network if anyone runs `--host`.

### Scenery

Anything in `art/background/` is mirrored verbatim into `public/background/` — backdrops are painted
at final size and the stage scales them with CSS, so there is nothing to pack.

**A scene is a stack of cutouts, authored in the stage lab** (`?dev=1#stage`) and stored as
`art/scenes/<id>.json`. Same reasoning as `<name>.anim.json`: it is a judgement call about how
something should look, so it is hand-authored rather than generated, and a re-pack can never
overwrite it. One file per scene — a shared file would couple scenes that have nothing to do with
each other, and laying out a forest should not rewrite the file describing a throne room.

| Field | |
| --- | --- |
| `layers` | The pieces: `src`, `depth`, `x`/`y`/`right`/`bottom`, `w`/`h`, `flip`, `front`, `shadow`, `motion` |
| `board` / `enemy` | Where the cast stands, overriding `formation.ts` |
| `acts` | Where a Performer stands while their ability plays, per side — overrides `DOWNSTAGE` |
| `stages` | Which battle stages this scene dresses, inclusive: `[1, 10]` |

**`front: true` draws a piece in front of the Performers.** The actors are not the top of the stack
— a curtain leg hangs between the audience and the boards, and anyone who walks behind it is hidden.
Without it every piece would be scenery, which is the same as saying the stage has no front.

**Marks belong to the scene, not the rules.** A set with a raised platform stage right wants its
front rank standing *on* the platform, and that is a property of the set. `board` lists all five
party slots — any of them is reachable by repositioning — and `acts` moves the spot a Performer
crosses to when they act, which is the same kind of decision: a prop across the middle wants the
acting mark somewhere else.

**A scene declares which stages it dresses**, rather than a central table mapping stages to scenes.
One file per scene is already the rule, and a registry would be a second place to edit and a second
place to forget — rename a scene and the table points at nothing, with no error until somebody plays
that stage and gets a black backdrop. Overlaps resolve to the **narrowest** match, which is what
makes the common shape work: a broad `[1, 10]` meadow for the early ladder with a `[10, 10]` boss
set laid over the top of it. Omitting `stages` means the scene is not on the ladder at all — the
right default, because a set being *worked on* should not become what players see the moment it is
saved.

`encounter.scene` names a scene by id and takes precedence over an in-source `layers` array, which
stays as the fallback: a scene the lab has never touched still renders, and one it has is not stuck
behind a code edit.

#### The lab has to be the game, not a picture of it

`stageLayer.tsx` renders one layer, and **the battle and the lab both call it** — a lab that draws a
layer even slightly differently is a lab that lies, and every number authored in it would need
checking against a screenshot anyway, which is the loop the lab exists to remove. Parity took three
separate fixes, and only the third was visible:

1. Front layers were laid out against the **3.1:1 proscenium** in one screen and the 16:9 frame in
   the other.
2. A **1/1.44 scale mismatch** between the two stages.
3. `object-fit: cover` in the battle stylesheet against nothing in the lab, so a layer whose box
   aspect differed from its art's was **cropped** in the game and **stretched** in the lab. Both
   drew the same rectangle in the same place — which is why comparing element boxes found nothing
   wrong, and why a box-only comparison was structurally incapable of catching it. It is `fill` now,
   stated in the shared module, because stretching is the authored intent: `w` and `h` exist so a
   piece can be pulled out of proportion, and a fit mode that quietly restores it throws the
   author's numbers away.

The lab carries the editing affordances that cost real time without: **Ctrl+Z / Ctrl+Y** (JSON
snapshots, 350ms debounce), **alpha hit-testing** so a click passes through a cutout's transparent
pixels to the piece behind it, **arrow-key nudging**, a **centre crosshair** and safe-area overlay,
**draggable acting marks** and slot markers, and a **preview** button that hides the chrome.

#### The battle camera

`camera.ts` holds the framing, and the model is **centre-on**, not origin-based: a shot names a
subject point and a zoom, and the stage is translated so that point lands in the middle of the
frame. The rewrite was forced by back-row Performers, which the origin form could not centre —
`transform-origin` does not centre a subject, it names the one point a scale does *not* move.
Centring needs a translate (§11).

| | |
| --- | --- |
| `REST_ZOOM` | The default battle framing. Adjustable from the dev bar, persisted to `localStorage` |
| `focusZoomFor(height)` | Fills `FOCUS_FILL` of the frame with the subject, clamped to `FOCUS_MIN`/`MAX` |
| `PUSH_ZOOM` | The punch-in on an action |
| `clampCentre` | Keeps the visible band inside the backdrop, so a shot never reveals the edge |

**There is no mouse-follow camera.** There was, and it went: it moved the whole stage under a cursor
the player was using to *aim*, and every hover over the command area snapped the framing. Focus is
hover-on-the-roster only, and it is released the moment `sel.ability` is set — measured, a focus
zoom held while aiming put all five enemies off-screen, which makes targeting impossible.

**The proscenium is not architecture, it is part of the backdrop.** It used to be a fixed frame that
stayed put while the stage zoomed, which reads as a window rather than a theatre; then it was a
parallax layer, which drifted against the stage. Both were wrong for the same reason — it is painted
scenery, so it is anchored to the stage and moves with it. The drift, while it lasted, was a
percentage translate resolving against a 2701px element and a 1550px one (§11).

---

## 8. Current state

### Art, as of this session

**Benjamin is the first complete Performer: 15/15 clips.** Run `npm run art` for the live picture —
it reads the roster and the pack manifest, so it cannot go stale. Everyone else is at 0–1.

His clips are the reference for what "finished" means: four abilities (filed **by slot**, so the
kit can be renamed without touching art), four idle stances the game rotates between, `ready`,
`upgrade`, `move`, `pain`, `death`, `celebration` and `celebration_ending`. Every one of them is a
**folder of frames** rather than a sheet, which is the format the pipeline now prefers.

Two of his clips are worth looking at as worked examples:

- **`celebration` is two sheets joined** — a sword-raise and a back-flip, generated separately, cut
  and appended, with `order: [4,5,6,7,0,1,2,3]` putting the flip first.
- **`idle_2` and `idle_3` were cut with `--bleed`**, because their figures overlap their seams. The
  neighbour fragments were erased automatically.

- **`move` plays in place.** The stage was already walking a repositioning character across the
  boards — `.stage-slot` transitions `left` and `top`, which is what makes two units in a swap cross
  each other — but nothing changed the DRAWING, so they glided to their new rank in whatever idle
  they were holding, feet still. The clip now plays with no lead-in, no impacts and **no walk
  downstage**: `pulse.inPlace` adds an `in-place` class and the `stage-strike` selectors became
  `.striking:not(.in-place)`. The flag is on the WALK rather than on the performing, because a
  reposition wants everything else `striking` carries — the `ready` stance, the clip, the exemption
  from the spent-unit dim — and only not the journey to the mark, which would be a second journey
  for one decision with the one the player asked for buried underneath.

  It runs once and holds its last frame, so author it to about `MOVE_MS` (520ms); Benjamin's single
  frame is a walking pose held through the glide. Repositioning does **not** scale with the playback
  speed, under the same rule as the step out and the step home: a walk is transit.

**`SPRITE_STYLE_GUIDE.md` describes the pixel-art era and is superseded** by the paper/sticker art.
Its banner lists what the pipeline still enforces; the rest is history awaiting an art-direction
rewrite.

### Balance

**Battle balance is still not tracked, and deliberately so.** The corridor fight reads a 100% win
rate at 2.9 turns; it is an AI playing a game no human plays, against enemies that have one ability
each and kits that are all disposable but Benjamin's. **Do not tune against it.** What the simulator
*is* good for, and the line between the two, is in §2.

One diagnosis from the old system is still worth keeping as a warning, because the trap is easy to
re-create: enemy damage was **flat** (312 per turn, every turn), and flat damage is always healable
— one Sanctuary healed 315 for two dice, so a single Performer spending two of five dice cancelled
five enemies. Two things now answer it structurally rather than by raising enemy numbers into a
sustain cliff: simultaneous enemy phases that cannot be healed through mid-burst, and the boss
damage **ramp** (§5.3), which is the same lesson inverted — a *growing* damage source cannot be
healed through at all.

**Cast — seven.** Five 3★ as tutorial unlocks: Benjamin (elementless blade, **fully rebuilt**,
utility / debuff / damage), Rebar (ice tank, **fully rebuilt**, frost application), Maxine (water
staff, **fully rebuilt**, frost damage — see below), Kael (elementless bruiser, **fully rebuilt**, taunt
tank), Aethis (earth staff, healer). Two 5★:
**Brax**, an earth/fire tank, and **Veyra**, a magic dealer — both with **placeholder kits**,
fieldable so compositions can be tested rather than balanced.

**Maxine is fully built** — the 3★ magical frost damage dealer, and the second reader of frost that
`Statuses.frost` always described itself as waiting for. Everything but her star tree is done.

```
passive  Killing Frost   +10% vs frosted, +20% vs frozen
 0  Frostbolt      100% ATK, any target, +1 frost          [crescent]
 3  Blizzard        60% ATK, whole line, +1 frost to all   [crescent] chained: a second frost to every enemy
 7  Glacial Lance  150% ATK, 200% vs frozen                [tide]     chained: strikes 30% harder
10  Deep Cold      100% ATK, whole line, +25% per stack    [tide]     chained: 35% per stack instead of 25%
 6  Deepening Chill   exploitCold {10,10} — stacks with the passive to +20/+30
 8  Frostfever        +5% ATK per frost stack landed, this turn only
12  Glacier Sight     on any freeze, the next Glacial Lance costs one die
```

**The frost counter tells the player which half of the kit to reach for.** Freezing spends the
stacks, so Deep Cold pays its minimum against exactly the targets Glacial Lance pays its maximum
against — at level 20 a frozen target takes 22 from Deep Cold and 45 from the Lance; one holding
three stacks takes 39 and 34. No rules text explains that; the number above the creature's head
does. **Stacks are read, never spent**, so she never competes with Rebar for the same resource.

**She is deliberately not self-sufficient.** Her two appliers resolve `[damage, then frost]` and
decay clears the stack before her next turn, so nothing she does sets up her own bonuses — Killing
Frost and Glacial Lance's 200% both pay out only on a *teammate's* frost. **Do not "fix" this by
reordering her effects**; it would turn a board-state reward into a permanent flat buff and quietly
make owning Rebar matter less. The comment on Frostbolt says so at the site.

**Her ceiling rises with the fight, not the level**, because the freeze bar escalates (`3 × (freezes
+ 1)`). One consequence is worth knowing: **Rebar's first Avalanche cannot set Deep Cold up**,
because its 3 stacks *are* the first threshold — it freezes and spends them. The second banks, the
bar now being 6. So his ultimate alternates between freezing (the turn for the Lance) and loading
(the turn for Deep Cold).

**The upgrade tiers ramp on purpose** — cheap and unremarkable, then nice to have, then the one
worth saving for, because upgrades cost dice *and* a turn and the question should be which Performer
deserves the investment. Measured payoff turn with all three bought and Rebar opening on Avalanche:
Glacial Lance goes from 46 to **150** (3.3×) and costs one die instead of seven; Frostfever pays
+75% ATK (3 stacks × 5 enemies × 5%) and expires at End Turn.

**Chains need a partner who is not Rebar.** He carries `lantern` and `thorn`, neither of hers, so
crescent comes from Kael or Veyra and tide from Aethis. Fully powered she wants Rebar *plus* one of
those three — a three-character core. That is deliberate: sharing one symbol across every ice
character would make the composition puzzle trivial.

**Still open on her:** only the **star tree**, which is being redone for every revamped character
together (§5.5) — it still holds `lifesteal 12` / `frenzy 28` on ★3, neither of which does anything
with frost. Her sheet comment also still claims *"the lowest HP and defence on the roster paired
with the highest attack"*, which Veyra now owns at ATK 124 to Maxine's 108.

**Veyra is the roster's glass cannon, and her identity is not built yet.** HP 40 on P.DEF 20 with
the highest ATK in the game (124): she answers a fight by ending it a turn sooner, and anything that
reaches her wins. She is *meant* to be the Performer with a **rotating elemental affinity** — her
element changing each round, revealed before the player plans, making her the coverage answer to a
boss that locks an element out. Nothing in the engine can express that today, so her four abilities
carry **fixed** elements spread across the cycle as scaffolding. Treat those elements as a
placeholder, not a design.

> Her empty `resistances` *are* deliberate, though. She channels elements rather than being one —
> the same reasoning that keeps Benjamin elementless and the False Lead's own attacks colourless.
> Giving a rotating caster a fixed weakness would answer the question her kit exists to ask.

> **She has no sprite.** `art/actors/veyra/veyra.png` is a **1254×1254 HQ render** carrying 624k
> semi-transparent pixels, not a packed 64/128/256 canvas with binary alpha — so the pipeline reads
> it as a 128 canvas with a 1168px body and derives a stature **9× everyone else's**. She renders as
> her role badge until the art is re-exported at 256 (the spec Brax uses). `caspian` has sat in
> `sprites.generated.ts` in exactly this state for a while: packed metrics for unusable art are
> harmless **as long as nothing references them**, which is why `CharacterDef.sprite` is omitted
> rather than pointed at a broken entry.

**Four kits are authored against `BATTLE_DESIGN.md`; three are not.**

| | drove into the engine |
| --- | --- |
| **Benjamin** — Utility Vanguard (§8) | turn phases, timed modifiers, ordered effect lists, player cooldowns, elementless attacks, the mutable dice pool |
| **Rebar** — Ice Wall (§8) | statuses (frost, freeze, sleep), three-rank positioning, timed elemental resistance, reactive `riposte`, the `move` effect |
| **Kael** — Provoker (§8) | **taunt** — redirecting a declared intent, and holding it for a second round; `Unit.grudge`, a hits-taken counter any passive can read |

That pattern is worth continuing deliberately: each authored kit has paid for a mechanic, and
authoring the next one is how the next mechanic gets specified by something that needs it rather
than invented in the abstract.

**Every Performer has a named innate passive**, shown on the sheet with its rules text on hover.
Five are numbers applied to their owner; Benjamin's is not (see below).

| | passive | |
| --- | --- | --- |
| Benjamin | **Drillmaster** | the party rolls an extra die while he stands |
| Kael | **Grudge** | +5% ATK next turn per hit taken — counts hits, not damage |
| Rebar | **Winterhide** | frosted enemies hit 4% softer per stack, cap 5 |
| Maxine | **Killing Frost** | `exploitCold` +10% frosted / +20% frozen |
| Aethis | Quiet Bloom | `regen 4` |
| Brax | Slagskin | `resilient 10` |

**The stat scale is HP 36–88 at level 1**, the five 3★ starters averaging **51**, with ATK 60–108
and DEF 20–100 in **tenths of a damage point**. The mechanics are in §5.2. The level-1 roster,
against a Red Understudy (28 HP, P.DEF 40, M.DEF 20):

| | HP | ATK | P.DEF | M.DEF | basic | signature | ultimate |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Benjamin | 44 | 104 | 50 | 30 | −6 | −8 | −15 |
| Kael | 52 | 96 | 68 | 44 | −3 | −5 | −14 |
| Rebar | 88 | 60 | 95 | 35 | −5 | +2 hp | −4 |
| Maxine | 36 | 108 | 20 | 40 | −14 | −21 | −14 |
| Aethis | 36 | 72 | 30 | 40 | −4 | +5 hp | +7 hp |
| Brax | 80 | 84 | 100 | 70 | −4 | −8 | −9 |

**Chains are live.** Every ability may carry a symbol; playing one arms it for the rest of the
round, and a later ability sharing it fires that ability's own trigger. Benjamin carries `anvil`
(Quick Cut, Sunder) and `lantern` (Rally, Perfect Form), with triggers on Sunder and Rally per
`BATTLE_DESIGN.md` §8. **Rebar and Maxine now carry triggers too** — Rebar on Hibernate, Frost Armor and
Avalanche; Maxine on Blizzard, Glacial Lance and Deep Cold. For the three kits still unbuilt the
absence is deliberate: inventing trigger effects for abilities about to be rewritten is work thrown
away, but without a second carrier nothing could arm Benjamin's and the mechanic would be
unreachable in play.
They enable chains without benefiting from them, which is the "completes other people's chains" role
a symbol-heavy Performer is for. Give them triggers when their kits are authored.

**A symbol is drawn, not spelled.** `SymbolIcon` carries all ten marks, and the rules line is the
mark plus — only if the ability has a trigger — **`Chained: shreds 15% deeper.`** It used to read
*"Anvil. If Anvil was already played this turn, shreds 15% deeper."*, and a carrier with no trigger
read *"Thorn. Plays Thorn for whoever acts after."* Both spent three lines restating a rule the
shape states by existing, once per ability, on every kit, forever.

What survives as text is only what the mark cannot say: **what this ability does differently when it
chains**. The carrier/trigger distinction — the one real thing the prose was carrying — is now the
chip's fill: an ability with a trigger gets a gold filled chip, a pure carrier an outlined one, so
"which two of these four chain, and which of them benefits" is answerable from the kit list without
hovering anything.

**Every chain clause says what it does, with the figure in it.** They were written as flavour —
*"the guard answers magic as well as steel"*, *"the wind is answered as well as the stone"*, *"the
shred bites deeper"* — and flavour is the one thing this line cannot afford. It is the **only** place
a chain's payoff is stated, it is read while deciding whether to spend a whole separate action arming
the mark, and nobody can weigh "bites deeper" against anything. All sixteen were rewritten in the
vocabulary `describeAbility` already uses for the base ability sitting directly above them, so the
two read as the same sentence twice and the delta is the thing that stands out:

```
Sunder        base     … then reduces its P.DEF by 25% of its own base stats for 3 turns.
              chained  Reduces its P.DEF by 40% instead of 25%.

Frost Armor   base     … while it lasts anyone hitting them with a physical attack takes 1 frost …
              chained  Anyone hitting them with a magical attack takes 1 frost as well.

Bedrock       base     Raises the whole party's Earth resistance by 50% for 2 turns.
              chained  Raises the whole party's Wind resistance by 50% for 2 turns as well.
```

`describeElement`'s resist line gained its missing `%` in the same pass — it read *"by 50 for 2
turns"*, and a chained clause beside it saying `50%` would have looked like two different numbers.

**Perfect Form now chains**, which reverses an earlier call. It carried `lantern` with no trigger on
the argument that a chained ultimate collapses the decision into "save the ult for a chain" — but
that assumed the chain was a free rider, and at cost 10 on a 3-turn cooldown it is not. Arming it
means spending a whole other action on a lantern first, in the same round, before an ability that
comes up roughly twice a fight. `empower: 0.5` and `amplify: 5` take it to **250% of ATK instead of
200% and a 25% self-buff instead of 20%** — written as deltas so retuning the base carries the chain
with it.

> It makes Benjamin the only Performer whose symbol pair reads in **both directions**. Both his
> lantern abilities now carry triggers, so neither arms the other from a cold start — but arming is
> unconditional, so Rally into Perfect Form and Perfect Form into Rally both pay off. Every other
> Performer is one carrier and one trigger per symbol.

**Brax fills the 5★ summon tier**, which was previously empty — and his canvas is the interesting
part. **Stature is `body / canvas`, so a bigger canvas is a detail
budget and not a size multiplier** — at 211/256 he stands 0.82 of a canvas and renders 1.24×
Benjamin, exactly as a 128px actor with a 105px body would. The pipeline now reads canvas size off
the file (`BY_CANVAS`) rather than assuming 128; measured against the old fixed divisor he came out
at 1.63 of canvas and would have been drawn two and a half times everyone's height.

**Benjamin's passive is Drillmaster: the troupe rolls a sixth die while he is standing.** It
replaced a placeholder `resilient 8`, which said the opposite of everything else his kit does —
Rally reads *his* stats and hands them to somebody else, Sunder's shred is for whoever acts after
him, Quick Cut arms a chain he may not be the one to cash. The die is a d6 with **three blank
faces** and the rest 1–3 (+0.50 dice a turn against a true die's +1.00), and it improves with his
**star level** rather than with a node — a tree that offers three real choices should not spend one
of them on something the character already does, and a level applies to everyone who gets there
whatever they picked on the way:

| stars | faces | +dice/turn |
| --- | --- | --- |
| 0–1 | three blanks, 1–3 | +0.50 |
| 2–3 | two blanks, 1–4 | +0.67 |
| 4 | one blank, 1–5 | +0.83 |
| 5 | a true d6 | +1.00 |

Measured effect in the corridor sim: actions per phase 3.34 → 3.51.

**His in-battle upgrade line is built too — survive, sustain, multiply** (`BATTLE_DESIGN.md` §8):
*Hold the Line* (6, `resilient 25`), *Trouper* (8, `regen 9`), *Full Company* (12, **a second die in
the pool**). They replaced lifesteal / frenzy / resilient, three more ways of saying "Benjamin
personally fights better" on a Performer whose kit is about somebody else fighting better.

The thing that makes them his was a synergy that already existed and was never written down: **the
+10% stat bonus every tier grants is already team-scaled for him alone**, because Rally copies his
*current* stats. Three tiers is +30% on every Rally for the rest of the fight, and it takes him from
`ATK 26 · P.DEF 50` to `ATK 34 · P.DEF 65`. That is what frees the passive slot to answer a
different question — what keeps him able to keep doing it — and both answers point the same way,
because Rally's worth and Drillmaster's die both end the turn he does.

**The three unbuilt kits are still disposable** — Aethis, Brax and Veyra. Treat their abilities as
placeholders authored against a system that is going away, and do not read balance into them.
Benjamin's, Rebar's, Maxine's and Kael's kits are in `BATTLE_DESIGN.md` §8; **every star tree** is
placeholder content regardless of whose it is (§5.5).

**Kael is fully built** — the 3★ damage-dealing tank, and the roster's second tanking shape.
Everything but his star tree is done.

```
passive  Grudge   +5% attack for his next turn, per hit taken (counts hits, not damage)
 0  Cleave      50% ATK to the whole enemy line             [anvil]
 2  Disarm      70% ATK, then -25% of the target's ATK, 3t  [anvil]    chained: -40% instead
 5  Challenge   taunt one enemy. no damage, no self-buff    [crescent] chained: +30% to both defences
 9  Reckoning   200% ATK, single target                     [crescent] chained: +30% of ATK on top
 6  Ironhide           resilient 20, flat and unconditional
 8  Dig In             10% less damage per hit already taken this turn, cap 5
12  Standing Challenge his taunts hold for a second round
```

**He tanks by choosing to be the target**, where Rebar tanks by standing in the front rank. They
answer different threats: Rebar answers "they attack the front row", Kael answers "they are going
for the healer", which positioning cannot solve. **Taunt overrides reach**, so he does not compete
with Rebar for a front-rank slot.

**No lifesteal or self-heal anywhere on him, deliberately** — a tank who tops himself up does not
need anybody, and the reason to field Kael is that he turns an unanswerable threat into one a healer
can answer.

**Dig In is the only defensive number in the game that currently moves.** Across a five-hit volley
the same attack lands for 4, 3, 3, 2, 2. Challenge's brace at +30% saves the same 5 damage it would
at +60% — a 5-damage hit rounds to 4 either way. **Roughly 50% is the size a defensive effect has to
reach to be felt at all right now.** Worth knowing before the last three kits are authored, and it
moves when enemy kits do.

**Art migration to style guide v3 (256px) is in progress.** Body heights below are the figure, not
the bounding box — see `PROP_HEADROOM` in §9 for why those differ on the hat-wearers.

| | spec | canvas | body | band | idle |
| --- | --- | --- | --- | --- | --- |
| Benjamin | **v3** | 256 | 184 | 164–184 | 13 frames |
| Brax | **v3** | 256 | 207 | 164–184 | 8 frames |
| Kael | v2 | 128 | 90 | 82–92 | 8 frames |
| Aethis | v2 | 128 | 86 | 82–92 | 8 frames |
| Maxine | v2 | 128 | 85 | 82–92 | 8 frames |
| Rebar | v2 | 128 | 80 | 82–92 | 5 frames |

**Benjamin is the reference sprite, and he landed at the top of his band.** 184 of 164–184 puts his
figure at `184/256 = 0.719` of canvas against the old art's `83/128 = 0.648` — 11% taller, and
taller than Kael, who is meant to be the larger man. Since the guide makes the sword character the
visual source of truth that every later sprite is matched to, the rest of the roster either scales
up with him (pushing Kael to ~200 and Maxine to ~189, both above the Standard ceiling) or he is
regenerated nearer the middle of the band. Today's statures restated on 256, which is the height
spec for the rebuild if the current proportions are to be kept: **Benjamin 166, Kael 180, Aethis
172, Maxine 170, Rebar 160, Brax 207** — Brax already correct.

Two audit notes are open and both are declarations rather than defects: **Brax** at 207 fits the
`large` band (184–208) but declares no class, and **Rebar** reports 80 against 82–92 although the
guide measures quadrupeds by length, not height, so the humanoid band should not apply — there is no
`quadruped` class in the packer yet.

The pipeline detects which spec an actor is on by measuring their file, so migrating one is just
dropping the new art in — see [`art/` in, `public/` out](#art-in-public-out) for the full contract
and the pre-flight list. Note that replacing an actor's whole folder also replaces
`<name>.pack.json`, which wipes the fingerprint proving the pipeline owns their output; the next run
then refuses with *"not written by this script"*. Clearing `public/sprites/<name>/` and re-running is
the documented recovery.

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
one enemy's abilities. Numbers are placeholders, not a balance pass.

**Presentation is now a system rather than a set of one-offs**, and most of this session went into
it:

- **The stage is a scene**, not a backdrop image (§7 Scenery). Layered cutouts with depth, shadows
  and motion, authored in the stage lab, and a scene claims a range of battle stages — the first ten
  are the meadow set.
- **The camera is centre-on** (`camera.ts`): a rest framing you can tune from the dev bar, a focus
  zoom on roster hover, a punch-in on an action, all clamped so a shot never reveals the edge of the
  backdrop. The mouse-follow camera is gone.
- **Hovering a roster row previews that Performer's whole sheet** — stats, passives, abilities *and*
  the upgrade track. Everything derived from the SELECTED unit is suppressed rather than hidden: no
  ability reads as castable and no tier as purchasable, because the dice belong to whoever is
  actually selected. The upgrade track used to be hidden outright for that reason, which answered a
  correctness problem by deleting information — hovering a Performer is how you read them, and how
  far along their track is, is half of what there is to read.
- **Actions have a beat.** A Performer walks to their acting mark in their **ready** clip, holds
  still for a second, then plays the ability's own clip and walks back. The beat is derived from the
  clip rather than the other way round.
- **Per-ability animation** (§7). Benjamin plays a different sheet for Quick Cut, Rally, Sunder and
  Perfect Form; everything without its own sheet still plays `attack`.
- **Multi-hit** (§5.2f), with the damage split and the impact timing both authored in the lab.
  Perfect Form is six hits.
- **Hit reactions land on impact**, not when the actor starts moving, and the card-flip spin
  alternates direction per hit so a volley reads as a volley.
- **Floating numbers scatter.** Six numbers arriving within a second used to stack on one pixel and
  read as one number flickering; each now carries a fixed spray vector assigned where the floater is
  made, and rises from mid-body rather than the feet.

**The stage lab and the battle draw the same pixels.** Proven pixel-wise (mean diff 5.0 across the
frame) and by landmark measurement to four decimal places, after three separate causes of divergence
were found and fixed — see §7.

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

- **Defence is not yet distinguishing anyone.** An understudy basic deals **1 damage to Rebar's 95
  P.DEF and 1 to Maxine's 20**. At the rescaled stat sizes, enemy attacks are too weak for
  mitigation to show, so Rebar's tanking comes entirely from having 22 HP against her 9. That is an
  enemy-kit problem rather than a stat problem, and it means *no defensive design can currently be
  evaluated* — including the one just built.
- **Front-row attacks barely exist.** Positioning works and almost nothing uses it: mobs have one
  ability each, and the reason to arrange a formation is that enemies punish a bad one. Until enemy
  kits land, a tank standing in front is theory.
- **A group `move` does nothing in a full party**, correctly — six units in six slots is rigid. See
  §5.2; the useful group shape is a rank exchange, not a shift.
- **Formation columns must not overlap between sides, and now do not.** Party holds 0–2, enemies
  3–5. Giving the party a third rank at column 2 — the enemy's front — put two units at the same
  formation coordinates, and `unitAt` finds a unit by position alone. An intent naming a front-rank
  Performer found the *enemy* standing there, `targetStillLegal` saw a living occupant and said yes,
  and the attack resolved into a slot with no living player in it. **Five enemies whiffed an entire
  round**, silently, with `act` in the log and no damage anywhere.
  It was reasoned to be safe on the grounds that reach is always asked about one side at a time.
  That is true of reach and false of `unitAt`. `targetStillLegal` now also checks the occupant's
  side, so the invariant is enforced where it matters rather than only maintained by convention.
- **Rules text drifts whenever behaviour lives outside the effect list.** This has now happened
  twice: `describeAbility` described Benjamin's Sunder as a plain hit while the engine shredded
  defence, and later described Rebar's Frost Armor as a plain guard buff while the engine also
  frosted every attacker. The generator's promise is that it *cannot* drift from the engine.
  **Rule: if a behaviour is not an entry in `effects`, the describer has to be taught about it
  explicitly** — a `riposte`, a passive rider, anything carried on a modifier.
- **Rules text now reads the effect list** (`describeAbility`). It briefly did not, and the ability
  panel confidently described Sunder as a plain hit and Rally as "+20 ATK" — the legacy `power`
  field — while the engine did something else entirely. The generator claims it "can never drift
  out of sync with what the engine actually does", and adding a second way to author an ability is
  exactly how that claim breaks.

  > **The same trap caught the AI, and it went unnoticed for far longer.** `scoreAction`'s buff
  > branch read `Ability.power` as a flat stat amount — true only under the legacy authoring — so
  > Rally's vestigial `power: 20` scored as twenty flat stat points and the auto-battler spent a
  > quarter of every turn casting it. Fixed with `buffStatGain`. **Two readers of the same
  > ambiguous field, and both of them got it wrong.** Anywhere else that reads `power` off an
  > ability with an `effects` list is suspect; the forecast panel's heal line was a third case, and
  > it was printing a multiplier where an HP figure belonged.
- **Percentage passives at this scale need `Unit.carry`, and `resilient` is the cautionary tale.**
  A stated 10% was delivering 1.3% because damage is usually 1–3 and it multiplied before rounding.
  Nothing in the game *said* so; the number looked reasonable on the sheet and the passive simply
  did not work. See §5.2 for the before/after table. **When a percentage meets a small integer,
  measure it rather than reading it** — and if you author a new percentage effect, bank it.
- **The damage floor is a FRACTION, not a number.** `MIN_DAMAGE_FRACTION` (0.05): a blow always
  lands for at least 1, *and* at least 5% of what it would deal unmitigated. Stated the other way
  round it is a cap on stacked mitigation — armour, elemental resistance, `resilient` and `chill`
  together may absorb at most **95%** of a hit.

  The flat `max(1, …)` it replaced was the fourth scale-dependent constant found in this codebase,
  and the most quietly wrong: **it has never once bound above level 1** (measured, 0 of 140 possible
  hits at levels 1, 10, 20, 40, 60 and 80), so the promise that "a heavily mitigated hit still
  registers" was being kept by accident. The ratio formula is scale-free, so the weakest hit in the
  game sits at a steady **~2.5% of the tankiest HP bar at every level** — which is the property
  worth having, and it now has a rule behind it instead of a coincidence. Against a 10,000 HP tank
  that is ~250 damage, not 1.

  Ordinary damage is **completely unchanged** by the fraction at every level; it is a backstop that
  binds only when resistance, armour and reduction all stack hard. Immunity stays exempt — an attack
  labelled IMMUNE that deals a trickle is a worse lie than one that deals nothing.
- ~~**A 1-damage hit cannot be reduced.**~~ **Resolved by the ×4 rescale.** The floor still exists and
  still cannot take a hit to zero, but at an average hit of 13 it catches **0.0%** of damage instead
  of 27%, so damage-reduction numbers no longer pay a tax. The lesson generalises: *a percentage is
  only worth what the number it multiplies can resolve* — if the average hit drops back near 1, every
  percentage in the game quietly stops working.
- ~~**The auto-battler cannot evaluate an enabler.**~~ **Resolved as a non-issue — do not fix it.**
  `scoreAction` is genuinely myopic (it scores the damage an action deals *now*, to the target it
  names, so Benjamin's shred and self-buff are invisible and his free basic outscores his whole kit
  per die). But it cannot reach anything a player sees, and there will never be an auto-battler to
  care:

  | claim made | what is actually true |
  | --- | --- |
  | "idle is a real game mode, so AFK uses him as a stick" | Idle rewards are `ratesFor(stage) × elapsed`. **No battle is simulated**, and accrual never reads the roster. |
  | "the player-side planner matters" | `bestPlan`/`nextDiceStep` are reachable only via `runAiPhase` ← `endPhase`/`simulateBattle` ← `src/cli/`. The UI resolves the player's queue with `commitNext` and calls `nextAiStep` only during the enemy phase. |
  | "this is the `allocate.ts` assumption chains will break" | Only for an AI that must *price* a chain. A player arming a symbol needs resolution-time arm/fire in `battle.ts` and a UI preview. `bestPlan` is never consulted. |

  There is no auto-battle and no skip (`BATTLE_DESIGN.md` §1), so **chains are not blocked by this
  and neither is Benjamin.** The one live use of `scoreAction` is `chooseEnemyAction`, the fallback
  when an enemy's declared target dies before the enemy phase — that path should keep working.
- **Stage progression does not exist.** `profile.stage` is always 1; winning does not advance it or
  grant rewards. The battle and idle layers are not yet connected. **Unaffected by the battle
  redesign — safe to build now.**
- **Party is the first five owned characters**, in roster order. No lineup management UI.
- **The summon screen advertises rates it cannot deliver.** Rarity runs **3–5**. Brax now fills the
  5★ tier, but **4★ is still empty**. `summon()` falls back to the whole pool for an
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

- **The height lint measured the bounding box, not the body — now fixed.** The guide's bands are
  about the figure, "excluding raised weapons, oversized hats, capes, hair extensions, and effects",
  but the audit read the opaque box. Maxine's compliant 85px body reported as 106 and Aethis's 86 as
  95: two false alarms against art that obeys the rule, raised by the one check that exists to catch
  art that does not. `PROP_HEADROOM` in `scripts/pack_sprites.py` now records the native pixels of
  prop standing above the crown (`maxine: 21`, `aethis: 9`, zero for everyone else) and
  `body_height()` discounts it.
  > **Lint only, deliberately.** It must not touch stature, because stature already excludes the
  > prop without being told: the renderer scales the whole cropped image by `contentPx / canvas`, so
  > the body lands at `bodyPx / canvas` and the hat scales with it rather than stealing from it.
  > Measured across the roster — Benjamin 0.664, Maxine 0.672, Aethis 0.680, Kael 0.711 — the cast
  > already stood correctly. Feeding these numbers into the render would shrink exactly the two
  > characters they exist to vindicate.
  >
  > Values are in each sprite's **own** canvas pixels, so a redraw onto 256 invalidates them and
  > they roughly double. Left stale the check under-counts the prop, which is why the note names the
  > discount explicitly.
- **The cast's real spread is tight; the mobs are the outliers.** Bodies, outline discounted:
  Rebar 80, Maxine 85, Aethis 86, Kael 90, Understudies 91–93. That is 80–93, not the 32% the
  bounding-box reading suggested. The Understudies are **approved as they are** — three of five sit
  1px over Standard. What is still unsettled is scale *classes*: Rebar at 80 is under Standard
  because he is a quadruped and the guide measures those by length, and Brax at 207 fits `large` but
  declares nothing. Both want a declaration, not a redraw.
- **Scale-class bands are now fractions of each sprite's own canvas.** They were hard-coded 128-grid
  pixels while only `boss` was canvas-relative. Nothing misreported, because `SCALE_CLASS` is empty
  — but the first class declared on 256 art would have been measured against a 128 band and reported
  at twice its size. They resolve to the guide's Section 4 numbers on both canvases.
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
- **The battle narrates itself.** A Final Fantasy–style message box reads "Benjamin uses Cross
  Slash on Red Understudy!" as each action resolves — bordered, centred, 560px, at the **foot of
  the stage**. It was first put in the dock to keep it off the artwork, on the reasoning that the
  bottom of *this* scene is where the front rank stands; but it only appears while the turn is
  resolving, when there is nothing to click behind it anyway, and reserving a dock row for it cost
  the band ~56px permanently. Over the stage it costs nothing.
  > Two layout notes. `justify-self: center` on the wrapper sizes the item to its **content**, so
  > the box's own `width: min(560px, 84%)` resolved against the text and came out 243px — it takes
  > `justify-self: stretch` plus flex centring. And the whole thing is paced for **reading**, not
  > for animation: at the original 620ms per step the next unit overwrote the sentence before it
  > could be finished, so a five-action round was a blur. `BEAT_MS` is 1500 (enemies 1700, since
  > their actions are the ones you did not choose), and the damage floaters were lengthened to
  > match.
  Phrasing follows `scope`, since naming a slot for an ability that hit five creatures reads as a
  bug, and the target is looked up among **all** units rather than the living ones — by the time an
  action resolves its target may be down, and that is exactly the line you want when they die to
  it. `actionLine` and `floaterClass` live in `narrate.ts` rather than in the component: they are
  pure mappings with a wrong answer available for every input, and reading sentences off a screen
  one battle at a time is not a test.
- **Elements are drawn, not spelled.** `ElementIcon` in `Avatar.tsx` carries seven `currentColor`
  SVG glyphs, and the sheet's weakness/resistance rows are the glyph plus a signed percentage rather
  than the element's name. A word costs a whole chip's width to say something the colour and shape
  say faster, and the name is still one hover away in the `title`. The same glyph is what the
  stage's matchup badge uses, so the two read as one fact in two places.
- **Two badge columns sit above every enemy, stacked in one anchored element.**
  `.unit-marks` holds the boss's escalation multiplier and — only while an elemental attack is being
  aimed, and only on creatures it can reach — how that creature takes it: the element's glyph and a
  signed percentage, red for *takes more*, blue for *takes less*. Same visual language as the
  sheet's matchup chips, because it is the same fact.
  **Neutral shows nothing at all**; a row of zeroes over every creature is noise, and the absence is
  the information. An ability with no element shows no markers either — absent is not neutral, it
  means the elemental layer does not apply (Benjamin's whole kit).
  > They are one column rather than two independently-anchored badges. Both were placed against the
  > same slot point, which is fine right up until a ramping boss is also a legal target and they are
  > drawn on top of each other. "Usually they do not coincide" is not a layout.
- **The commit button is pinned to the foot of the tray**, and the tray can no longer exceed its
  band. It was the last item in a centred stack, so every queued action pushed it down: at five
  actions the tray stood 388px inside a 317px band and the button sat *below the window's edge*.
  Three things were wrong and all three had to be fixed — a grid item's default `min-height: auto`
  is its content's height, so the fixed band was not fixed; the queue carried a `max-height` with
  `overflow-y: auto`, which hid the fifth row; and the hints block is authored *after* the controls
  in the DOM, so even once pinned it sat below the button and shoved it back up by its own height.
  `min-height: 0` on the band, explicit `order` on the four rows, and `margin-top: auto` on the
  controls. The button now measures 800–836 whether nothing or five actions are queued.
  > **Not floated.** A floating button would have to go over the artwork, and the bottom of this
  > scene is where the front rank stands — the same reason the narration box could not live there.
  > Anchored to the foot of its own panel it never moves at all, which is the property that was
  > actually wanted. The dice also came down from 74px to 58px: the pool grew to six when
  > contributed dice arrived, and the second full row has to come out of somewhere.
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

**The bottleneck has moved.** For a long time the battle *mechanics* were the missing piece. They
mostly are not any more — turn phases, modifiers, chains, statuses, positioning and cooldowns are
all in. **What is missing is content that uses them**, and specifically enemies. Every defensive
mechanic built recently is currently unevaluable because mobs have one weak attack each: a tank
cannot be judged, a formation cannot be punished, and nothing is worth freezing.

**Next up, in order:**

1. **Enemy kits.** The blocker on everything else. Enemies need 1–4 abilities with d20 activation
   bands, and the shapes to aim for are now specified by what the player side can answer:
   - **Front-row single-target attacks**, common, so standing in front means something and a tank
     earns its slot (§5.2).
   - **AoE**, so leaning on one tank is punished and defence buffs and heals have a job.
   - **A physical/magical mix**, so a single defensive answer is never sufficient — this is the
     FFBE texture the design is chasing: bring the right tank, or two, plus a buffer.
   - **Something worth freezing** — a wind-up, a ramp, a telegraphed ultimate that losing costs the
     enemy dearly. Freeze is built and has nothing to deny.
   The boss ramp (§5.3) and the False Lead's rotating resistance stay boss-shaped; ordinary mobs
   should get neither.
2. **Party / lineup management.** In-battle repositioning covers the positional half now (§5.2), so
   what is left is the *pre-battle* screen: which five perform, and their starting arrangement.
   Roster order is still the formation, and there is still no screen to change it.
3. **The remaining three kits** — Aethis, Brax, Veyra — against `BATTLE_DESIGN.md`. Author them one
   at a time and let each specify the next mechanic, which is how the last three went. Benjamin,
   Rebar and **Maxine** are done. Shapes now available that were not when the remaining kits were
   written: a passive can change the **pool** rather than a stat (Benjamin), can be a **reactive
   rider** (Rebar's riposte), can **read the target's state** (`exploitCold`) or **the act of
   applying a status** (`frostFervor`), and an upgrade tier can grant a **charge that changes what
   an ability costs** (`freeCastOnFreeze`), **rewrite an enemy's declared intent and hold it for
   a second round** (Kael's taunt and `lastingTaunt`), or **scale off hits taken this turn**
   (`Unit.grudge`, which every unit counts and any passive may read). An ability's power can be conditional on a target state or scale off a status counter
   (§5.2d). Note the tiers' +10% stat bonus is genuine filler for all
   three, since only Benjamin converts personal stats into team stats — so their passives have to
   carry their tiers.
   > **Frost now has two readers and wants no more for a while.** Rebar builds it, Maxine converts
   > it. A third character reading the same counter would make the frost team the answer to
   > everything; Kael, Aethis and Brax should each claim a mechanic of their own.

3b. **Redo every star tree** (§5.5), once the kits above are settled, and give rarity a say in the
   tree's shape and in `starCost` at the same time.
4. **Rebuild the art at 256px** (style guide v3.0) — Kael, Aethis, Maxine and Rebar. Benjamin is
   done and Brax was already there. Deliberately **not urgent**: 128 and 256 sprites render at
   correct relative scale side by side, so the roster migrates one actor at a time. Settle
   Benjamin's height first — he is the reference every later sprite is matched to, and he currently
   sits at the top of the Standard band rather than the middle (see §8).
5. **Enemy art** — they are role badges on a painted stage; the most visible gap.
5b. **Scenes for the rest of the ladder.** Stages 1–10 are dressed; everything past them falls back
   to the flat backdrop. The authoring loop is built and cheap now, so this is content work rather
   than engineering — and the boss stages are the ones worth a set of their own, since
   `sceneIdForStage` resolves a narrow range over a broad one specifically to allow it.
6. **Stage progression** — winning advances `profile.stage`, grants rewards, raises the idle rate.
   The missing link between the two halves of the game, and independent of the battle work.

**Design directions agreed but not built:**

- **Tanking has three shapes and two are implemented.** Standing in the front rank is the baseline
  (Rebar); **taunt** — cast at an enemy, pulling everything that creature does onto the taunter — is
  Kael's. Still open: **cover**, cast at an *ally* and taking what is aimed at them, which is the
  only one of the three that can catch a whole-side attack. Cover as an always-on passive was
  explicitly rejected — if it happens it should be something a Performer *does*, not something they
  are.
- **A second tank matters.** Rebar's soft magical defence is deliberate so that a magical-damage
  fight wants somebody else. Brax is the obvious carrier when his placeholder kit is replaced.
- **Line / row / column attacks.** Discussed, not decided. `unitsHit` is four lines and the single
  chokepoint, so a new scope is small — but it must be **previewed on the board**, or it repeats
  the mistake that killed AoE radius: asking the player to work out which slots are collinear.
- **Telegraphed zones the party can move out of.** The telegraph machinery still exists
  (`PendingCast`, `turnsLeft`) and lost its counterplay when movement was removed. With `move`
  built, marking an area and detonating it next turn becomes a real decision again — spend a
  Performer's action repositioning, or eat it.
- **Frost's second reader.** Deliberately deferred: a character whose playstyle is damage through
  freezing, and/or a passive like "−5% DEF per frost stack, up to 5".

**Deliberately dropped:**

- **Auto-battle and skip.** Every stage is played by hand — reasoned in `BATTLE_DESIGN.md` §1. The
  player-side planner (`bestPlan`, `nextDiceStep`) has no future use and is safe to delete.
- **The balance simulator** (§2). Not the measuring instrument this game is designed around.
- **Enemy difficulty tuning in the current system.** The system is being replaced; tuning it now
  produces numbers that describe mechanics that are going away.

**Planned, further out:**

- **Server-authoritative idle** via Supabase. The client sends `claim`; the server computes
  `now() − last_claimed_at` against the stage rate and writes reward and timestamp in one
  transaction. The client never sends a number or a time. `idle.ts` is already shaped for this.
- **More clips per Performer** — hit, cast, death, and a sheet per ability for the rest of the
  roster. The pipeline, the lab and `abilityClipName` already support any clip name; only art is
  missing. Benjamin is the worked example of how far this goes.
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
- **A Python edit script that omits `encoding='utf-8'` on `write_text` can truncate the file it is
  editing.** `UnicodeEncodeError` is raised *during* the write on Windows' cp1252 default, after
  the file has been opened for writing — so the original content is gone and only the prefix
  survives. It cost a test script mid-session. Always pass the encoding on both `read_text` and
  `write_text`, and assert the match count before writing.
- **PowerShell `$_` is eaten by Bash.** Killing stray processes needs the PowerShell tool, not a
  `powershell -Command` string from Bash.
- `dist/` is deleted on every build. **Never leave source art there.**
- **Read-modify-write on a file another process may be reading is a torn read.** The packer's
  manifest lost its `stamp` three times before this was the answer; it writes through a temp file
  and `os.replace` now, with a Windows retry, and `is_ours` treats a missing stamp on a populated
  manifest as recoverable rather than as proof of foreign ownership.
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
  and several sprite scale problems — and a badge that reported the right text at the right
  coordinates while being drawn *underneath* the creature it described.
- **`getBoundingClientRect` is not proof a thing is visible.** Check the computed `z-index` too. A
  badge measured 45×20 at the correct position and was invisible: the block set `z-index` twice and
  the second declaration won. **A duplicated property inside one CSS rule is silent** — no warning
  from the browser, none from the build.
- **React's `onMouseEnter` does not fire from a synthetic `mouseenter` event.** React delegates
  through `mouseover`, so a CDP-driven hover test has to dispatch `pointerover`/`mouseover`, or use
  the `onFocus` path if there is one. A hover probe that silently does nothing looks exactly like a
  handler that is not wired up.
- **Console errors collected over a CDP session are cumulative and include stale HMR failures.** An
  error naming a symbol you just added is usually the *previous* module still in memory; reload and
  re-check before chasing it. Two red herrings this session.

**CSS and React traps found the hard way**

Every one of these cost a debugging session, and every one of them is silent.

- **A CSS animation REPLACES an inline transform, it does not compose with it.** An enemy carries
  `scaleX(facing)` inline; the pain-reaction animation set `transform`, so every enemy finished the
  flip facing the wrong way. The fix is always a wrapper element — `.anim-pose`, `.hit-spin`,
  `.proscenium-frame` all exist for exactly this and nothing else. If two things need to transform
  one subject, they need two elements.
- **`transform-origin` does not centre a subject.** It names the one point a scale does *not* move.
  Centring something in the frame needs a translate, which is why the camera model was rewritten
  from origin-based to centre-based — the origin form could not centre a back-row Performer no
  matter what was passed to it.
- **A percentage translate resolves against the element's own box.** The same `translateX(-3%)` on a
  2701px element and a 1550px one moves them 7px apart, which is where the curtain/pillar parallax
  drift came from. It is also why an animated stage layer's wrapper spans the whole frame: `travel`
  then means a percentage of the *stage*, which an animator can reason about, instead of a multiple
  of the bird's own width.
- **`transition` is a single property, so a later rule replaces it rather than adding to it.**
  Two rules each transitioning one thing means only the second one animates.
- **An absolutely positioned wrapper with `width: auto` shrink-to-fits its content.** Wrap a child
  asking for `width: 100%` in one and the two ask each other and settle on **zero** — every animated
  stage layer rendered 0px wide and simply was not there.
- **`useMemo` is not referentially stable in dev.** React double-invokes to surface impurity, so an
  identity comparison against a memo result is a comparison that is sometimes false for no reason.
  It was spuriously pushing undo snapshots.
- **No side effects inside a setState updater**, for the same reason: it runs twice. A counter
  incremented inside `setPast` doubled every redo.
- **Deleting CSS rules by line index leaves dangling selectors**, which break the `@media` block
  they were in and silently kill everything after them. Brace-count the file after any structural
  CSS edit — 484 open against 483 close is how that one was found.
- **A memo keyed to the wrong state is invisible until two states disagree.** The info panel showed
  the hovered Performer's name over the selected Performer's kit, because `kitAbilities` was still
  keyed to `sel.unit` after the panel learned to follow the hover.
- **Declaration order is real: a memo that reads `board` must be declared after it.** Repositioning
  crashed on a TDZ error that only the `scope: 'slot'` branch could reach, ~560 lines from the
  declaration.

**Engine traps found the hard way**

- **`commitAction` does not chain.** It resolves an ability directly and never arms a symbol; the
  chain-aware path is `planAction` → `commitNext`, which drains `s.plan`. A test that reaches for
  `commitAction` will report every chain as not firing and look like a content bug. Verified
  end-to-end through `planAction`/`commitNext` instead.
- **A trigger on an ability with no `effects` list used to be silently dropped.** `applyAbility`
  branched on `if (ability.effects)` and the legacy path never looked at the trigger — the chain
  still logged as firing. Nothing shipped had the bug, but only by luck: every triggered ability
  happened to be written with effects. `applyAbility` now synthesises the one-effect list an attack
  is equivalent to, so a trigger works wherever it is written.
- **`empower` has to reach `versus` too.** `powerAgainst` returns `versus.frozen` *instead of*
  `power`, so raising only `power` made a chain worth nothing against exactly the targets a `versus`
  ability was written for. Any future conditional-power field needs the same treatment.
- **`applyModifier` replaces, it does not stack.** It keys on ability + stat and overwrites what it
  finds, which is right for a buff cast twice and exactly wrong for a per-event accumulator — five
  creatures frosted one at a time have to add up to five, not overwrite down to one. `frostFervor`
  reads the existing amount and adds to it explicitly.
- **Upgrade tiers raise max HP, not just attack and defence.** `UPGRADE_STAT_BONUS` applies to all
  three and `commitUpgrade` grants the new headroom as healing, so buying a tier is also a partial
  heal. Excluding HP would cost every character 23% of their fully-upgraded pool — a global balance
  change, not a per-character one.
- **`ModSource` has no "self" option.** It is `targetBase | casterCurrent`; a self-buff passes the
  holder as both caster and target and uses `targetBase`, which reads their own BASE stat so a
  second application does not compound.

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
