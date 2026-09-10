import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  createBattle,
  ENEMY_DIE,
  planAction,
  planUpgrade,
  commitNext,
  movePlanned,
  unplan,
  isPlanned,
  type PlannedAction,
  commitUpgrade,
  startEnemyPhase,
  finishEnemyPhase,
  nextAiStep,
  livingOf,
  MAX_TURNS,
  type BattleState,
} from '../engine/battle.ts';
import { BOSS_EVERY, ROSTER, sceneFor } from '../engine/content.ts';
import { useDevTools } from './dev.ts';
import { applyLevel, levelOf, MAX_LEVEL } from '../engine/levels.ts';
import { payingMasks } from '../engine/allocate.ts';
import {
  activePassives,
  canTarget,
  computeDamage,
  effectiveDefense,
  modifierTotal,
  damageTypeOf,
  statScale,
  unitAttack,
  unitMaxHp,
  unitsHit,
} from '../engine/combat.ts';
import {
  describeAbility,
  describeCost,
  describeElement,
  describeEnemyUsage,
  describePassive,
} from '../engine/describe.ts';
import { columnRank, type Slot } from '../engine/formation.ts';
import { actionLine, floaterClass, type Floater } from './narrate.ts';
import {
  ROLE_LABEL,
  alive,
  type Ability,
  type CharacterDef,
  type Element,
  type Pos,
  type SpriteSheet,
  type Unit,
} from '../engine/types.ts';
import { Avatar, themeOf } from './Avatar.tsx';
import { crispCss } from './crisp.ts';
import {
  clipAnimName,
  clipBox,
  clipDuration,
  clipTimeline,
  keyframesFor,
  orderFor,
  stepMsFor,
  placementFor,
  tuningFor,
} from './clipAnimation.ts';

const ELEMENT_COLOR: Record<Element, string> = {
  fire: '#ff7a5c',
  wind: '#7ce8a4',
  earth: '#c8a06a',
  lightning: '#ffd42a',
  water: '#4aa6ef',
  light: '#f0d878',
  dark: '#a77fd6',
};

/**
 * Every element a character can actually deal, in kit order.
 *
 * Replaces the single element tag. It is strictly more informative -- a
 * Performer with fire and water abilities now says so instead of being filed
 * under one of them -- and it maintains itself as kits change.
 */
const elementsOf = (def: CharacterDef): string[] => {
  const found = new Set(
    def.abilities.filter((a) => a.kind === 'attack').map((a) => a.element).filter(Boolean),
  );
  // An attacker with no elemental abilities at all is not "neutral" -- there is
  // simply no elemental line to draw for them, and saying so beats an empty gap
  // where every other Performer has a word.
  return found.size > 0 ? ([...found] as string[]) : ['physical'];
};

const DIE_PIPS = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

/**
 * How tall one "slot" is as a fraction of the stage, before a sprite's own scale
 * is applied. This is the single knob for how big everyone is on the battlefield
 * -- `UnitChip` derives sprite height from it exactly as the old tile grid did,
 * so the roster's relative statures carry over untouched.
 */
const SLOT_H = 0.155;

/**
 * Sprites further up the stage are further away. A gentle scale keeps the two
 * ranks from reading as one flat line without needing separate art.
 */
const depthScale = (yPct: number): number => 0.9 + 0.22 * (yPct - 0.6);

const pk = (p: Pos): string => `${p.x},${p.y}`;

/**
 * Keyframes for every idle in the roster, built once at module load.
 *
 * One rule per clip rather than one shared `steps()` rule, because per-frame
 * holds and offsets differ by clip -- that is the point of them.
 */
const IDLE_KEYFRAMES = keyframesFor(
  ROSTER.flatMap((d) =>
    d.sprite?.idle ? [{ who: d.id, clip: 'idle', frames: d.sprite.idle.frames }] : [],
  ),
);

/**
 * A stable per-character offset into the idle cycle, so the party does not
 * breathe in lockstep. Derived from the id rather than random so it does not
 * change between renders.
 */
function idlePhase(id: string, frames: number): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 997;
  // The character's OWN pace, or the offset would not land on a frame boundary
  // for anyone whose clip was retimed.
  return -(h % frames) * stepMsFor(id, 'idle');
}

interface Selection {
  unit: Unit | null;
  /** Only ever an ability the current `dice` pay for exactly. */
  ability: Ability | null;
  /** Indices into battle.dice. */
  dice: number[];
}

const NO_SELECTION: Selection = { unit: null, ability: null, dice: [] };


/** Must match the floater CSS animation length. */
const FLOATER_MS = 1000;

export function BattleScreen({
  party: basePartyProp,
  onExit,
}: {
  party: CharacterDef[];
  onExit: () => void;
}) {
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 100000));
  /**
   * Which rung of the ladder. Nine Scenes then a boss, repeating -- the whole
   * encounter list is generated from this one number, so testing levelling and
   * idle accrual does not need thirty hand-authored fights.
   */
  const [stage, setStage] = useState(1);
  /**
   * Dev only: re-level the party to test a stage without grinding to it.
   *
   * Null means "use the real save". Any number re-derives every sheet from the
   * base roster at that level, which is what makes the stage/level curve
   * explorable at all -- otherwise checking whether a level 12 team clears
   * stage 10 means actually having a level 12 team.
   */
  const [devLevel, setDevLevel] = useState<number | null>(null);
  const devMode = useDevTools();
  const [battle, setBattle] = useState<BattleState>(() => {
    const s = sceneFor(1);
    // `basePartyProp`, not `party`: the memo below is declared after this
    // initializer and reading it here is a temporal dead zone. The dev
    // override starts null anyway, so on first render they are the same.
    return createBattle(s.encounter, basePartyProp, s.enemies, seed);
  });

  const [sel, setSel] = useState<Selection>(NO_SELECTION);
  const [hover, setHover] = useState<Pos | null>(null);
  const [preview, setPreview] = useState<Ability | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [narration, setNarration] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);

  const [pulse, setPulse] = useState<{ id: string; dx: number } | null>(null);
  const [hits, setHits] = useState<Record<string, number>>({});
  const [floaters, setFloaters] = useState<Floater[]>([]);
  const floaterId = useRef(0);
  const [roll, setRoll] = useState<{ phase: 'pending' | 'tumbling' | 'settled'; face: number }[] | null>(null);

  const rollTimeouts = useRef<number[]>([]);
  const rollInterval = useRef<number | null>(null);
  const enemyTimer = useRef<number | null>(null);
  /** Separate from the enemy timer: the two phases run back to back and a
     single ref would have the hand-over cancel its own successor. */
  const playerTimer = useRef<number | null>(null);

  // The engine mutates state in place, so a revision counter is what re-renders.
  const [, bump] = useReducer((n: number) => n + 1, 0);

  // Re-levelled from the BASE roster, not from the passed-in party: the party
  // already has levels folded in, and levelling it again would compound.
  const party = useMemo(
    () => (devLevel === null ? basePartyProp : ROSTER.slice(0, 5).map((d) => applyLevel(d, devLevel))),
    [devLevel, basePartyProp],
  );

  const encounter = battle.encounter;
  const over = battle.outcome !== 'ongoing';
  const players = battle.units.filter((u) => u.side === 'player');
  const enemies = battle.units.filter((u) => u.side === 'enemy');

  useEffect(
    () => () => {
      if (enemyTimer.current !== null) window.clearTimeout(enemyTimer.current);
      if (playerTimer.current !== null) window.clearTimeout(playerTimer.current);
      rollTimeouts.current.forEach(window.clearTimeout);
      if (rollInterval.current !== null) window.clearInterval(rollInterval.current);
    },
    [],
  );

  function restart(nextSeed: number, nextStage = stage) {
    if (enemyTimer.current !== null) window.clearTimeout(enemyTimer.current);
    if (playerTimer.current !== null) window.clearTimeout(playerTimer.current);
    stopDiceRoll();
    setBusy(false);
    setNarration(null);
    setHits({});
    setFloaters([]);
    setSeed(nextSeed);
    setStage(nextStage);
    const scene = sceneFor(nextStage);
    setBattle(createBattle(scene.encounter, party, scene.enemies, nextSeed));
    setSel(NO_SELECTION);
    setError(null);
  }

  // ---------------------------------------------------------------- dice gate

  /** Dice subsets that pay for an ability without reusing an already-spent die. */
  function masksFor(ability: Ability): number[] {
    return payingMasks(battle.dice, ability).filter((m) => {
      for (let i = 0; i < battle.dice.length; i++) {
        if (m & (1 << i) && battle.diceSpent[i]) return false;
      }
      return true;
    });
  }

  /** Could SOME subset of this roll pay for it? Greys out what is impossible. */
  const affordable = useMemo(() => {
    const out = new Map<string, boolean>();
    if (!sel.unit || sel.unit.side !== 'player') return out;
    for (const a of sel.unit.def.abilities) out.set(a.name, masksFor(a).length > 0);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel.unit, battle.turn, battle.phase, battle.dice, battle.diceSpent.join()]);

  /**
   * Abilities the dice in hand pay for EXACTLY -- the gate that makes dice the
   * only route to an action. A different question from `affordable`.
   */
  const matched = useMemo(() => {
    const out = new Set<string>();
    if (!sel.unit || sel.unit.side !== 'player' || sel.dice.length === 0) return out;
    const sum = sel.dice.reduce((n, i) => n + (battle.dice[i] ?? 0), 0);
    for (const a of sel.unit.def.abilities) {
      if (!(affordable.get(a.name) ?? false)) continue;
      if (a.wildcard ? sel.dice.length === 1 : sum === a.cost) out.add(a.name);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel.unit, sel.dice, affordable, battle.turn, battle.phase]);

  const diceCover = (cost: number): boolean =>
    sel.dice.length > 0 && sel.dice.reduce((n, i) => n + (battle.dice[i] ?? 0), 0) === cost;

  // ------------------------------------------------------------- target sets

  /** Slots the chosen ability may legally be aimed at. */
  const targets = useMemo(() => {
    const out = new Set<string>();
    if (!sel.unit || !sel.ability || over) return out;
    const pool = livingOf(battle, sel.ability.kind === 'attack'
      ? (sel.unit.side === 'player' ? 'enemy' : 'player')
      : sel.unit.side);
    for (const u of pool) {
      if (canTarget(sel.ability, sel.unit, u.pos, battle.units)) out.add(pk(u.pos));
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel.unit, sel.ability, battle.turn, battle.phase, over]);

  /** Who a shot aimed at the hovered slot would actually catch. */
  const splash = useMemo(() => {
    const out = new Set<string>();
    if (!sel.unit || !sel.ability || !hover || !targets.has(pk(hover))) return out;
    const pool = livingOf(battle, sel.ability.kind === 'attack'
      ? (sel.unit.side === 'player' ? 'enemy' : 'player')
      : sel.unit.side);
    for (const u of unitsHit(sel.ability, hover, pool)) out.add(pk(u.pos));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel.unit, sel.ability, hover, targets]);

  /**
   * Who the enemies have declared they will hit this round, and with what.
   *
   * Separate from `danger`, which is a telegraph landing NEXT round. Both are
   * "something named this slot", but they ask for different answers -- a
   * telegraph can be walked away from over a whole turn, an intent has to be
   * answered inside this one.
   */
  const threat = useMemo(() => {
    const slots = new Set<string>();
    const byEnemy = new Map<string, { ability: string; targets: Set<string> }>();
    for (const u of battle.units) {
      if (!alive(u) || u.side !== 'enemy' || !u.intent) continue;
      const hit = unitsHit(u.intent.ability, u.intent.target, livingOf(battle, 'player'));
      const targets = new Set(hit.map((t) => pk(t.pos)));
      for (const k of targets) slots.add(k);
      byEnemy.set(u.def.id, { ability: u.intent.ability.name, targets });
    }
    return { slots, byEnemy };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [battle.turn, battle.phase, battle.units]);

  // A new party only reaches the battle through `createBattle`, so changing the
  // dev level has to restart the fight -- otherwise the slider moves and
  // nothing on the stage does.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    restart(seed, stage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [devLevel]);

  /** Which enemy the cursor is over, so its intent can be picked out. */
  const hoveredEnemyId = useMemo(() => {
    if (!hover) return null;
    const u = battle.units.find(
      (t) => alive(t) && t.side === 'enemy' && t.pos.x === hover.x && t.pos.y === hover.y,
    );
    return u?.def.id ?? null;
  }, [hover, battle.units]);

  /** Slots a telegraphed enemy ability has already named. */
  const danger = useMemo(() => {
    const out = new Set<string>();
    for (const u of battle.units) {
      if (!alive(u) || !u.pending) continue;
      for (const t of unitsHit(u.pending.ability, u.pending.target, livingOf(battle, 'player'))) {
        out.add(pk(t.pos));
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [battle.turn, battle.phase]);

  // ------------------------------------------------------------------ effects

  useEffect(() => {
    playDiceRoll(battle.dice);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setSel((s) => ({ ...s, ability: null }));
      setError(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function stopDiceRoll() {
    rollTimeouts.current.forEach(window.clearTimeout);
    rollTimeouts.current = [];
    if (rollInterval.current !== null) window.clearInterval(rollInterval.current);
    rollInterval.current = null;
  }

  /**
   * Tumble the dice in one at a time at the start of your phase. The values are
   * already decided by the seeded RNG -- this only reveals them, so it can never
   * change the outcome and is safe to interrupt.
   */
  function playDiceRoll(values: number[]) {
    stopDiceRoll();
    const STAGGER = 170;
    const SPIN = 500;

    setRoll(values.map(() => ({ phase: 'pending' as const, face: 1 })));
    rollInterval.current = window.setInterval(() => {
      setRoll((prev) =>
        prev && prev.map((d) => (d.phase === 'tumbling' ? { ...d, face: 1 + Math.floor(Math.random() * 6) } : d)),
      );
    }, 55);

    values.forEach((v, i) => {
      rollTimeouts.current.push(
        window.setTimeout(() => {
          setRoll((prev) => prev && prev.map((d, j) => (j === i ? { ...d, phase: 'tumbling' } : d)));
        }, i * STAGGER),
      );
      rollTimeouts.current.push(
        window.setTimeout(() => {
          setRoll((prev) => prev && prev.map((d, j) => (j === i ? { phase: 'settled', face: v } : d)));
        }, i * STAGGER + SPIN),
      );
    });

    rollTimeouts.current.push(
      window.setTimeout(() => {
        stopDiceRoll();
        setRoll(null);
      }, (values.length - 1) * STAGGER + SPIN + 260),
    );
  }

  /**
   * Run something that changes HP, then flinch whoever was hurt and float the
   * numbers. Diffing HP rather than parsing the log catches every source at once
   * -- direct hits, AoE splash, thorns, lifesteal, regen -- with exact amounts
   * and no name matching.
   */
  function withHitReactions(act: () => void) {
    const before = new Map(battle.units.map((u) => [u.def.id, u.hp]));
    // Where the log stood before the action, so the events it appends can be
    // read back. The HP diff below still decides the NUMBER -- it catches
    // every source at once, including ones that log nothing -- but it cannot
    // say what the damage was made of. The log can, so the two are combined:
    // diff for the amount, log for the element and the critical.
    const logMark = battle.log.length;
    act();

    /** Element and crit per target name, from this action's own events. */
    const style = new Map<string, { element?: Element; crit?: boolean }>();
    for (const e of battle.log.slice(logMark)) {
      if (e.t !== 'damage') continue;
      // Last write wins. A target hit twice in one action (a strike plus the
      // thorns it provokes) shows one merged number, so the styling should be
      // whichever event described the larger part of it -- and the reflected
      // hit, which carries no element, is the one that comes second.
      const prev = style.get(e.target);
      style.set(e.target, {
        element: e.element ?? prev?.element,
        crit: e.crit || prev?.crit,
      });
    }

    const changed = battle.units
      .map((u) => ({ unit: u, delta: u.hp - (before.get(u.def.id) ?? u.hp) }))
      .filter((c) => c.delta !== 0);
    if (changed.length === 0) return;

    const hurt = changed.filter((c) => c.delta < 0);
    if (hurt.length > 0) {
      setHits((h) => {
        const next = { ...h };
        for (const c of hurt) next[c.unit.def.id] = (next[c.unit.def.id] ?? 0) + 1;
        return next;
      });
    }

    const spawned = changed.map((c) => {
      const hit = c.delta < 0 ? style.get(c.unit.def.name) : undefined;
      return {
        id: floaterId.current++,
        amount: Math.abs(c.delta),
        kind: c.delta < 0 ? ('damage' as const) : ('heal' as const),
        at: { ...c.unit.pos },
        element: hit?.element,
        crit: hit?.crit,
      };
    });
    setFloaters((f) => [...f, ...spawned]);
    const ids = new Set(spawned.map((f) => f.id));
    window.setTimeout(() => setFloaters((f) => f.filter((n) => !ids.has(n.id))), FLOATER_MS);
  }

  /** A short shove toward the enemy line, so a static sprite reads as striking. */
  function lunge(id: string, side: Unit['side']) {
    setPulse({ id, dx: side === 'player' ? 1 : -1 });
    window.setTimeout(() => setPulse(null), 340);
  }

  // ----------------------------------------------------------------- handlers

  function selectUnit(u: Unit) {
    setSel({ unit: u, ability: null, dice: [] });
    setError(null);
  }

  function chooseAbility(a: Ability) {
    if (sel.ability?.name === a.name) {
      setSel((s) => ({ ...s, ability: null }));
      return;
    }
    // Dice are the gate: an ability the current selection does not cover is not
    // reachable. The button is disabled, and this guard means nothing else can
    // slip past it. Nothing here touches `dice` -- what you picked is spent.
    if (!matched.has(a.name)) return;
    setSel((s) => ({ ...s, ability: a }));
    setError(null);
  }

  function toggleDie(i: number) {
    if (battle.diceSpent[i] || busy || over) return;
    // Updater form: several toggles can land in one React batch, and reading the
    // closed-over selection would make all but the first compute from stale dice.
    setSel((s) => ({
      ...s,
      dice: s.dice.includes(i) ? s.dice.filter((d) => d !== i) : [...s.dice, i],
      // A chosen ability can never survive a die toggle -- every die is 1-6, so
      // adding or removing one always shifts the total, and a wildcard needs
      // exactly one die so it always moves off that count.
      ability: null,
    }));
    setError(null);
  }

  /**
   * Queue the chosen ability against a unit. Discrete targets, so one click is
   * enough.
   *
   * Nothing resolves here any more -- no damage, no animation. The turn is
   * built first and played out on commit, which is what makes the order the
   * player put things in a decision rather than a running commentary.
   */
  function fireAt(target: Unit) {
    if (!sel.unit || !sel.ability || busy || over) return;
    if (!targets.has(pk(target.pos))) return;

    const err = planAction(battle, sel.unit, sel.ability, sel.dice, target.pos);
    if (err) setError(err);
    else {
      setSel(NO_SELECTION);
      setError(null);
    }
    bump();
  }

  function handleUpgrade() {
    if (!sel.unit || !nextTier || upgradeMasks.length === 0) return;
    if (!diceCover(nextTier.cost)) return;
    const err = planUpgrade(battle, sel.unit, sel.dice);
    if (err) setError(err);
    else {
      setSel(NO_SELECTION);
      setPreview(null);
      bump();
    }
  }

  /**
   * Hand over to the enemy, then play their phase out one character at a time so
   * you can follow what each of them decided. Resolving it all at once made it
   * impossible to tell what had happened.
   */
  /**
   * Lock the turn in and play it out: the queue first, in order, then the
   * enemies. One button, because from the player's side these are one
   * commitment -- there is no point between them where anything can be changed.
   */
  function handleEndPhase() {
    if (busy || over) return;
    setSel(NO_SELECTION);
    setError(null);
    setBusy(true);
    bump();
    playerTimer.current = window.setTimeout(stepPlan, 220);
  }

  /** Resolve one queued action, then the next, then hand over to the enemies. */
  function stepPlan() {
    const held: { step: PlannedAction | null } = { step: null };
    withHitReactions(() => {
      held.step = commitNext(battle);
    });
    const step = held.step;

    if (!step) {
      startEnemyPhase(battle);
      setNarration(null);
      bump();
      enemyTimer.current = window.setTimeout(stepEnemy, 420);
      return;
    }

    lunge(step.unit.def.id, step.unit.side);
    setNarration(actionLine(step.unit, step.ability, step.target, battle.units));
    bump();
    playerTimer.current = window.setTimeout(stepPlan, 620);
  }

  function stepEnemy() {
    const held: { step: ReturnType<typeof nextAiStep> } = { step: null };
    withHitReactions(() => {
      held.step = nextAiStep(battle);
    });
    const step = held.step;

    if (!step) {
      finishEnemyPhase(battle);
      setBusy(false);
      setNarration(null);
      bump();
      if (battle.outcome === 'ongoing' && battle.phase === 'player') playDiceRoll(battle.dice);
      return;
    }

    lunge(step.unit.def.id, step.unit.side);
    setNarration(actionLine(step.unit, step.ability, step.target, battle.units));
    bump();
    enemyTimer.current = window.setTimeout(stepEnemy, 700);
  }

  // ------------------------------------------------------------------ derived

  const diceSum = sel.dice.reduce((a, i) => a + (battle.dice[i] ?? 0), 0);
  /** A hero is up with dice picked but no ability chosen yet. */
  const diceOnly =
    !sel.ability && sel.dice.length > 0 && sel.unit?.side === 'player' && !sel.unit.hasActed
      ? sel.unit
      : null;
  /** A hero is up but no dice are picked, so the whole panel is greyed out. */
  const awaitingDice =
    !over && sel.dice.length === 0 && sel.unit?.side === 'player' && !sel.unit.hasActed;
  /** Rules text follows the hovered ability, falling back to the chosen one. */
  const shownAbility = preview ?? sel.ability;
  const nextTier =
    sel.unit && sel.unit.side === 'player' ? (sel.unit.def.upgrades ?? [])[sel.unit.upgrades] : undefined;
  const upgradeMasks = nextTier ? masksFor({ cost: nextTier.cost } as Ability) : [];
  const upgradeReady = nextTier != null && upgradeMasks.length > 0 && diceCover(nextTier.cost);

  const hoveredUnit = hover ? battle.units.find((u) => alive(u) && pk(u.pos) === pk(hover)) : undefined;

  return (
    <div className="game battle">
      <style>{IDLE_KEYFRAMES}</style>
      <div className="stage" style={{ backgroundImage: `url(${encounter.background})` }}>
        <div className="stage-frame">
        {battle.units.filter(alive).map((u) => {
          const slot = slotFor(u, encounter.partySlots, encounter.enemySlots, battle.units);
          if (!slot) return null;
          const key = pk(u.pos);
          const isTarget = targets.has(key);
          const classes = [
            'stage-slot',
            u.side,
            sel.unit === u ? 'selected' : '',
            isTarget ? 'targetable' : '',
            splash.has(key) ? 'splash' : '',
            danger.has(key) ? 'danger' : '',
            threat.slots.has(key) ? 'threatened' : '',
            // Hovering an enemy picks its own targets out of everyone else's --
            // five enemies all declaring at once marks most of the party, and
            // the useful question is which of them THIS one named.
            hover && threat.byEnemy.get(hoveredEnemyId ?? '')?.targets.has(key) ? 'aimed' : '',
          ]
            .filter(Boolean)
            .join(' ');

          return (
            <div
              key={u.def.id}
              className={classes}
              style={{
                left: `${slot.xPct * 100}%`,
                top: `${slot.yPct * 100}%`,
                // Painter's order: whoever stands nearer the audience draws over
                // whoever is behind them.
                zIndex: 100 + Math.round(slot.yPct * 100),
                ['--px' as string]: `${(pulse?.id === u.def.id ? pulse.dx : 0) * 18}px`,
              }}
              onMouseEnter={() => setHover(u.pos)}
              onMouseLeave={() => setHover(null)}
              onClick={() => (isTarget ? fireAt(u) : selectUnit(u))}
            >
              <UnitChip
                key={hits[u.def.id] ?? 0}
                unit={u}
                phase={battle.phase}
                slotH={SLOT_H}
                queued={u.side === 'player' && isPlanned(battle, u)}
                depth={depthScale(slot.yPct)}
                facing={u.side === 'player' ? 1 : -1}
                hit={hits[u.def.id] ?? 0}
                striking={pulse?.id === u.def.id}
              />
              {u.pending && <span className="casting">!</span>}
            </div>
          );
        })}

        {/* Every declared intent, in ONE layer above all the slots.
            These were rendered inside each slot, which put them in that slot's
            stacking context -- and a slot's z-index comes from its depth, so a
            creature standing nearer covered the label of the one behind it.
            Above the face was no better: with six enemies staggered for depth,
            a label over one head lands on another. Only a layer over all of
            them is free of both, and it costs one extra pass over the units. */}
        {battle.phase === 'player' &&
          livingOf(battle, 'enemy').map((u) => {
            if (!u.intent || u.pending) return null;
            const slot = slotAt(u.pos, encounter);
            if (!slot) return null;
            return (
              <span
                key={u.def.id}
                className="intent"
                title={`rolled ${u.intent.roll} — ${u.intent.ability.name}`}
                style={{ left: `${slot.xPct * 100}%`, top: `${slot.yPct * 100}%` }}
              >
                {u.intent.roll}
              </span>
            );
          })}

        {floaters.map((f) => {
          const slot = slotAt(f.at, encounter);
          if (!slot) return null;
          return (
            <span
              key={f.id}
              className={floaterClass(f)}
              style={{ left: `${slot.xPct * 100}%`, top: `${slot.yPct * 100}%`, zIndex: 900 }}
            >
              {f.crit && <b className="crit-flag">CRIT</b>}
              {f.kind === 'damage' ? '-' : '+'}
              {f.amount}
            </span>
          );
        })}
        </div>
      </div>

      <div className="hud hud-top">
        <div className="panel bar">
          <strong className="title">Stagebound</strong>
          <span className="dim">{encounter.name}</span>
          <span className={battle.phase === 'player' ? 'phase you' : 'phase foe'}>
            {battle.phase === 'player' ? 'Your phase' : 'Enemy phase'}
          </span>
          <span className="dim">
            Turn {battle.turn}/{MAX_TURNS}
          </span>
        </div>
        <div className="panel bar">
          <button onClick={onExit}>Home</button>
          {devMode && (
            <>
              {/* Jump anywhere on the ladder: every tenth rung is the boss, and
                  the level rises with the number, so this is the whole
                  difficulty curve in one control. */}
              <select value={stage} onChange={(e) => restart(seed, Number(e.target.value))}>
                {Array.from({ length: 20 }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {n % BOSS_EVERY === 0 ? `★ Stage ${n} — boss` : `Stage ${n}`}
                  </option>
                ))}
              </select>
              <label className="dev-level">
                party lv
                <input
                  type="number"
                  min={1}
                  max={MAX_LEVEL}
                  value={devLevel ?? ''}
                  placeholder="save"
                  onChange={(e) => setDevLevel(e.target.value === '' ? null : Number(e.target.value))}
                />
              </label>
              <button onClick={() => setShowLog(true)}>Show log</button>
              <button onClick={() => restart(seed)}>Restart</button>
              <button onClick={() => restart(Math.floor(Math.random() * 100000))}>New seed</button>
            </>
          )}
        </div>
      </div>

      <div className="hud hud-left">
        <TeamPanel title={`Your team (${livingOf(battle, 'player').length}/${players.length})`}
          units={players} selected={sel.unit} onSelect={selectUnit} />
        <TeamPanel title={`Enemies (${livingOf(battle, 'enemy').length}/${enemies.length})`}
          units={enemies} selected={sel.unit} onSelect={selectUnit} />
      </div>

      {sel.unit && (
        <div className="hud hud-right">
          <div className="panel detail">
            <h3 className="portrait-head">
              {sel.unit.def.sprite ? (
                <SpritePortrait sheet={sel.unit.def.sprite} height={54} />
              ) : (
                <Avatar def={sel.unit.def} size={40} side={sel.unit.side} />
              )}
              <span className="who">{sel.unit.def.name}</span>
              <span className="stars">{'★'.repeat(sel.unit.def.rarity)}</span>
            </h3>
            <div className="stat-row">
              <span>
                HP {sel.unit.hp}/{unitMaxHp(sel.unit)}
              </span>
              <span>ATK {unitAttack(sel.unit)}</span>
              <span>P.DEF {effectiveDefense(sel.unit, 'physical')}</span>
              <span>M.DEF {effectiveDefense(sel.unit, 'magical')}</span>
              {sel.unit.upgrades > 0 && (
                <span className="boosted">+{Math.round((statScale(sel.unit) - 1) * 100)}%</span>
              )}
            </div>
            <div className="terrain-note">
              {ROLE_LABEL[sel.unit.def.role]} · {elementsOf(sel.unit.def).join('/')} ·{' '}
              {rankLabel(sel.unit, battle)}
            </div>

            {sel.unit.side === 'player' && !over && (
              <div className="turn-state">
                <span className={sel.unit.hasActed ? 'used' : 'left'}>
                  {sel.unit.hasActed ? 'action spent' : 'action available'}
                </span>
              </div>
            )}

            {/* An enemy's whole d20 table, with this round's roll marked.
                The badge on the stage is only a number; this is what makes it
                mean something, and it is why the roll is worth showing at all
                rather than the ability name. */}
            {sel.unit.side === 'enemy' && (
              <ul className="rolltable">
                {sel.unit.def.abilities
                  .filter((a) => a.roll)
                  .map((a) => {
                    const [lo, hi] = a.roll!;
                    const now = sel.unit!.intent?.roll;
                    const live = now !== undefined && now >= lo && now <= hi;
                    return (
                      <li key={a.name} className={live ? 'on' : ''}>
                        <span className="band">{lo === hi ? lo : `${lo}–${hi}`}</span>
                        <span className="nm">{a.name}</span>
                        <span className="odds">
                          {Math.round(((hi - lo + 1) / ENEMY_DIE) * 100)}%
                        </span>
                      </li>
                    );
                  })}
              </ul>
            )}

            {sel.unit.side === 'player' && !sel.unit.hasActed && !over && (
              <ul className="abilities">
                {sel.unit.def.abilities.map((a) => {
                  // Three states. `locked` is hopeless: no subset of this roll can
                  // pay for it. `ready` means the dice in hand cover it now.
                  // Plain-but-disabled is the middle -- payable, wrong dice.
                  const ok = affordable.get(a.name) ?? false;
                  const active = sel.ability?.name === a.name;
                  const ready = matched.has(a.name);
                  return (
                    // Hover lives on the <li>: disabled buttons swallow mouse events.
                    <li key={a.name} onMouseEnter={() => setPreview(a)} onMouseLeave={() => setPreview(null)}>
                      <button
                        className={`ability ${ok ? '' : 'locked'} ${active ? 'active' : ''} ${ready ? 'ready' : ''}`}
                        onClick={() => chooseAbility(a)}
                        disabled={!ready}
                        title={
                          !ok
                            ? `No dice in this roll can total ${a.cost}`
                            : !ready
                              ? a.wildcard
                                ? 'Select any single die'
                                : `Select dice totalling ${a.cost}`
                              : undefined
                        }
                      >
                        <span className="cost">{a.wildcard ? '✳' : a.cost}</span>
                        <span className="body">
                          <strong>{a.name}</strong>
                          <em>
                            {a.kind}
                            {a.kind === 'attack' ? ` · ${damageTypeOf(a)}` : ''} · {rangeLabel(a)}
                            {a.element && (
                              <>
                                {' · '}
                                <span style={{ color: ELEMENT_COLOR[a.element] }}>{a.element}</span>
                              </>
                            )}
                          </em>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {sel.unit.side === 'player' && activePassives(sel.unit).length > 0 && (
              <div className="passive-list">
                {activePassives(sel.unit).map((pas, i) => (
                  <div key={`${pas.kind}-${i}`} className="kit-row passive">
                    <strong>{pas.kind}</strong>
                    <p>{describePassive(pas)}</p>
                  </div>
                ))}
              </div>
            )}

            {sel.unit.side === 'player' && !over && (
              <div className="upgrades">
                <div className="upgrade-track">
                  {(sel.unit.def.upgrades ?? []).map((t, i) => (
                    <span key={t.name} className={`pip-tier ${i < sel.unit!.upgrades ? 'on' : ''}`} title={t.name} />
                  ))}
                  <span className="dim">upgrades</span>
                </div>

                {nextTier ? (
                  <button
                    className={`upgrade-btn ${upgradeReady ? 'ready' : ''} ${upgradeMasks.length === 0 ? 'locked' : ''}`}
                    onClick={handleUpgrade}
                    disabled={sel.unit.hasActed || !upgradeReady}
                    title={
                      upgradeMasks.length === 0
                        ? `No dice combination totals ${nextTier.cost}`
                        : !upgradeReady
                          ? `Select dice totalling ${nextTier.cost}`
                          : undefined
                    }
                  >
                    <span className="cost">{nextTier.cost}</span>
                    <span className="body">
                      <strong>{nextTier.name}</strong>
                      <em>+10% stats · {describePassive(nextTier.passive)}</em>
                    </span>
                  </button>
                ) : (
                  <span className="dim">Fully upgraded</span>
                )}
              </div>
            )}

            {sel.unit.side === 'enemy' && (
              <div className="enemy-kit">
                {sel.unit.pending && (
                  <p className="incoming">
                    Casting <strong>{sel.unit.pending.ability.name}</strong> — lands next turn
                  </p>
                )}
                {sel.unit.def.abilities.map((a) => (
                  <div key={a.name} className="kit-row">
                    <strong>{a.name}</strong>
                    {(sel.unit!.cooldowns[a.name] ?? 0) > 0 && <em className="cd">{sel.unit!.cooldowns[a.name]}t</em>}
                    <p>{describeAbility(a)}</p>
                    {describeEnemyUsage(a) && <p className="sub">{describeEnemyUsage(a)}</p>}
                  </div>
                ))}
                {(sel.unit.def.passives ?? []).map((pas) => (
                  <div key={pas.kind} className="kit-row passive">
                    <strong>{pas.kind}</strong>
                    <p>{describePassive(pas)}</p>
                  </div>
                ))}
              </div>
            )}

            {shownAbility && (
              <div className="rules">
                <strong>{shownAbility.name}</strong>
                <p>{describeAbility(shownAbility)}</p>
                <p className="sub">{describeCost(shownAbility)}</p>
                {describeElement(shownAbility) && <p className="sub">{describeElement(shownAbility)}</p>}
              </div>
            )}

            {sel.ability && hoveredUnit && targets.has(pk(hoveredUnit.pos)) && (
              <ForecastPanel battle={battle} source={sel.unit} ability={sel.ability} centre={hoveredUnit.pos} />
            )}
          </div>
        </div>
      )}

      <div className="hud hud-bottom">
        {/* Reserved whether or not anything is being said, so the tray below
            does not jump every time an action starts and finishes. */}
        <div className="narration-slot">
          {narration && <div className="panel narration">{narration}</div>}
        </div>

        <div className="panel tray">
          {battle.phase === 'player' && !busy ? (
            <DiceTray
              dice={battle.dice}
              spent={battle.diceSpent}
              selected={sel.dice}
              onToggle={toggleDie}
              disabled={over}
              roll={roll}
            />
          ) : (
            <div className="dice-placeholder">
              {/* The tray is hidden for two different reasons and they used to
                  share one message, so committing your own turn announced that
                  enemies do not roll dice. */}
              {battle.phase === 'enemy'
                ? 'Enemies do not roll — they act on a fixed pattern.'
                : 'Playing out your turn…'}
            </div>
          )}

          {/* The turn as built so far. Numbered because the number IS the
              mechanic -- these resolve top to bottom and an attack queued behind
              a kill it caused will fizzle with its dice already spent. */}
          {battle.plan.length > 0 && !busy && (
            <ol className="queue">
              {battle.plan.map((entry, i) => (
                <li key={`${entry.unit.def.id}-${i}`}>
                  <span className="ord">{i + 1}</span>
                  <span className="who">{entry.unit.def.name}</span>
                  <span className="what">{entry.ability?.name ?? 'Upgrade'}</span>
                  <button
                    className="quiet"
                    title="Resolve earlier"
                    disabled={i === 0}
                    onClick={() => {
                      movePlanned(battle, i, i - 1);
                      bump();
                    }}
                  >
                    ▲
                  </button>
                  <button
                    className="quiet"
                    title="Resolve later"
                    disabled={i === battle.plan.length - 1}
                    onClick={() => {
                      movePlanned(battle, i, i + 1);
                      bump();
                    }}
                  >
                    ▼
                  </button>
                  <button
                    className="quiet"
                    title="Take out of the turn and get the dice back"
                    onClick={() => {
                      unplan(battle, i);
                      bump();
                    }}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ol>
          )}

          <div className="controls">
            <button className="primary" onClick={handleEndPhase} disabled={over || busy}>
              {busy
                ? 'Resolving…'
                : battle.plan.length > 0
                  ? `Commit ${battle.plan.length} action${battle.plan.length === 1 ? '' : 's'}`
                  : 'End phase'}
            </button>
          </div>

          {(sel.ability || error || diceOnly || awaitingDice) && (
            <div className="hints">
              {awaitingDice && (
                <span className="hint">
                  Pick dice to choose an ability — an ability unlocks when your dice cover its cost
                </span>
              )}
              {diceOnly && (
                <span className={`hint ${matched.size > 0 || upgradeReady ? 'ok' : 'warn'}`}>
                  <strong>{diceSum}</strong>
                  {matched.size > 0
                    ? ` — ${matched.size} ${matched.size === 1 ? 'ability' : 'abilities'} ready${
                        upgradeReady && nextTier ? `, plus the ${nextTier.name} upgrade` : ''
                      }`
                    : upgradeReady && nextTier
                      ? ` — pays for the ${nextTier.name} upgrade`
                      : ` — ${diceOnly.def.name} has nothing costing ${diceSum}`}
                </span>
              )}
              {sel.ability && (
                <span className="hint ok">
                  <strong>{sel.ability.wildcard ? '1 die' : `${diceSum} / ${sel.ability.cost}`}</strong>
                  {targets.size === 0 ? ' — nothing in reach' : ' — click a target'}
                </span>
              )}
              {error && <span className="error">{error}</span>}
            </div>
          )}
        </div>
      </div>

      {over && (
        <div className="hud hud-centre">
          <div className="outcome-card">
            <div className={`outcome ${battle.outcome}`}>
              {battle.outcome === 'victory' ? 'Victory' : battle.outcome === 'defeat' ? 'Defeat' : 'Draw — turn limit'}
            </div>
            <button className="primary" onClick={onExit}>
              Return home
            </button>
          </div>
        </div>
      )}

      {showLog && (
        <div className="modal-backdrop" onClick={() => setShowLog(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <strong>Battle log</strong>
              <button onClick={() => setShowLog(false)}>Close</button>
            </div>
            <LogPanel battle={battle} full />
          </div>
        </div>
      )}
    </div>
  );
}

/** Which slot a unit is standing in, matched by its formation coordinates. */
function slotFor(u: Unit, partySlots: Slot[], enemySlots: Slot[], _units: Unit[]): Slot | undefined {
  const pool = u.side === 'player' ? partySlots : enemySlots;
  return pool.find((s) => s.col === u.pos.x && s.row === u.pos.y);
}

function slotAt(p: Pos, enc: { partySlots: Slot[]; enemySlots: Slot[] }): Slot | undefined {
  return [...enc.partySlots, ...enc.enemySlots].find((s) => s.col === p.x && s.row === p.y);
}

/** "front rank" / "2nd rank" -- where this unit sits in its own formation. */
function rankLabel(u: Unit, battle: BattleState): string {
  const rank = columnRank(u.pos.x, battle.units, u.side);
  if (!Number.isFinite(rank)) return 'down';
  return rank === 1 ? 'front rank' : `rank ${rank}`;
}

/**
 * The one-line "who does this reach" tag under an ability.
 *
 * Scope is checked before range, because for `all` and `self` the range is
 * vestigial -- printing "any rank · all" invites the reader to work out how the
 * two interact when they do not.
 */
const rangeLabel = (a: Ability): string => {
  if (a.scope === 'self') return 'self';
  if (a.scope === 'all') return a.kind === 'attack' ? 'all enemies' : 'whole party';
  if (a.kind !== 'attack') return 'any ally';
  return a.range <= 1 ? 'front rank' : a.range === 2 ? 'first 2 ranks' : 'any rank';
};

/** Headshot for panels, where the full figure would be too small to read. */
function SpritePortrait({ sheet, height }: { sheet: SpriteSheet; height: number }) {
  return (
    <img
      className="portrait"
      src={sheet.icon ?? sheet.src}
      alt=""
      draggable={false}
      style={{ height, width: height, flex: 'none' }}
    />
  );
}

function UnitChip({
  unit,
  phase,
  slotH,
  depth,
  facing,
  hit,
  striking,
  queued = false,
}: {
  unit: Unit;
  phase: Unit['side'];
  /** Has an action waiting in the turn queue, not yet resolved. */
  queued?: boolean;
  /** Slot height as a fraction of the stage; the sprite scales off this. */
  slotH: number;
  depth: number;
  facing: number;
  hit: number;
  striking: boolean;
}) {
  // Only grey out the side whose turn it is; the idle side's flags are stale.
  // `queued` is distinct from `acted`: one is a promise the player can still take
  // back, the other has already happened.
  const spent = unit.side !== phase ? '' : unit.hasActed ? 'acted' : queued ? 'queued' : '';
  const sheet = unit.def.sprite;
  const title =
    `${unit.def.name} · ${unit.hp}/${unitMaxHp(unit)} hp` +
    ` · p.def ${effectiveDefense(unit, 'physical')} · m.def ${effectiveDefense(unit, 'magical')}`;
  // No HP bar on the stage. Six of them stacked under six creatures was a row
  // of coloured slivers competing with the art, and the space is better spent
  // on the intent label -- which is the thing you actually plan against.
  // Health lives in the team lists, which show every unit at once, and in the
  // detail panel for whoever is selected.

  if (sheet) {
    // Height in stage units; `slotH * sheet.scale` is exactly the old tile math,
    // so every relative stature carries over from the board unchanged.
    const h = slotH * sheet.scale * depth;
    const idle = sheet.idle;

    // An animated character is a window onto a strip that slides one frame at a
    // time. The clip carries the mirror and the foot offset, because the strip
    // itself is already using `transform` to slide.
    //
    // `h` is the FIGURE height; the box holding it is larger, by however much
    // this character's widest clip reaches. `clipBox` does that conversion and
    // lands the feet on the slot mark.
    const box = idle ? clipBox(idle, h, placementFor(unit.def.id, 'idle')) : null;
    // The strip and the still are different files with different heights --
    // Maxine's strip is 105px against her 106px still -- so the rounding step
    // has to come from whichever one is actually being drawn.
    const crispHeight = crispCss(
      `${(box ? box.boxH : h) * 100}cqh`,
      box ? idle!.pxH : sheet.pxH,
      sheet.pixelated,
    );
    const body = idle && box ? (
      <span
        className="anim-clip"
        style={{ transform: `translate(${box.shiftPct}%, ${box.dropPct}%) scaleX(${facing})` }}
      >
        <img
          className={`sprite anim-strip ${sheet.pixelated ? 'pixel' : ''}`}
          src={idle.src}
          alt=""
          draggable={false}
          style={{
            width: `${idle.frames * 100}%`,
            // A plain loop, NOT a ping-pong. These sheets are already complete
            // bounce cycles -- the pack step trims them to whole cycles -- so
            // playing one backwards adds a second bounce that is not in the art.
            //
            // Driven by generated keyframes rather than `steps()` so that any
            // per-frame holds authored in <actor>.anim.json play in the battle
            // exactly as they did in the lab.
            animationName: clipAnimName(unit.def.id, 'idle'),
            animationTimingFunction: 'linear',
            animationDuration: `${clipDuration(
              clipTimeline(idle.frames, tuningFor(unit.def.id, 'idle'), orderFor(unit.def.id, 'idle')),
              stepMsFor(unit.def.id, 'idle'),
            )}ms`,
            animationDelay: `${idlePhase(unit.def.id, idle.frames)}ms`,
          }}
        />
      </span>
    ) : (
      <img
        className={`sprite ${sheet.pixelated ? 'pixel' : ''}`}
        src={sheet.src}
        alt=""
        draggable={false}
        style={{
          height: '100%',
          width: 'auto',
          // Mirror about the feet so a flipped character keeps its footing.
          transform: `translateX(${(0.5 - sheet.anchorX) * 100}%) scaleX(${facing})`,
        }}
      />
    );

    return (
      <div
        className={`unit sprite-unit ${unit.side} ${spent} ${hit ? 'hurt' : ''} ${striking ? 'striking' : ''}`}
        title={title}
        style={{
          // Rounded to whole art pixels, in CSS rather than here: these are
          // fractions of the stage, and what one resolves to in pixels is not
          // known until layout. Width follows the ROUNDED height so the aspect
          // survives the rounding.
          height: crispHeight,
          ...(box ? { width: `calc(${crispHeight} * ${idle!.aspect})` } : null),
        }}
      >
        {body}
      </div>
    );
  }

  return (
    <div
      className={`unit ${unit.side} ${spent} ${hit ? 'hurt' : ''} ${striking ? 'striking' : ''}`}
      style={{ borderColor: ELEMENT_COLOR[themeOf(unit.def)] }}
      title={title}
    >
      <Avatar def={unit.def} size={40} side={unit.side} />
    </div>
  );
}

function DiceTray({
  dice,
  spent,
  selected,
  onToggle,
  disabled,
  roll,
}: {
  dice: number[];
  spent: boolean[];
  selected: number[];
  onToggle: (i: number) => void;
  disabled: boolean;
  roll: { phase: 'pending' | 'tumbling' | 'settled'; face: number }[] | null;
}) {
  return (
    <div className="dice">
      {dice.map((v, i) => {
        const anim = roll?.[i];
        // While a die is in the air it shows a random face, not its real value.
        const face = anim && anim.phase !== 'settled' ? anim.face : v;
        const locked = anim !== undefined && anim.phase !== 'settled';
        return (
          <button
            key={i}
            className={`die ${spent[i] ? 'spent' : ''} ${selected.includes(i) ? 'picked' : ''} ${anim ? anim.phase : ''}`}
            onClick={() => onToggle(i)}
            disabled={disabled || spent[i] || locked}
          >
            <span className="pip">{DIE_PIPS[face]}</span>
            <span className="val">{anim && anim.phase !== 'settled' ? ' ' : v}</span>
          </button>
        );
      })}
    </div>
  );
}

function TeamPanel({
  title,
  units,
  selected,
  onSelect,
}: {
  title: string;
  units: Unit[];
  selected: Unit | null;
  onSelect: (u: Unit) => void;
}) {
  return (
    <div className="card">
      <h3>{title}</h3>
      <ul className="roster">
        {units.map((u) => (
          <li key={u.def.id}>
            <button className={`row ${selected === u ? 'on' : ''} ${alive(u) ? '' : 'dead'}`} onClick={() => onSelect(u)}>
              {u.def.sprite?.icon ? (
                <img className="row-icon" src={u.def.sprite.icon} alt="" draggable={false} />
              ) : (
                <Avatar def={u.def} size={26} side={u.side} />
              )}
              <span className="nm">{u.def.name}</span>
              {/* Level, on both sides. The enemy's is the whole reason to show
                  it -- how far ahead or behind the stage is running is the
                  first thing you want to know, and it was previously only
                  inferable from the stat line in the detail panel. */}
              <span className="lv">Lv {levelOf(u.def)}</span>
              <span className="hp">
                {alive(u) ? `${u.hp}/${u.def.maxHp}` : 'down'}
                {/* Net attack modifier, buffs and shreds together, so a row
                    says at a glance whether this unit is currently running hot
                    or has been cut down. */}
                {modifierTotal(u, 'attack') !== 0 && (
                  <span className={modifierTotal(u, 'attack') > 0 ? 'buff' : 'shred'}>
                    {' '}
                    {modifierTotal(u, 'attack') > 0 ? '+' : ''}
                    {modifierTotal(u, 'attack')}
                  </span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Shows exactly what the hovered target would take, before committing. */
function ForecastPanel({
  battle,
  source,
  ability,
  centre,
}: {
  battle: BattleState;
  source: Unit;
  ability: Ability;
  centre: Pos;
}) {
  const pool = livingOf(battle, ability.kind === 'attack' ? 'enemy' : 'player');
  const hit = unitsHit(ability, centre, pool);
  if (hit.length === 0) return null;

  return (
    <div className="forecast">
      {hit.map((t) => {
        if (ability.kind === 'attack') {
          const dmg = computeDamage(source, ability, t);
          const lethal = dmg >= t.hp;
          return (
            <div key={t.def.id} className={lethal ? 'line lethal' : 'line'}>
              {t.def.name} <strong>-{dmg}</strong>
              {lethal ? ' (lethal)' : ` → ${t.hp - dmg} hp`}
            </div>
          );
        }
        if (ability.kind === 'heal') {
          const amt = Math.min(ability.power, t.def.maxHp - t.hp);
          return (
            <div key={t.def.id} className="line heal">
              {t.def.name} <strong>+{amt}</strong>
            </div>
          );
        }
        return (
          <div key={t.def.id} className="line buff">
            {t.def.name} <strong>+{ability.power} atk</strong>
          </div>
        );
      })}
    </div>
  );
}

function LogPanel({ battle, full = false }: { battle: BattleState; full?: boolean }) {
  const lines = (full ? battle.log : battle.log.slice(-14)).map((e) => {
    switch (e.t) {
      case 'roll':
        return `— turn ${e.turn} ${e.side === 'player' ? 'you' : 'enemy'}: [${e.dice.join(' ')}]`;
      case 'act':
        return `  ${e.actor}: ${e.ability} (${e.dice.join('+')})`;
      case 'damage':
        return `      -${e.amount} ${e.target}${e.matchup ? ` ${e.matchup}` : ''}`;
      case 'heal':
        return `      +${e.amount} ${e.target}`;
      case 'buff':
        return `      +${e.amount} atk ${e.target}`;
      case 'ko':
        return `      ✖ ${e.unit} down`;
      case 'telegraph':
        return `  ${e.unit} winds up ${e.ability}`;
      case 'upgrade':
        return `  ${e.unit} buys ${e.name}`;
      case 'end':
        return `  ${e.outcome.toUpperCase()} in ${e.turns} turns`;
    }
  });
  return (
    <div className="card log">
      <h3>Battle log</h3>
      <pre>{lines.join('\n')}</pre>
    </div>
  );
}
