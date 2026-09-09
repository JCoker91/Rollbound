# Battle Design — the target system

**Status: in build.** This document specifies the battle the game is being rebuilt towards.
`src/engine/battle.ts` still implements the older system (see README §5) except where noted below.

| § | piece | state |
| --- | --- | --- |
| 5 | Enemy intent — weighted pick, revealed target | **built** |
| 2 | Turn loop — planning queue, commit-and-lock, ordered resolution | **built** |
| 2 | Enemy phase strictly simultaneous (currently sequential within one phase) | not built |
| 3 | Damage types, split defenses | not built |
| 6 | Status effects | not built |
| 4 | Symbols and chains | not built |

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

---

## 2. Turn structure — MOSTLY BUILT

One round, in order:

1. **Roll** the shared dice pool. The player sees the dice before planning.
2. **Reveal enemy intent** — for every living enemy, which ability it will use and on whom.
3. **Player plans.** Assign abilities to Performers, paying exact dice sums, and place them in a
   resolution order.
4. **Commit.** The plan locks. There is no stopping partway, no reacting to a result, no re-planning.
5. **Player abilities resolve** one at a time, in the assigned order.
6. **Enemies act simultaneously**, using the intents revealed in step 2.
7. Statuses expire, durations tick. Next round.

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

**5d6 for now.** 6d6 is worth testing, but the choice is not about feel — it is about how large the
biggest ability costs get:

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

Two facts to author costs against:

- **Sweet spots: 6 (97.4%), 10 (92.6%), 5 (92.2%), 8 (91.8%).**
- **Costs 1 (59.8%) and 2 (70.4%) are genuinely unreliable** — good as a drawback on a strong kit,
  bad as cheap filler.
- **Low costs collide.** A team whose abilities all cost 1–3 gets only 2.61 actions from 5d6, barely
  more than a team costing 5–11 at 1.92. Five characters wanting small exact sums fight over the
  same small dice. Cost *spread* is a composition axis for free.

---

## 3. Damage types and elements

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

### Elements

Not every Performer deals elemental damage. Enemies may be weak to an element and resistant to
another.

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

## 4. Symbols and chains

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

## 6. Status effects

### Duration

A status lasts **exactly one of the opponent's action phases.** "Blind for 1 turn" applied during
the player's turn is active through the enemies' next phase and gone when the player's turn comes
round again. The mirror holds for enemy-applied statuses. Multi-turn durations span that many
opponent phases.

### Two clocks — do not conflate them

- **Effects apply immediately on resolution.** Otherwise "debuff, then attack" ordering does
  nothing, and that ordering is the entire point of the resolution queue (§2). A defense shred cast
  first *must* benefit an attack cast fourth.
- **Durations count in opponent phases**, per above.

Immediate effect, phase-counted expiry. Easy to conflate, painful to debug.

### Damage over time: decide when it ticks

If burn ticks at the **start of the afflicted side's phase**, a burn can kill an enemy *before it
acts* — making damage-over-time a form of action denial, far stronger than its damage suggests. If
it ticks at **end of round**, it never denies anything. Both are defensible and they are very
different power levels. Pick one on purpose.

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

## 8. Settled, and still open

**Settled:**

- Composition beats stars, enforced by the §1 invariant
- 5d6 for now; the trade for 6d6 is understood (§2)
- Commit-and-lock, no stop-and-rethink, no mid-turn reaction
- Chain triggers are authored per ability, and read forward from the arming symbol
- Statuses last one opponent phase; effects apply immediately
- Enemy intent is revealed each round; activation odds stay hidden

**Open:**

- Whether revealed intent can be disrupted (§5)
- When damage over time ticks (§6)
- Whether action-denying statuses are deterministic or chance-based (§6 — a recommendation, not a
  decision)
- The symbol list itself, and which Performers carry which
- Whether 3-chains escalate beyond pairs, and what that does to `allocate.ts`
