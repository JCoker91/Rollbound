# Battle Design — the target system

**Status: in build.** This document specifies the battle the game is being rebuilt towards.
Most of it is now implemented (see the table). Symbols and chains (§4) and the first statuses (§6)
are built. **What is left is enemy kits and the remaining four Performers** — the mechanics are
largely in place and the content is not.
**Benjamin (§8) is the first Performer authored against this document**, and building him is what
drove the phase model, modifiers, ordered effects and cooldowns in.

| § | piece | state |
| --- | --- | --- |
| 5 | Enemy intent — d20 roll against a shown table, revealed target | **built** |
| 2 | Turn loop — planning queue, commit-and-lock, ordered resolution | **built** |
| 2 | Start / Resolve / End phases, with expiry at the End | **built** |
| 2 | Abilities as an ordered list of effects | **built** |
| 2 | Enemy phase strictly simultaneous (currently sequential within one phase) | not built |
| 3 | Damage types, split defenses | **built** |
| 3 | Elementless abilities (`element` optional) | **built** |
| 6 | Timed stat modifiers — durations, per-track, named percentage source | **built** |
| 6 | Statuses — frost, freeze, sleep | **built** |
| 6 | More statuses — burn, paralyze, blind | not built; they share the clock above |
| 2 | Party formation is three ranks; enemy `range` reads it | **built** |
| 2 | Movement as an ability (`move` effect) | **built**; no kit uses it yet |
| 8 | Player-side cooldowns | **built** |
| 4 | Symbols and chains — arming, forward reads, the three trigger shapes | **built** |
| 8 | Taunt — redirect a declared intent onto the taunter | **built** |
| 8 | Cover — absorb what is aimed at an ally | not built; see below |
| 1 | No auto-battle, ever | **decided** — see §1 |

Read this before touching battle code. Read **§1** before touching anything at all, because every
other decision in this document follows from it and a change that violates it breaks the game's
whole premise rather than just its balance.

---

## 1. The goal: composition, not collection

**A well-built team of 3★ Performers must beat a badly-built team of 5★ Performers.**

This is a gacha game, and the thing being avoided is the genre default where the answer to every
fight is "pull a better character." Power is meant to come from how a team fits together — against
*this* enemy, with *these* abilities, in *this* order.

### The rule that makes it true

Star power is **capped and linear**. Composition power is **uncapped and multiplicative**. The
ceiling on the second must sit above the ceiling on the first.

With star nodes at roughly +10% per rung, a maxed character is **×1.50**. Composition multipliers
stack:

| what lines up | multiplier |
| --- | --- |
| nothing | ×1.00 |
| right damage type | ×1.40 |
| elemental weakness | ×1.50 |
| weakness + damage type | ×2.10 |
| weakness + type + one chain | ×2.73 |
| weakness + type + two chains | ×3.55 |

So a **3★ character with weakness and the right damage type reaches ×2.73, against a 5★ with
nothing at ×1.50.** The entire star tree is worth less than two composition bonuses. The goal is
satisfied by arithmetic, not by good intentions.

> **The invariant: no star node may grant a multiplier on an axis composition already multiplies.**
>
> A node reading "+25% damage to enemies weak to your element" multiplies the multiplier and puts
> 5★ back on top instantly. Flat stat nodes are fine. Synergy nodes are poison. Check every new
> star node against this before adding it.

### There is no auto-battle and no skip — DECIDED

**Every stage is played by hand.** No auto button, no skip button, no headless resolve of a stage
the player has already cleared.

This follows from §1 rather than sitting beside it. If composition is the source of power, the place
that power is *expressed* is the turn: which abilities, in which order, against a revealed intent. An
auto button resolves exactly that decision on the player's behalf, which makes the game's whole
subject invisible at precisely the moment it matters. A game about calculated battles cannot have a
button that declines to calculate.

The early stages being easy is fine and intended — they are where the rhythm is taught. The shape
being aimed at is a **gate every tenth stage**: a boss the player has to gear up for, which is why
the corridor is tuned to about `party level ≈ stage − 3` while a boss asks four levels more
(README §8). A wall, then a downhill stretch, then the next wall. A skip button flattens that into a
formality.

**What this rules out, concretely:**

- `scoreAction` / `bestPlan` / `nextDiceStep` will never need to plan a player turn well. They are
  not on the roadmap and are not a blocker for anything.
- Chains do **not** need `allocate.ts` fixed first. The long-standing warning that its independence
  assumption blocks chains only applies to an AI that must *price* a chain. A player arming a symbol
  needs the engine to arm and fire symbols during resolution, and the UI to show what is live.
  `bestPlan` is never consulted on the player's path.
- Idle stays what it is: an accrual rate, not a simulation. Growth between sessions comes from
  currency and levels, and the battles themselves are always the player's.

**Still live, and not covered by this:** `scoreAction` remains reachable on one narrow enemy path —
`chooseEnemyAction` is the fallback when a declared intent's named target has died since the reveal.
That is a genuine use and should keep working.

---

## 2. Turn structure — BUILT

Each side's turn has three phases — **Start Turn, Resolve, End Turn** — and the two bookends are
*simultaneous for everyone on that side*. Nothing that happens at Start or End belongs to a
particular unit's slot in the order; a regen tick and an expiring buff land together, so no effect
can depend on who happens to be listed first.

One round, in order:

1. **Start Turn (player).** Regeneration ticks. Cooldowns count down. The shared dice pool is
   rolled — the player sees the dice before planning.
2. **Reveal enemy intent** — for every living enemy, which ability it will use and on whom.
3. **Player plans.** Assign abilities to Performers, paying exact dice sums, and place them in a
   resolution order.
4. **Commit.** The plan locks. There is no stopping partway, no reacting to a result, no re-planning.
5. **Resolve.** Player abilities resolve one at a time, in the assigned order.
6. **End Turn (player).** Damage over time ticks. Modifier and status durations count down, and
   anything reaching zero expires. All at once.
7. The enemy turn runs the same three phases, using the intents revealed in step 2.

### Within one ability, effects resolve in authored order

An ability is a **list of effects**, not a single kind, and it resolves them top to bottom. This is
the whole answer to "does the self-buff apply before or after the damage": it applies wherever it
is written, and it should be *written* in the order it happens.

So the ult is authored and worded as **"Gain 20% ATK for 3 turns, then deal damage"** — not "deal
damage and gain 20% ATK". The first phrasing is unambiguous about whether the strike benefits from
the buff, and it is the same order the code executes. If a kit ever wants the other behaviour, it
writes the effects the other way round and says so.

### A duration applied this turn ticks at the end of this turn

A 3-turn buff cast on turn one is active for turns **one, two and three**, and is gone when turn
four begins. There is no grace round: the turn it was cast on is the first of the three.

That is what makes a 3-turn modifier mean "buff, act, act, then reapply" — one spare turn in the
cycle where that Performer's dice can go to somebody else. Counting from the *next* turn instead
would quietly make every duration one longer than it reads.

**A cooldown counts turns you cannot use it.** A 2-turn cooldown used on turn three means turns
four and five are locked out and turn six is available again.

> **As implemented.** `planAction` / `planUpgrade` queue an action and reserve its dice
> immediately, so the tray shows what is genuinely left to spend; `unplan` gives them back.
> `movePlanned` reorders. `commitNext` resolves the front of the queue and returns what happened,
> so the UI can animate one action at a time — resolving the whole turn in a frame would collapse
> an ordered plan into one indistinguishable flash. `commitPlan` drains it for headless use, and
> the two are verified to reach identical state.
>
> **Nothing is re-validated at resolution.** An action whose target died earlier in the same queue
> fizzles and its dice are gone. That is the cost of ordering badly, and removing it would remove
> the decision.
>
> Still sequential rather than strictly simultaneous on the enemy side: enemies resolve one after
> another inside a single uninterruptible phase. The player cannot act between them, which is the
> property that matters for burst, but a kill by the first enemy does change what the third finds.

### Why commit-and-lock matters

It is the reason ordering is a real decision. If the player could watch each ability land and stop,
ordering would become a probe — cast the cheap thing, see what happened, then decide. Locking the
whole turn means the order *is* the plan, and being wrong about it is the cost of being wrong.

It also means **randomness must land before the commit, never after.** The dice roll is good
randomness: it varies the puzzle, then the player solves the puzzle it dealt. An effect that rolls
*after* commitment does not vary the puzzle — it invalidates the player's solution to it, with no
line they could have played instead. See §6 for what this rules out.

### Dice pool

**5d6 as the base, and RESOLVED below.** 6d6 was worth testing, but the choice was never about feel
— it is about how large the biggest ability costs get:

| cost | payable from 5d6 | payable from 6d6 |
| --- | --- | --- |
| 6 | 97.4% | 99.1% |
| 12 | 89.9% | 98.3% |
| 15 | 64.1% | 90.7% |
| 18 | 35.2% | 74.7% |

Below cost 12 the sixth die changes almost nothing (+2 to +8 points) and actions per turn barely
move (2.68 → 3.10 on a mixed team). Above 12 it changes everything. So:

- **5d6 → usable cost range is 1–12.** Anything above is a gimmick.
- **6d6 → usable cost range is 1–18.**

One caution before adding the die: **6d6 makes chains cheaper to afford**, which softens the best
tension in the design (§4).

> **RESOLVED, partly — the base pool stays 5d6, and the sixth die is a CHARACTER.** Benjamin's
> Drillmaster passive puts one in the pool while he is standing, so the sixth die is a composition
> decision rather than a global rule, and the usable cost range stays 1–12 for a party that does not
> field him. It is a d6 with **three blank faces**, which is +0.50 dice a turn rather than +1.00 —
> enough to soften the chain caution above to roughly half of what this section warns about.
>
> A finding worth carrying into any future dice effect: **face values are not the balance lever,
> blanks are.** A wildcard costs any single die whatever its value, so a d3 is not a weak d6 — over
> all 7,776 rolls it beats a true d6 at every cost from 1 to 12, because small dice are precision
> tools for exact sums. Anything meant to be a *weaker* die has to be blank some of the time.
>
> The pool is now `Die[]` with ids and mutation helpers (`setDieValue`, `doubleDie`, `addDie`), so
> abilities that alter dice rather than spend them — "double a chosen die this round" — have a
> surface to be written against. See README §5.1.

Two facts to author costs against:

- **Sweet spots: 6 (97.4%), 10 (92.6%), 5 (92.2%), 8 (91.8%).**
- **Costs 1 (59.8%) and 2 (70.4%) are genuinely unreliable** — good as a drawback on a strong kit,
  bad as cheap filler.
- **Low costs collide.** A team whose abilities all cost 1–3 gets only 2.61 actions from 5d6, barely
  more than a team costing 5–11 at 1.92. Five characters wanting small exact sums fight over the
  same small dice. Cost *spread* is a composition axis for free.

---

## 3. Damage types and elements — TYPES BUILT

### Three damage types

| type | mitigated by | notes |
| --- | --- | --- |
| **Physical** | target's physical defense | |
| **Magical** | target's magical defense | |
| **True** | nothing | see the cap below |

Enemies carry separate physical and magical defense, and may be armoured against one and soft to the
other. Choosing the damage type an enemy is soft to is the first composition axis.

> **True damage must be the floor, not the ceiling.**
>
> As a full-strength damage type True is *never wrong* — no enemy resists it — and the never-wrong
> option is what erases composition decisions. Price it at roughly **55% of a typed ability's
> power**, which with `100/(100+DEF)` mitigation puts its crossover around DEF 80:
>
> | target | typed | True | winner |
> | --- | --- | --- | --- |
> | DEF 30 (mob) | 0.77 | 0.55 | typed |
> | DEF 80 | 0.56 | 0.55 | even |
> | DEF 150 (armoured boss) | 0.40 | 0.55 | **True** |
>
> True then answers a specific problem — the boss armoured against both — rather than being a build.
> Keep it rare: one True ability on a handful of Performers, never a whole kit.
>
> **As implemented.** `Ability.damageType` is `physical` (default) / `magical` / `true`, and
> `effectiveDefense(unit, type)` returns the matching track — or **0 for True**, so one place knows
> that True bypasses armour and every caller reasoning about mitigation gets it right for free.
> Stat blocks carry `physicalDefense` and `magicalDefense`; a guard buff and a defensive star node
> both raise **both** tracks, because splitting them would halve every defensive ability without
> adding a decision — per-type warding belongs to elemental resistance, which is a separate axis.
>
> The 55% pricing was verified against the crossover claim above: typed @1.0 versus true @0.55 is
> **even at exactly DEF 80**, typed wins below it, True wins above.

### Elements

Not every Performer deals elemental damage. Enemies may be weak to an element and resistant to
another.

> **As implemented.** Elements belong to ABILITIES, not to units — a `CharacterDef` has no
> `element` field, only `resistances`. That is what allows a Performer with both a fire and a water
> ability, and it frees resistance from the wheel's rigid one-weakness/one-resistance shape.
> `aligned('fire')` reproduces the familiar spread in one line for the common case, so the wheel
> survives as a guessable default rather than as a law.

- **Elemental abilities** are spiky: strong into a weakness, weak into a resistance.
- **Non-elemental abilities have a higher baseline** precisely because they cannot exploit weakness.

The two are a genuine choice only when the player cannot always predict what they will face.
**Encounters with mixed weaknesses are what earn non-elemental Performers a roster slot** — if every
encounter has exactly one weakness, elemental specialists always win and the neutral option is dead
weight. This is an encounter-authoring responsibility, not a stat-tuning one.

Note that non-elemental and True are different answers to "no weakness available," and must stay
distinct: **non-elemental = higher power, still mitigated. True = lower power, unmitigated.** They
win against different targets.

---

## 4. Symbols and chains — BUILT

The primary composition mechanic.

Every ability may carry a **symbol**. Symbols are deliberately **orthogonal to element, weapon and
role** — not every sword user shares one, not every fire user shares one. They are scattered across
the roster so that discovering which Performers combine is its own kind of creativity.

### How a chain fires

Resolution is ordered (§2), and the chain reads forward:

1. An ability with a symbol resolves. That symbol is now **armed** for the rest of the round.
2. Every *later* ability sharing an armed symbol **fires its own trigger effect**.

So a three-ability chain produces two triggers, and the arming ability gets nothing. **Ordering is
strategy**: put the cheap symbol-carrier first and the payload later.

### A symbol is a MARK, not a word — BUILT

Symbols are the one piece of ability data that is *only* an identity: a symbol does nothing, it
matches. So the UI draws the shape (`SymbolIcon`, all ten) and spends text only on what the shape
cannot say.

| | was | is |
| --- | --- | --- |
| carrier with a trigger | "Anvil. If Anvil was already played this turn, shreds 15% deeper." | ⚒ **Chained:** shreds 15% deeper. |
| carrier without one | "Thorn. Plays Thorn for whoever acts after." | 🌿 |

The prose restated the rule once per ability, on every kit, forever — and the rule it restated is
the one a player learns once. The single real distinction it carried, **carrier versus trigger**, is
now the chip's fill: filled gold means this ability does something extra when it chains, outlined
means it only ever arms for somebody else. That makes "which two of these four chain, and which of
them benefits" answerable from the kit list without hovering anything.

### The trigger belongs to the ability, not the symbol

This is the most important structural decision in the mechanic. The effect that fires is authored on
the **ability doing the chaining**, so the same symbol does different things depending on who chains
it. The interesting question stops being "do I have the symbol" and becomes **"whose trigger do I
want to fire."**

Symbol-owns-the-effect would be far flatter and would collapse into a lookup table.

An ability's data is therefore: **cost, damage type, element, symbol, trigger effect.**

### Density

For a random five-Performer team, counting symbols carried by two or more members:

| pool size | symbols per character | chainable symbols | teams with no chain at all |
| --- | --- | --- | --- |
| 8 | 1 | 0.97 | 36% |
| **8** | **2** | **2.94** | **3%** |
| 12 | 2 | 2.35 | 7% |
| 8 | 3 | 4.95 | 0% |

**Target: 8–12 symbols in the pool, 2 per character.**

One per character leaves a third of teams unable to chain at all — too random for a game about
composition. Three makes chains automatic, so there is no decision. Two gives 2–3 live options per
team: reliably *available*, never free, and there is a real choice of which chain to run.

### The interlock worth protecting

A chain needs two abilities in the same round, and the pool only funds about three actions.
**Chaining costs you breadth** — two Performers commit dice to a shared symbol and somebody sits
out. That trade is what stops "always chain" from being the solved answer, and it is the reason the
dice pool must survive into the new system rather than being replaced by a simpler action economy.

It also makes **symbol cost placement** a balance lever as sharp as the trigger effects themselves. A
symbol carried by two cost-2 abilities is a cheap reliable chain. The same symbol on a 5 and a 9 is
a chain you can only afford on a good roll.

### Trigger effects must sit in one power band

Triggers do varied things — bonus damage, retargeting, self-sustain, applying a status, or improving
an existing effect's odds. Examples of the intended range:

- deal an additional 30% of ATK as damage
- heal self 20% of max HP
- raise this ability's burn chance from 50% to 75%
- apply paralyze to the target
- target the entire enemy team instead of a single target

> **That last one is an order of magnitude above the others** — ×5 against a full board, against
> +0.3 power for the first. If triggers span +30% to +500%, composition does not become creative; it
> becomes "find the AoE conversion, everything else is filler." That is exactly the
> single-best-answer problem this design exists to avoid.
>
> **Fix: attach AoE-conversion triggers to low-power abilities**, so conversion is a different
> *shape* of the same budget rather than a bigger budget:
>
> | | power | targets | total |
> | --- | --- | --- | --- |
> | big single hit + 30% trigger | 2.0 → 2.3 | 1 | 2.3 |
> | small hit converted to team-wide | 0.5 | 5 | 2.5 |
>
> Comparable output, opposite use: the conversion is worthless against a lone boss and devastating
> against a full board. A composition decision instead of a strict upgrade.

> **As implemented.** `BattleState.armed` holds the symbols played so far this round, cleared at the
> top of every turn — "armed for the rest of the round" and no longer. `commitNext` reads
> `chainFires` **before** arming, so an ability can never chain off its own symbol; a three-ability
> chain therefore produces two triggers, as specified.
>
> A trigger builds a fresh effect list rather than mutating the ability, since ability definitions
> are shared content and a chain lasts one resolution. The three shapes in `ChainTrigger` are
> exactly what the design's examples need: `effects` appends, `retarget` redirects, `amplify`
> deepens. **`amplify` cannot be sugar for an appended `modify`** — modifiers are keyed by ability
> name, so a second `modify` from Sunder would REFRESH its shred rather than deepen it.
>
> `chainPreview` walks the plan in order and returns which entries will fire, so the queue can show
> the chain before anything resolves — that is what makes reordering a decision rather than a
> guess. It lives in the engine rather than the UI because it has to agree with `commitNext`
> exactly; two implementations of "does this chain" would drift the first time the rule changed.
>
> Chains are **player-side only**. Enemies act on declared intents with no order to choose, so a
> chain among them would be neither plannable nor visible.
>
> Verified in isolation: a symbol arms but does not fire for its own ability; Sunder's shred goes
> -11 to -18 on a base-44 target when chained and stays -11 when not; Rally buffs one ally alone and
> all five chained; and the chain event is logged only when one actually fires. Driven through the
> real UI end to end, the queue showed Rebar's Maul arming `lantern` unlit and Benjamin's Rally lit
> with its trigger text.

---

## 5. Enemy intent — BUILT

Every living enemy shows, during the player's planning phase, **which ability it will use and on
whom**.

> **As implemented.** `chooseIntents` runs at the top of the player's phase, so the declaration
> exists before the player plans — choosing at the top of the *enemy* phase would be too late to be
> worth showing. Ability choice is weighted by `Ability.weight` (default 1, so an unweighted kit is
> uniform); targets are picked uniformly among legal ones, because targeting is not where the
> interest lives and "always hits the weakest" would make the reveal redundant. The enemy phase
> executes the declared intent rather than re-choosing — re-choosing would break the promise the
> reveal makes — falling back to a fresh choice only when the named target has since died, which is
> itself a legitimate player answer.
>
> Verified against the `Understudy` test encounter: 2,000 declarations came out 76.3% / 23.8%
> against an authored 75 / 25, and declared-versus-performed matched exactly.

Enemies have **1 ability (weak mobs) to 4 (bosses)**, each with a **hidden** activation chance — a
boss might sit at 20% / 30% / 30% / 20%. The player sees the *choice that was made*, never the
odds. So the current round is plannable and the next one is not, which keeps tension without making
the turn a guess.

**Show the target, not just the ability.** `Fallen Seraph → Judgment → whole party` is a far richer
input than `Fallen Seraph → Judgment`: it supports shielding that specific Performer, pre-healing
them, or racing to kill the caster. Three answers instead of one.

### This is what makes statuses matter

Visible intent plus one-round debuffs closes the counterplay hole the older system had, where a
telegraphed attack could only be pre-healed. Now: you see Judgment coming, you blind the caster, the
attack fizzles. A one-round debuff has an exactly legible value — **you negated one enemy action.**

### Open: is intent disruptable?

Unsettled, and worth settling deliberately. If a stun, silence or taunt-redirect can change a
revealed intent, that creates **disruption as a composition role** — a role that exists *only*
because intent is visible, and one that would give support Performers something to do besides heal.

---

## 6. Status effects and modifiers — BUILT

Two families, one clock, different lifespans:

- **Statuses** — blind, paralyze, burn. Sharp, short, disruptive.
- **Modifiers** — timed changes to Attack, Physical Defense or Magical Defense. Longer, and the
  substance of every support kit.

### Duration

Durations tick at the **End Turn** phase of the side that applied them (§2), so they are counted in
that side's own turns. A 3-turn buff cast by a Performer on turn one covers turns one, two and
three; a 3-turn debuff an enemy lands covers three enemy turns. Either way it is three rounds — the
two clocks only differ in where in the round they tick.

The turn an effect is applied is the **first** of its turns, not a free one before the count starts.

Statuses are typically 1 turn. **Modifiers are typically 3**, and that is deliberate rather than
generous. Three is what makes a support kit *manageable* instead of a chore: buff on turn one,
debuff on turn two, and turn three is free — a spare turn where that Performer's dice can go to
somebody else. At two, the loop has no slack and every turn is spent maintaining. A starting
Performer in particular has to teach the rhythm without the player feeling behind on upkeep.

**Where the balance lever goes:** if a modifier is too strong, cut its magnitude, not its duration.
Duration is the ergonomics of the kit; magnitude is its power. They are not interchangeable, and
trading away the first to fix the second makes the character worse to play rather than weaker.

### What a modifier changes

Attack, Physical Defense, Magical Defense. Not max HP — a buff that moves the HP ceiling has to
decide what happens to current HP when it expires, and every answer is either a heal, a surprise
death, or a special case.

Offense is one stat. `attack` drives physical hits, magical hits and healing alike, so a modifier
to Attack is worth the same to a blade, a staff and a healer. Defense stays split across two
tracks, so a shred can be pointed at one of them.

### Stacking: refresh within an ability, stack across abilities

- **The same ability recast refreshes its own effect.** It does not stack with itself. Rally cast
  twice on one ally is one modifier with its clock reset.
- **Different abilities stack**, as separate modifiers with separate clocks. Two sources of +20%
  give +40%, and each expires on its own schedule.

### Percentages resolve to a flat amount at cast time, from a named source

This is the rule that keeps stacking honest. A modifier stores a **number**, computed once when it
lands, and every ability states what its percentage is a percentage *of*:

| source | reads | so two 20% buffs give |
| --- | --- | --- |
| **target's base** | the target's own unmodified stat | +40% of base — additive, no compounding |
| **caster's current** | the caster's stat *including* their own live modifiers | whatever the caster was worth at that moment |

Without this, "+20% then +20%" silently means +44% and the second buff is worth more than the
first for no reason a player could predict. Resolving to a flat number at cast time also makes
expiry trivial: remove the number you added.

**Caster-current is the interesting one**, and it is a design tool rather than a default. It means
the buff is worth whatever the *caster* is worth, so building that Performer up is how they help
the team — and it means a Performer can be buffed and then pass that strength along, which is a
two-step combo assembled across turns. It also ages gracefully: a gift measured in the caster's
stats quietly stops mattering once the recipients out-scale them, which is exactly what a starting
Performer should do.

### Two clocks — do not conflate them

- **Effects apply immediately on resolution.** Otherwise "debuff, then attack" ordering does
  nothing, and that ordering is the entire point of the resolution queue (§2). A defense shred cast
  first *must* benefit an attack cast fourth.
- **Durations count in whole turns and expire at End Turn**, per above — never mid-resolution, so
  a buff cannot lapse between the second and third ability of the same plan.

Immediate effect, End-Turn expiry. Easy to conflate, painful to debug.

### Damage over time ticks at End Turn — SETTLED

The phase model (§2) answers what used to be an open question. If burn ticked at the **start** of
the afflicted side's turn it could kill an enemy *before it acts*, making damage-over-time a form
of action denial and far stronger than its damage suggests. Ticking at **End Turn** never denies
anything, so a DoT is worth exactly the damage it says.

That keeps action denial where it belongs — on statuses priced for it — instead of arriving as a
hidden second effect on every burn.

### Frost and freeze — BUILT

The first status, and the shape every one after it should follow.

**Frost is a stacking resource, not an effect.** It does nothing by itself. Stacks accumulate on a
creature, and when they reach that creature's threshold it **freezes**: the stacks are spent, the
threshold rises, and it loses its next action.

| | |
| --- | --- |
| first freeze | 3 stacks |
| second | 6 |
| third | 9 |
| decay | 1 per round, at the End Turn of the side that **carries** it |

**Why the stacks are consumed.** Without consumption the rising bar is decorative: after freezing at
3 you would still be holding 3, so the next freeze costs 3 more, and so does the one after. Spending
them is what makes 3 / 6 / 9 an escalation rather than three numbers.

**Why it decays.** Otherwise frost is a grenade — bank it to one below the bar on turn two and throw
it whenever a boss announces something frightening. Decay turns it into upkeep, so a frost team has
to keep paying to hold a target near the threshold.

**A stack survives exactly one of the carrier's own turns.** Decay runs at the End Turn of the side
holding the frost, not the side that applied it. The earlier rule ran it on the *applier's* End Turn,
which fired before the frosted side had acted at all — `startEnemyPhase` ends the player's turn and
then hands over — so frost the player applied was already one lower, and a single stack gone
entirely, by the time the enemy swung. Any one-stack-a-round source was therefore not weak but
**inert**: a Performer acts once a round and the decay cancelled it exactly, so the stack never
existed for anything to read. Rimeguard's frost-on-Maul was applying and losing the same stack every
round, and chill read a number the enemy no longer had.

The rate is one per round either way, so nothing about how fast frost accumulates changed. Only
whether the stack is alive for the turn it was meant to affect.

**One stack a round still nets zero — and that is a use, not a dead rider.** It cannot reach the
bar alone, but it now *holds* the target at one stack indefinitely, which is real: chill reads it
every enemy phase, and the target sits one step nearer the threshold for anyone else feeding it.
That is precisely the job a **wildcard** is for. A wildcard's value is spending dice that would
otherwise go unused, and converting a dead die into "the frost does not melt this round" is a
specific, worthwhile function for one — maintenance rather than construction. Accumulation still
needs more than one stack a round, or more than one Performer feeding it, which is the composition
goal enforcing itself. Application rates remain the balance lever:

| stacks applied per round | net | rounds to 1st freeze | to 2nd | to 3rd |
| --- | --- | --- | --- | --- |
| 2 | 1 | 3 | +6 | +9 |
| **3–4** | **2–3** | **1–2** | **+2–3** | **+3–5** |

Below about 3 a round, a frost team gets one freeze a fight and the escalation never matters.

**Frost does not stack on the frozen — it SHATTERS.** Stacks landing on a creature that is already
frozen bank nothing and deal **4 damage each** instead. A creature already out of an action cannot
be made more out of it, and letting frost accumulate on the helpless would make freezing something
the cheapest way to set up freezing it again. Nothing is lost by spending frost into it; it just
arrives as damage.

Flat and unmitigated, deliberately: no ATK, no damage type, no element, so nothing about the
attacker or the armour changes it. That also keeps it off the resistance wheel, which matters
because the one creature whose whole identity is rotating immunity is also freezable.

> **It fires within one turn, not across turns.** A freeze denies the phase that follows it and
> thaws at the end of that phase, so by the player's next turn the target is no longer frozen and
> frost banks normally — which is what keeps the 3 → decay 2 → 5 escalation intact. Shattering needs
> frost landing on an already-frozen target **inside one turn**: a second frost carrier, or a second
> cast. With Rebar the only source today that is rare; it becomes the common case the moment anything
> else applies frost.

**Freeze costs an ACTION, not a turn**, and that one word is load-bearing. Frost applied during the
player's turn cancels the enemy phase that follows, including a declared intent. Frost applied
*reactively* — Rebar's Frost Armor, landing while a creature is mid-swing — has already missed this
turn, so it takes the next one instead of being wasted. One rule, both directions, no special cases.

> **Reactive frost is worth less than proactive frost, and knowingly so.** A riposte stack lands
> mid-enemy-phase, after the attacker has already swung, and melts at the End Turn of that same
> phase — so the player cannot bank it and build on it next turn. There is no single decay point
> that serves both: the two application moments sit at opposite ends of the round. Fixing it
> properly means aging each stack individually rather than ticking globally, which is not worth the
> machinery until a second reactive source exists.

A frozen creature **declares no intent**, so the empty slot where an intent would be is the payoff:
the player sees the boss is out this round and spends the turn on something other than bracing.

**The freeze is held for the whole phase it denies, and thaws at that phase's End Turn.** It used to
be burned the moment the unit was reached — in `beginPhase` for the player, in the AI step loop for
enemies — and both worked while making the status nearly invisible: the chips winked out one at a
time as the enemy phase walked the line, so the single most dramatic thing in the game showed almost
nothing. The creature is now frozen from the instant the stacks max out, stays frozen for the entire
phase it is missing, and thaws when that phase is over.

**Exactly the same cost.** One action denied either way; only the visibility changed. Measured, the
frozen count over a round reads `0 → 5 → 0` as one block rather than counting down one by one, and
the enemy line takes **zero** actions in that round.

**Why uniform thresholds instead of per-enemy resistance.** A boss is as easy to freeze as a mob the
first time and progressively harder after. That puts the escalation in the fight's *shape* rather
than in a stat block, and it avoids the two bad answers to stun-lock — bosses immune (deletes a
playstyle) or bosses merely resistant (a bigger number, same conversation).

**Why not chance.** An earlier sketch had stacks granting a rising *chance* to freeze. That is the
one thing §2 forbids: randomness landing after the commit, on the plan's linchpin, with no other
line the player could have taken. It also would not have solved the problem — a 75% stun-lock still
stun-locks, it just occasionally reads as the game cheating. The limiter is cost and consumption,
which the player can see and plan against.

### Taunt and cover are two different things — TAUNT BUILT

They both protect somebody and they point opposite ways, which is why the roster wants both
eventually and why one character should not have both.

| | cast at | what it moves |
| --- | --- | --- |
| **Taunt** | an **enemy** | everything that creature does comes to the taunter |
| **Cover** | an **ally** | everything aimed at that ally is taken by the coverer |

So taunt answers "this creature is dangerous", and cover answers "this Performer is fragile". Cover
is also the one that can catch whole-side attacks, since it is defined by who is being aimed at
rather than by who is aiming.

**Taunt rewrites the declared intent.** Intents are chosen and shown before the player plans, so the
redirect happens on something already on screen and is visible before anything is committed — the
reveal stays honest and the turn stays plannable. No roll, no chance.

Three things it cannot do, all of them logged rather than swallowed:

- **Move a whole-side attack.** There is no named victim to move. This is the limit that stops one
  tank being the answer to everything, and it is why enemy kits want a mix of shapes.
- **Move a heal or a self-buff.** Pulling those onto the taunter is nonsense, not a benefit.
**A taunt is both a rewrite and a state.** It rewrites the intent on the board immediately, and it
records itself on the taunted creature (`Unit.taunt`) so it can outlive that intent. At the base one
turn the record does nothing — the rewrite is the whole effect — but `lastingTaunt` carries it into
the *next* declaration, where `chooseIntents` picks the taunter instead of rolling for a victim.
Same single-target restriction there as on the immediate redirect.

It **does** override reach, and that is the ability rather than a hole in the formation rules.
`range` is what a creature *chooses* to reach; a taunt is it being forced, so `Intent.forced` carries
the redirect past the depth check when the intent is re-validated at execution. A taunt that only
worked on creatures who could already hit the taunter would be little more than a way to pick which
front-row body eats the attack — pulling an attack off somebody the formation *cannot* protect is
the whole point, and it is what lets a party field two tanks without both of them queueing for the
same front-rank slot. A taunt onto someone who has since **died** still falls through to a fresh
choice: it overrides depth, not existence.

**Cover is still unbuilt**, and if it arrives it should be something a Performer *does* — an always-on
passive version was considered and rejected.

### Sleep — BUILT

Asleep until damaged. A unit that is asleep cannot be planned and loses its action; **any** damage
wakes it.

Self-inflicted, so far. That makes it a drawback that is nearly free exactly when its owner is doing
their job — a tank in the front rank gets woken almost immediately — and expensive only when nobody
wanted to hit them, which is when a tank had nothing to do anyway. A cost that scales itself with
how well the character is being used is worth more than a flat one.

### Chance-based effects, and the line to hold

Abilities may apply statuses on a chance, and triggers may improve those odds. But §2's rule stands:
**randomness must land before the commit, never after.**

A 50% paralyze put up as the answer to a telegraphed Judgment is a coin flip on the plan's linchpin,
resolved after the dice are already spent. There was no other line to play. Recommended split:

| kind | resolution |
| --- | --- |
| **Action-denying** — paralyze, stun, blind, silence, freeze | **deterministic**, priced expensively |
| **Riders** — burn, poison, bleed, stat shaves | **chance-based**, freely |

A failed burn is a small loss. A failed paralyze is a lost round.

**Alternative that keeps one system:** give enemies a **status resistance** value and abilities a
**status power**. The effect lands or it does not, and the player can see which *before* committing.
The trigger example survives — "raise burn chance 50% → 75%" becomes "+25 status power" — and it
becomes a composition axis with teeth, because a resistant boss then *requires* a Performer who can
push through. That is exactly the kind of demand that earns a 3★ a roster slot.

---

## 7. What this replaces, and what it costs

The current implementation (README §5) differs in almost every respect: abilities resolve one at a
time as the player clicks them, there is a single `defense` stat, there are no symbols, no statuses,
and enemies act on a priority list rather than a revealed intent.

Rough scope, largest first:

1. **Turn loop rewrite** in `battle.ts` — planning phase, ordered resolution queue, simultaneous
   enemy phase. Plus a new queue UI: assign, reorder, preview chains, commit.
2. **Damage model** — `computeDamage` in `combat.ts` splits by damage type; every stat block gains a
   second defense.
3. **Status system** — new, engine-side, with the two clocks of §6.
4. **Symbols and chains** — additive to the ability data model, but the resolution pass has to arm
   and fire them in order.
5. **Enemy intent** — pick-and-reveal replacing the current priority/cooldown selection.

`allocate.ts` deserves specific warning. `bestPlan` optimises dice→ability assignment assuming each
assignment's value is **independent**. Chains break that: the worth of giving one Performer a 4
depends on whether another also acts. Either keep the solver's job as "enumerate affordable sets"
and score chains one level up where the candidate count is small, or restrict chains to pairs to
keep the interaction term tractable.

### The whole roster is being redesigned

Every Performer's kit is being rebuilt against this document — damage types, symbols, and costs
authored deliberately against §2's payability table. **Do not preserve the current kits.** They were
authored for a system that is going away, and their balance data is not evidence about this one.

---

## 8. Performer kits

Authored one at a time against everything above. Numbers are the last thing decided, not the first.

### Benjamin — the Utility Vanguard

**Goal:** never sit out, and make whoever *is* acting hit harder. His value is multiplicative on
the team rather than additive to it.

He is the first Performer the player owns and the one the tutorial teaches with, so his kit has no
resource, no stacks, no positioning and no element — a plain physical attacker whose whole idea is
*buff, debuff, hit*. He is also designed to **fall off**, and to do it by mechanism rather than by
a later balance pass: see Rally.

| | cost | payable | dice | effect |
| --- | --- | --- | --- | --- |
| **Quick Cut** | wildcard | — | 1 | Physical damage, single target. |
| **Sunder** | 6 | 97.4% | 1.42 | Physical damage, **then** shred the target's Physical Defense, 3 turns. |
| **Rally** | 4 | 87.0% | 1.34 | Buff one ally's Attack/P.DEF/M.DEF by a % of **Benjamin's current** stats, 3 turns. |
| **Perfect Form** | 10 | 92.6% | 2.58 | Buff **his own** stats by a %, 3 turns, **then** deal large single-target physical damage. **2-turn cooldown.** |

**In-battle upgrades — survive, sustain, multiply.**

| | cost | passive | why |
| --- | --- | --- | --- |
| **Hold the Line** | 6 | `resilient 25` (~17% after the damage floor) | Two things ride on him standing: Rally is worth what *he* is worth, and Drillmaster's die is rebuilt each turn from who is alive. |
| **Trouper** | 8 | `regen 9` — ~1 HP a turn on an 11 HP bar | The show goes on. |
| **Full Company** | 12 | a **second die** in the shared pool | The capstone, and unique to him. |

They replaced lifesteal / frenzy / resilient, which were three ways of saying "Benjamin personally
fights better" on a Performer whose entire kit is about somebody else fighting better — the same
mismatch his innate passive had.

**What makes them his is a synergy that already existed and was never written down: the +10% stat
bonus every tier grants is already team-scaled for him alone**, because Rally copies his *current*
stats. Three tiers is +30% on every Rally for the rest of the fight. That is what leaves the passive
slot free to answer a different question — what keeps him able to keep doing it.

**Tier 1 is priced at 6 on purpose**: that is Sunder's cost, so the decision is exactly "Sunder this
turn, or make every future Rally bigger". And **Full Company is priced as a decision, not a gain** —
cost 12 spends ~2.6 dice plus his action and returns +0.50 dice a turn, so it pays back in about
five turns. Reaching it means buying the two below it first, so the full line is 26 dice and three
of his actions: four turns of the *whole party's* pool. It is only ever right in the fights that run
long, which are exactly the fights a sixth die matters in. All of it is gone at the final curtain.

**Chain triggers** sit on the two support abilities, never on the ult:

- **Sunder:** shred by an additional amount.
- **Rally:** buff the **whole team** instead of one ally.

That second one is the "convert to whole-team" trigger §4 warns is an order of magnitude above the
others — which is exactly why it is attached to a cost-4 ability with no damage on it, per that
section's own advice.

**Why the costs are what they are.** Three of his four options cost about one die, so he acts
nearly every turn without eating the pool; the ult is his only real commitment at 2.58 dice, where
somebody else sits out. Cost 6 is the most payable number on 5d6 (97.4%) and his signature ability
owns it: the thing that *is* Benjamin should always be affordable.

**Order inside the ult matters.** The self-buff is authored *before* the damage, so the strike
lands with the buff already up (§2). It is worded that way for the same reason: the phrasing is the
execution order.

**The rhythm.** Turn one Rally, turn two Sunder, turn three Perfect Form — and because a modifier
applied on a turn covers that turn and the two after it, turn four is spare before Rally needs
reapplying. Each Performer acts once per turn, so the loop is forced to be sequential; he cannot
front-load it, and the spare turn is where his dice go to somebody else.

The 2-turn cooldown on the ult sits inside that loop rather than fighting it: used on turn three,
locked out on four and five, ready again on six.

**Why Rally reads his current stats.** It is what makes flat stat investment in Benjamin pay out
across the whole team, it lets his ult feed his own buff a turn later, and it is his obsolescence
built in: a gift measured in Benjamin's stats is generous to a 3★ and a rounding error to a 5★. He
stops being worth a slot on his own, without anyone having to nerf him.

**Built with him.** Authoring this kit is what drove most of the remaining engine work in. Verified
in isolation: the ultimate's self-buff lands before its own strike; its cooldown blocks a recast;
Rally reads Benjamin's *current* attack rather than the recipient's, so it is worth more after the
ultimate; recasting Rally refreshes instead of stacking; Sunder shreds physical defense and
leaves the magical track untouched; and a 3-turn modifier covers the turn it was cast and the two
after it.

**What he still needs:** nothing. Chains landed, and both his triggers are live — Sunder deepens
its shred from -25% to -40%, Rally converts from one ally to the whole team.

> An earlier draft listed "an auto-battler that can price an enabler" here as a co-blocker, on the
> reasoning that AFK play would use him as a stick. **That was wrong on the facts.** Idle rewards
> are `ratesFor(stage) × elapsed` — no battle is simulated, and the accrual never reads the roster.
> The player-side planner (`bestPlan` via `nextDiceStep`) is not reachable from the game at all: the
> UI resolves the player's own queue through `commitNext`, and only ever calls `nextAiStep` during
> the enemy phase. `scoreAction`'s myopia is real, but it cannot reach Benjamin. See §1.

**Landed while building him:**

- Player-side cooldowns. `Unit.cooldowns` and its countdown were side-agnostic already, but only
  the enemy path set or checked them.
- Timed modifiers per §6, replacing the flat `atkBuff` / `defBuff` pair that decayed 10 a turn.
- Per-track defense modifiers. `defBuff` was one number added to both tracks.
- Percentage modifiers resolved against a named source (§6).
- Abilities as an ordered list of effects (§2) — his ult buffs *then* strikes.
- A real End Turn phase, with expiry at the end of the turn and regen and cooldowns at the start.
- Elementless attacks. `Ability.element` was required, so "no element" could not be said.

### Rebar — the Ice Wall

**Goal:** stand in the front rank and make the fight go worse for whoever hits him.

A tank in a game with no movement and no taunt does its job by **standing somewhere**. Enemy
`range: 1` reaches the party's frontmost occupied rank, so putting Rebar there is what makes
front-row attacks land on him instead of on the artillery. Everything in the kit assumes he is
there, and nothing in it has to be explained to a new player beyond "he is the one in front".

He is also the roster's introduction to statuses, the way Benjamin was its introduction to
modifiers.

| | cost | payable | effect |
| --- | --- | --- | --- |
| **Maul** | wildcard | — | Physical damage, **then** −10% of the target's ATK for 3 turns. |
| **Hibernate** | 2 | 70.4% | Heal himself **25% of his own max HP**, then sleep. |
| **Frost Armor** | 8 | 91.8% | +25% to both defences and **+50 Fire resistance** for 3 turns; while it lasts, physical attackers take 1 frost. |
| **Avalanche** | 12 | 89.9% | Magical ice damage to every enemy, **then** **3 frost** to every enemy. |

Stats: **HP 88, ATK 60, P.DEF 95, M.DEF 35.** Passive: **Winterhide** (below). The soft magical defence is deliberate — he is the
answer to a physical front-row attacker, not to everything, which is the whole reason to want a
second tank alongside him.

**Winterhide — his passive. Frosted enemies deal 4% less damage per stack, capped at five.**

A *defensive* payoff for an *offensive* action: the way he tanks is by spending dice on frost, which
is what he was already doing. It replaced `thorns 15`, which his own second upgrade tier already
restated at 30 — his identity written twice in the same number.

**It also gives frost a job below the bar.** Sub-threshold stacks used to do literally nothing: two
frost on a creature was worth exactly zero until it became three, so applying frost on a turn that
could not reach the threshold was a wasted die. Every stack now pays on the way up.

**The ceiling is only reachable after the first freeze**, and that is the whole curve. The bar starts
at 3, so holding five stacks is impossible until freezing once raises it to 6:

| | max stacks holdable | reduction |
| --- | --- | --- |
| before the first freeze | 2 | 8% |
| after it (bar 6) | 5 | **20%** |

Measured delivery is **exactly 20.0%** at five stacks, 4.0% per stack on the way up, and the cap
holds (six stacks also reads 20.0%). It briefly delivered only ~14% — the `max(1, …)` damage floor
was eating the rest — which is what prompted the ×4 rescale of HP and ATK; at an average hit of 13
rather than 2.8 the floor catches nothing and the number means what it says.

It is **an aura, and the first passive that reads the other side** — `computeDamage` had to be told
who is defending, because the reduction is owned by a third unit that is neither dealing nor taking
the hit. Verified: with Rebar down, damage into the party returns to *precisely* the un-frosted
baseline.

**Deliberately not an intercept, a redirect or a cover.** He is a wall, and his weakness is that he
cannot put himself between an attack and an ally — he is strong exactly as long as he is the one
being hit. Winterhide softens the whole enemy line rather than shielding anyone, which keeps that
weakness intact.

> Note it does nothing for **Rebar himself**: at P.DEF 95 he is already taking the floor of 1 from
> most things, and no percentage can bite into that. The passive is worth the most to the squishiest
> Performer on the board, which is a pleasing inversion for a tank's passive.

**Maul is the quiet best thing in the kit.** An ATK shred protects the entire party, not just him,
and it works on turns he is not the one being hit. Tanking that helps while you are ignored is rarer
than tanking that helps while you are focused.

**Hibernate's drawback pays for itself.** See §6 — sleep is cheap precisely when he is doing his
job. Cost 2 is also, deliberately, one of the least reliable numbers on 5d6 (70.4% against 97.4% at
six): a heal you reach for when you are hurt should not be something you can plan around every turn.

**It heals off MAX HP, not ATK — the only heal in the game that does.** Every other heal scales off
the caster's attack, and the rule behind that is about *support*: a healer whose output is gated by
the same stat as their damage cannot out-damage the blades. That rule does not apply to a tank
healing himself. Rebar has the lowest ATK on the roster **precisely because he is a tank**, so
scaling his survival off it gated him on the stat he is deliberately worst at.

`maxHp` also rewards the investment he actually wants (Thick Pelt, Vigour) and is **scale-free**: a
percentage of a bar needs no damage constant and cannot go stale in a rescale. Measured, it is
exactly 25% at levels 1, 20, 40 and 80.

> **`do: 'heal'` now takes `of: 'attack' | 'maxHp'`**, defaulting to attack. A source selector rather
> than a special case, mirroring how `modify` names what its percentage is a percentage of.

**Frost Armor is the fight-specific button** — the tank you bring against a fire damage dealer, and
dead weight against anyone else. That narrowness is the point; it is the FFBE texture where a fight
demands a particular defensive answer rather than a generically bigger one. Ice resisting fire also
lands on the existing wheel rather than fighting it, since water already beats fire.

**Avalanche's value is the frost, not the damage.** He has the lowest ATK on the roster, so a
3-dice nuke off it would be poor. **Three stacks on every enemy at once** is the whole ability:
against a fresh line that is the first freeze on all five in one action, and that is the intended
reading rather than an accident to be tuned away. Pricing it as a nuke was never going to work;
pricing it as the only mass action-denial in the game does.

**It gets dearer exactly as fast as it should**, because the threshold rises *and* stacks decay, and
the two compound. Measured against one enemy, casting it every turn:

| cast | result |
| --- | --- |
| 1 | 3/3 → **FREEZE**, bar becomes 6 |
| 2 | 3/6 (decays to 2) |
| 3 | 5/6 (decays to 4) |
| 4 | 7/6 → **FREEZE**, bar becomes 9 |
| 7 | freeze #3 |

**The first freeze is one cast; the second is four** — 48 dice-worth and four of his turns against 12
and one. Decay is what makes it steeper than the bare 3/6/9 ratio suggests: every round between
casts eats a stack. That curve is the reason it can be this strong, and ultimate cooldowns are
planned to price it again on top.

**Verified in isolation:** the ATK shred lands and is keyed to Maul; Frost Armor raises both
defences and takes Fire resistance 25 → 75; frost accrues 1/3 → 2/3 → freeze, spending the stacks
and moving the bar to 6; a frozen enemy declares no intent and loses exactly one action; Hibernate
heals, sleeps, and refuses to be planned while asleep; damage wakes him.

**In-battle upgrades — switch it on, endure it, deepen it.**

| | cost | effect |
| --- | --- | --- |
| **Rimeguard** | 6 | Reactive guards last **2 turns longer**; while one is up his attacks apply **1 frost**, and the guard applies **1 extra** frost when struck. |
| **Deep Sleep** | 8 | **50% less damage while asleep.** |
| **Glacier** | 12 | Winterhide's cap rises **5 → 10 stacks**: 20% to **40%**. |

They replaced `resilient 16 / thorns 30 / regen 8` — three generic numbers that said nothing about
him, two of which his own star tree already restated at ★3.

**Every one leans on something he has to DO.** Rimeguard is worth nothing until Frost Armor is up,
Deep Sleep nothing until he Hibernates, Glacier nothing until frost is on the board. A tank's tiers
should reward playing the tank rather than hand him a bigger number for standing still.

Three implementation notes worth keeping:

- **Rimeguard is keyed to the RIPOSTE, not to the name "Frost Armor".** `Modifier.riposte` exists
  precisely so no code has to know that string, and *"while he is carrying a reactive guard"* means
  the same thing today while staying true of the next guard he is given. The duration bonus applies
  only to modifiers that carry a riposte, so it does not quietly stretch Maul's shred as well.
- **The frost-on-hit half is conditional on purpose.** Frost flowing from every swing would make him
  an engine that never has to think; gating it on the guard being up means he spends the action to
  switch it on. Measured, the riposte hands out exactly double: **85 → 170 frost** over 40 enemy
  phases.
- **Glacier replaces the cap rather than stacking with it**, because chill auras take the DEEPEST
  source rather than summing (`reductionPercent`). Summing would give 20% + 40% = 60% from one
  character. Measured: 18% at five stacks with or without it, **36% at ten** with.

> **Deep Sleep halves exactly one hit**, and that is the honest description. Any damage wakes a
> sleeper and the blow is measured before the waking, so the value is in choosing WHICH hit —
> Hibernate in front of a telegraphed swing and the reduction lands on it. It is written as a
> condition on *sleep* rather than baked into Hibernate so it still pays the day something else puts
> him under. Delivers 46% against a heavily-mitigated 4-damage hit; closer to 50 on bigger ones.

**Chain triggers — one on each of the three, none on the basic.**

| | symbol | trigger |
| --- | --- | --- |
| **Maul** | `lantern` | *none* — a carrier only |
| **Hibernate** | `thorn` | also grants him **regen for 2 turns** |
| **Frost Armor** | `thorn` | the guard **answers magic** as well as steel |
| **Avalanche** | `lantern` | **half again as hard**, and a **fourth frost** |

**Maul carries a symbol and no trigger on purpose.** Every wildcard should carry one, so that no
turn is ever dead for chaining and a basic arming for somebody else is the cheapest possible way to
pay into a chain.

**Frost Armor's is the one that matters most.** His M.DEF is 35 against P.DEF 95 *by design* — he
answers a physical front-row attacker, not everything, which is the whole reason to want a second
tank beside him. The chain closes that hole for one round: a **conditional** answer the team sets
up, never a permanent one. Measured: 6 frost from 60 magical hits unchained, **60 from 60** chained.

> **He can never chain with himself.** One action per round, enforced by `isPlanned`, so every one
> of these fires only when a *teammate* played the symbol earlier in the round. That is the
> "completes other people's chains" role stated in mechanics rather than in prose:
>
> | symbol | armed by | completes |
> | --- | --- | --- |
> | `lantern` | Benjamin — Rally, Perfect Form | **Avalanche** |
> | `thorn` | Aethis — Thornlash, Poultice | **Hibernate, Frost Armor** |

**Regen is a COUNT, not a duration**, and Hibernate's trigger is why. A status applied mid-turn has
already missed that turn's Start, so a 2-turn clock counted down at End Turn leaves exactly **one**
tick — the number on the sheet would be lying. `Statuses.regen` holds *heals owed* and spends one
where it fires, the same shape `frozen` already uses for actions owed, so "2 turns" is two heals
whenever it lands. Verified: 2 charges, two heals of 9, then nothing.

> That keeps the two clocks of §6 apart rather than conflating them: **`Modifier` is the thing with
> a duration; `Statuses` are counters.** Tick effects belong on the counter side.

`ChainTrigger` gained `empower` (damage power) and `deepen` (frost stacks) alongside the existing
`amplify` (modifier percent) — three knobs of one shape, each making what the ability already does
bigger rather than appending a second event that reads as two hits in the log.

**What he still needs:** enemies worth being a tank against — see §9.

### Maxine — the Frost Artillery

**Goal:** turn the cold somebody else put on the board into damage.

Frost was authored as *"a shared resource rather than one character's private counter"* — Rebar
builds it and spends it on control, and the counter was always waiting for a second reader to do
something else with it. Maxine is that reader, and the first Performer whose damage is a function of
the board state rather than of her own sheet.

| | cost | effect | symbol |
| --- | --- | --- | --- |
| **Frostbolt** | wildcard | 100% ATK, **any target**, then 1 frost. | crescent |
| **Blizzard** | 3 | 60% ATK to the whole line, then 1 frost to all. | crescent — *chained:* a second frost to every enemy |
| **Glacial Lance** | 7 | 150% ATK, **200% against a frozen target**. | tide — *chained:* strikes 30% harder |
| **Deep Cold** | 10 | 100% ATK to the whole line, **+25% per frost stack on each**. | tide — *chained:* 35% per stack instead of 25% |
| *Killing Frost* | passive | +10% damage to frosted enemies, +20% to frozen. | |

**The counter is the rules text.** Freezing SPENDS the stacks, so Deep Cold pays its minimum against
exactly the targets Glacial Lance pays its maximum against. Frosted, cast Deep Cold; frozen, cast
the Lance. Nothing explains that — the number above the creature's head does, and she holds one
single-target and one area option on each side of the line.

**Stacks are read, never spent.** An ability that consumed them would compete with the control half
of the frost engine for the same resource, and two Performers quietly cancelling each other is the
worst kind of interaction because nothing on either sheet admits it is happening.

**Her ceiling rises with the fight rather than with the level.** The freeze bar escalates, so a
creature can hold `3 × (freezes + 1) − 1` stacks before spending them: Deep Cold's reachable bonus is
+50% before a creature's first freeze, +125% before its second, +200% before its third. The control
half of the team doing its job is what raises it.

> A consequence worth authoring around: **Rebar's first Avalanche cannot set Deep Cold up**, because
> its 3 stacks *are* the first threshold — it freezes and spends them. The second banks, the bar now
> being 6. So his ultimate alternates between **freezing** (the turn for the Lance) and **loading**
> (the turn for Deep Cold) — rhythm neither sheet states and both produce.

**She is deliberately not self-sufficient, and that is the design rather than a gap.** Her appliers
resolve `[damage, then frost]`, and decay clears the stack before her next turn, so nothing she does
sets up her own bonuses: Killing Frost and the Lance's 200% pay out only on a *teammate's* frost.
Reordering her effects would hand her a permanent flat buff and quietly make owning Rebar matter
less. She is a damage dealer you **build around** — strong, and not complete alone.

**And her chains want a partner who is not Rebar.** He carries `lantern` and `thorn`; her `crescent`
comes from Kael or Veyra and her `tide` from Aethis. Fully powered she wants a three-character core.
Giving every ice character one shared symbol would have made the composition puzzle trivial.

**Her upgrade tiers ramp on purpose** — cheap and unremarkable, then nice to have, then the one worth
saving for. Upgrades cost dice *and* a turn, so the question should always be which Performer
deserves the investment; a tier list that opens with its best card never asks it.

| | cost | effect |
| --- | --- | --- |
| **Deepening Chill** | 6 | A second `exploitCold`, stacking the passive to +20% / +30%. |
| **Frostfever** | 8 | +5% ATK per frost stack landed on the enemy, for the rest of the turn. |
| **Glacier Sight** | 12 | Whenever an enemy freezes, the next Glacial Lance costs any single die. |

Frostfever is counted **per stack**, which is what makes it a team payoff: her own basic is worth
+5%, while Rebar's Avalanche across five creatures is worth +75%. It only reaches abilities resolved
*after* the frost, so under commit-and-lock it is bought with turn ORDER rather than with dice — and
since a Performer acts once a round, nothing she applies can pay for her own cast.

Glacier Sight adds no damage; it removes the reason she could not afford to deal it. Her most
expensive single-target hit is free on exactly the turn the board makes it worth 200%. Measured with
all three tiers and Rebar opening on Avalanche: Glacial Lance goes 46 → **150** and costs one die.

**What she introduced to the engine:** conditional power (`versus`), power that scales off a status
counter (`perFrost`), the target-state twin of `frenzy` (`exploitCold`), a passive that fires on the
ACT of applying a status (`frostFervor`), and a charge that changes what an ability costs
(`freeCastOnFreeze`). `ChainTrigger` gained `sharpen`. All the damage-side pieces resolve inside
`computeDamage`, so the forecast shows them before dice are committed.

**What she still needs:** a star tree — hers, like every revamped character's, is placeholder
content being redone as a batch.

### Kael — the Provoker

**Goal:** choose to be the target, and get paid for it.

The roster's second tank, and deliberately nothing like the first. Rebar tanks by standing in the
front rank and denying actions; Kael tanks by *pulling* one creature's attacks onto himself. They
answer different threats — Rebar answers "they attack the front row", Kael answers "they are going
for the healer", which is the case positioning cannot solve.

A 3★, so none of it is extravagant: middling bulk, middling damage, and a loop that pays nothing
unless he is actually being attacked.

```
HP 52   ATK 96   P.DEF 68   M.DEF 44
```

| | cost | payable | effect |
| --- | --- | --- | --- |
| **Cleave** | wildcard | — | 50% physical to the **whole enemy line**. |
| **Disarm** | 2 | 70.4% | 70% physical, **then** −25% of the target's ATK for 3 turns. |
| **Challenge** | 5 | 92.2% | Taunt one enemy. No damage, no self-buff. |
| **Reckoning** | 9 | 90.7% | 200% physical, single target. |

**Cleave is an AoE basic, and the numbers say that is fine.** One die buys 15 damage across five
creatures — comparable to Maxine's Frostbolt at 14 — but hers lands on one target and takes half a
28 HP bar, while his is 3 apiece and kills nothing. Comparable output, opposite use, which is the
shape §4 asks conversions to take. Against the stage-10 boss line of three it drops to **6 total**,
worse than Benjamin's basic: strong in the corridor, weak at the gate.

**Reckoning is priced at 9 rather than 11.** At 11 it was dominated outright — 2.80 dice for 14
damage after a full round of tanking, against Benjamin's Perfect Form at 2.58 dice for 15 *plus* a
self-buff on the way in. A conditional payoff that never catches up with an unconditional one is not
a trade. Nine is 2.41 dice and uncontested, which fixes it without inflating the number.

**Passive — Grudge: +5% attack for his next turn, per hit taken.** This is the engine of the kit and
the reason Challenge carries no buff of its own. A Performer acts once a round, so the two halves of
him compete: **taunt and be hit, or spend what the last taunt earned.** That is the decision every
turn.

It counts **hits, not damage**, which matters twice. It means pulling a five-creature volley pays
five times, and it means Disarm and Grudge do not fight — weakening an attacker lowers what the hit
costs him without lowering what it earns.

It replaced `frenzy 20`. Frenzy had the right instinct and the wrong trigger: it only pays below
half health, so for a tank it pays when he is about to die rather than when he is doing his job.

**Challenge sits on 5** (92.2% payable, ~1.39 dice) because it is his job. An answer to a threat you
can already see has to be affordable on the turn you see it; the fragile low costs are right for a
gamble and wrong for this. **Disarm sits on 2** (70.4%) for the opposite reason — it is the turn he
can still do something useful when he cannot afford anything else.

**No self-buff on Challenge**, deliberately. Protecting somebody has to cost something, and here the
cost is that he spends his turn doing it and then stands in the way of everything that creature
does. The growth went into the chain trigger, which braces him for the round.

**In-battle upgrades — survive it, make it cost less, make it hurt more.**

| | cost | passive | |
| --- | --- | --- | --- |
| **Ironhide** | 6 | `resilient 20` | Flat and unconditional, so it works on the turn he is caught without a taunt up — the turn he is most likely to die on. |
| **Dig In** | 8 | `grudgeArmor 10`, cap 5 | 10% less damage per hit already taken this turn. |
| **Standing Challenge** | 12 | `lastingTaunt 1` | His taunts hold for a **second** round. |

**Dig In is the answer to what taunting invites** — a creature's whole volley arriving at one body.
Each hit makes the next cheaper, so focusing him has **diminishing** returns rather than linear
ones: measured across a five-hit volley the same attack lands for **4, 3, 3, 2, 2**. Five attacks on
one body are worth visibly less than five spread around, and the better he does his job the less the
job costs. Capped at 5 stacks, which a standard encounter's full volley reaches exactly.

It is also, notably, a defensive number that **does** move at current scales, where Challenge's
brace does not — because it reaches 50% rather than 30%, which is enough to shift a rounded
integer. That is the size a defensive effect has to be right now to be felt at all.

**Standing Challenge is the capstone because it changes what he can do, not how long he survives.**
A base taunt is spent the moment it lands — it rewrites the intent already on the board and nothing
more — so holding a creature costs his action *every* round, and he never gets to spend the attack
the last round earned him. A second turn is the breathing room: taunt, absorb, then swing while the
taunt is still holding. Verified: without it a provoked creature declares against Kael on round one
and against Rebar on round two; with it, Kael on both, and Rebar on round three.

**No lifesteal anywhere on him, deliberately.** A tank who tops himself up does not need anybody,
and the whole reason to field Kael is that he turns an unanswerable threat into one a healer can
answer. Removing his self-sustain is what makes the rest of the team matter.

**`Unit.grudge` counts hits taken for every unit**, not only for those carrying a passive that reads
it — the same shared-number shape frost has. `grudge` pays it out as attack next turn,
`grudgeArmor` as damage reduction within this one, and it resets at the owner's End Turn alongside
the buff it feeds.

**Chains.** He carries `anvil` with Benjamin (and Brax) and `crescent` with Maxine (and Veyra), so
both of his marks have a live partner.

| | symbol | trigger |
| --- | --- | --- |
| Cleave | anvil | — arms only |
| **Disarm** | anvil | the shred bites deeper, −25% → −40% |
| **Challenge** | crescent | he braces, +30% to both defences for the round |
| **Reckoning** | crescent | +30% of ATK as extra damage |

**He can never chain with himself.** A Performer acts once a round, so every one of his triggers
fires off a *teammate* arming the mark earlier in the turn. That is the mechanic working as designed
— chaining costs breadth, because two Performers commit dice to the same symbol — and it is worth
stating because a kit reads as though its own two carriers combine.

**Both crescent abilities carry a trigger**, and that is the interesting part of his chains: a
teammate arming crescent hands Kael a *choice* rather than an instruction. Brace behind Challenge,
or hit harder with Reckoning — same arming, opposite answers. §4's "whose trigger do I want to fire"
expressed as "which of mine".

Reckoning's is §4's own worked example to the decimal: a 2.0 ability taken to 2.3. It exists so his
ultimate can join a chain at all — it was the only finished kit's ultimate that could not.

> **Measured, and one of them cannot currently be tuned.** Challenge's brace saves 5 damage over a
> five-hit volley. Raising it does nothing: at +30%, +40%, +50% and +60% the saving is *identical*,
> because a 5-damage hit rounds to 4 at every one of them. Defensive percentages quantise hard at
> current enemy damage, so the number is left where it is proportionally correct rather than
> inflated to chase an effect the scale cannot express. This is the same wall as README §9's
> "defence is not yet distinguishing anyone", and it moves when enemy kits do.

**Verified:** a declared intent on another Performer redirects to Kael and executes there; five
attacks pulled onto him produce exactly five Grudge stacks (+25 on a base 96); the buff survives the
enemy phase, is spendable on his next turn, and expires at the end of it; and taunt refuses — with a
reason in the log — against a whole-side ability, a non-attack, a creature with nothing declared,
and one that could not reach him; and both crescent chains fire off Maxine's Frostbolt, with
Reckoning landing 10 + 2 chained against 10 alone.

**What he still needs:** nothing mechanical. His star tree is placeholder like everyone else's.

---

## 9. Settled, and still open

**Settled:**

- Composition beats stars, enforced by the §1 invariant
- **No auto-battle and no skip** — every stage is played by hand (§1)
- **The base pool is 5d6, and a sixth die is a CHARACTER, not a rule** (§2). Benjamin contributes
  one while he lives; his third upgrade tier contributes a second. Face values are not the balance
  lever — **blanks are** — because a wildcard costs any single die whatever its value.
- **The pool is mutable** — `Die[]` with ids, not `number[]`. Abilities that add, remove or change
  dice have a surface to be written against (README §5.1). "Double a chosen die this round" is the
  shape this was built for.
- **Bosses escalate, ordinary mobs do not.** A linear damage ramp past a grace period, shown on the
  creature (README §5.3). Mitigation is a fraction and scales with it; healing is flat and does not.
- **Armour is measured against the attacker: `ATK / (ATK + DEF)`, no constant.** Equal stats halve
  the blow; DEF twice their ATK quarters it. That is what makes a defensive stat readable against an
  offensive one, which a fixed anchor never did. It is also level-invariant *structurally* -- both
  sides carry the same scale and it divides out -- where the anchor had to be fed `powerScale` to
  fake the same property.
- **Do not go subtractive.** `ATK × k − DEF` scales fine at equal levels and falls off a cliff at
  unequal stats: measured on this roster, a tank with DEF 20 against an ATK 10 attacker takes
  exactly **zero**, and no coefficient fixes both ends.
- **Stats are in tenths of a damage point**, so a sheet reads whole numbers while a hit lands for 13
  on a ~50 HP bar (README §5.2). **DEF cannot be moved onto a ~10 scale**: at DEF 4, a +12% star node
  rounds to **nothing**, which is the exact bug the tenths scale was introduced to fix. Readability
  had to come from the formula, not from smaller numbers.
- **The damage floor is a fraction of the unmitigated blow** (5%), not a flat 1 -- equivalently, a
  cap saying stacked mitigation may never absorb more than 95%. A flat floor is a scale-dependent
  constant and stops meaning anything as levels climb; the fraction holds at any scale, which is what
  keeps the weakest hit in the game a readable ~2.5% of a tank's HP rather than a rounding error.
- **Any bare number compared against damage or a stat must move with `powerScale`.** Four have been
  found by accident so far: `SHATTER_PER_STACK`, `scoreUpgrade`'s flat term, the legacy flat buff on
  War Cry, and the damage floor itself. Prefer a fraction, a percentage, or a multiple of ATK. **The scale has a floor below which the design stops working**: at
  ~12 HP the average hit was 2.8 and a quarter of all damage landed on the `max(1, …)` clamp, which
  silently ate every percentage effect in the game. A percentage is only worth what the number it
  multiplies can resolve.
- **A percentage of a small integer has to be banked**, not rounded (`Unit.carry`). Regen, thorns,
  lifesteal, resilient and `chill` all do. Author new percentage effects the same way, or they will
  silently do nothing. Banking fixes the *cliff*; only a big enough scale fixes the *shortfall*, and
  both were needed.
- Commit-and-lock, no stop-and-rethink, no mid-turn reaction
- Chain triggers are authored per ability, and read forward from the arming symbol
- Every turn is Start / Resolve / End; the bookends are simultaneous for the whole side (§2)
- An ability is an ordered list of effects, and is worded in that order
- A duration applied this turn ticks at the end of this turn; damage over time ticks at End Turn
- Modifiers refresh within an ability and stack across abilities, resolved to a flat amount at
  cast time from a named source (§6)
- Enemy intent is revealed each round; activation odds stay hidden
- **Positioning is a team-building axis, and the party is a 3x3 grid.** Nine slots for five, with
  BOTH axes mechanical: columns are rank (enemy `range` reads the party's frontmost *occupied* one,
  so hiding everyone in the back just makes the back the front), and rows are what `scope: 'row'`
  and `scope: 'column'` cut along. The two pull against each other -- the column that keeps you out
  of reach is the column a column-attack cuts through -- and that tension is the formation puzzle.
  A tank is valuable for standing somewhere before it has a single tank ability.
- **Repositioning is a wildcard action everyone has**, not a kit ability: any single die plus the
  Performer's action, the same price as their basic. Moving is *the attack you did not make*. It
  swaps with any occupant so it can never fizzle under commit-and-lock, and it carries no symbol --
  the cheapest action in the game must not also be the best chain opener.
- **One step, orthogonally.** Centre slots offer four moves, edges three, corners two. Free
  placement made the grid a menu -- anyone anywhere every turn, so the formation had no state worth
  defending. The diagonal is excluded specifically: it crosses a rank AND a file for one die, which
  changes both "who can reach me" and "what line catches me" at once.
- **Enemies keep a fixed block and do not move.** Only the party is a grid. The two sides share one
  positional *language* (`row` and `column` work on either) without sharing a layout, which is what
  lets a boss encounter be a different shape from a corridor one.
- **Frost stacks are a shared resource** (§6), not one character's counter. Rebar builds and spends
  them on control; other Performers are meant to read the same number and do something else with
  it — damage on freeze, or a shred per stack.
- **Action-denial is deterministic and visible.** Frost shows its count and its threshold, so
  freezing is a decision made before the dice are spent rather than a roll after.

**Open, and in priority order:**

1. **Enemy kits.** Every mechanic built recently needs enemies worth using it on. Mobs have one
   ability each; nothing checks a tank, nothing punishes a formation, nothing is worth freezing.
   This is now the bottleneck on *everything* — see §9's note on what front-row attacks are for.
2. **Party / lineup management.** In-battle repositioning covers the positional half now, so what
   is left is the *pre-battle* screen: which five perform, and their starting arrangement. Rebar
   stands in front because he was moved to second in a list.
3. **The remaining three kits** — Kael, Aethis, Brax. Benjamin, Rebar and Maxine are done. Shapes
   that exist now and did not when the rest were written: a passive can change the **pool** rather
   than a stat (`extraDie`), can be a **reactive rider** (`riposte`), can read the **target's state**
   (`exploitCold`) or the **act of applying a status** (`frostFervor`); an ability's power can be
   conditional (`versus`) or scale off a counter (`perFrost`); and an upgrade tier can grant a
   **charge that changes what an ability costs** (`freeCastOnFreeze`). Note their tiers' +10% stat
   bonus is genuine filler — only Benjamin converts personal stats into team stats — so their
   passives have to carry them.
   > **Frost has its two readers and wants no more.** Rebar builds it, Maxine converts it. A third
   > would make the frost team the answer to everything; these three should each claim their own.
4. **Redo every star tree.** All of them predate the kit rewrites and several reference mechanics
   their character no longer has. Being done as a batch once the kits above are settled.

**Smaller, and unordered:**

- **More statuses** — paralyze, burn and friends. Frost, freeze and sleep are built and are the
  shape to copy (§6); nothing structural is missing, so each new one is content.
- Whether revealed intent can be disrupted (§5)
- Whether action-denying statuses are deterministic or chance-based (§6 — a recommendation, not a
  decision)
- The symbol list itself, and which Performers carry which
- Whether 3-chains escalate beyond pairs, and what that does to `allocate.ts`
