import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  createBattle,
  ENEMY_DIE,
  planAction,
  planUpgrade,
  commitNext,
  isPlanned,
  movePlanned,
  unplan,
  type PlannedAction,
  commitUpgrade,
  rampMultiplier,
  startEnemyPhase,
  finishEnemyPhase,
  chainPreview,
  nextAiStep,
  livingOf,
  MAX_TURNS,
  type BattleState,
} from '../engine/battle.ts';
import { BOSS_EVERY, ROSTER, sceneFor } from '../engine/content.ts';
import { useDevTools } from './dev.ts';
import { MAX_STARS } from '../engine/stars.ts';
import {
  buildParty,
  deleteRoster,
  saveRoster,
  useDevRosters,
  type DevMember,
} from './devRoster.ts';
import { applyLevel, levelOf, MAX_LEVEL } from '../engine/levels.ts';
import { paysAsWildcard, payingMasks } from '../engine/allocate.ts';
import { altered, describeDie } from '../engine/dice.ts';
import { elementResistance } from '../engine/combat.ts';
import { matchupLabel, RESIST_CAP } from '../engine/elements.ts';
import {
  canTarget,
  computeDamage,
  effectiveDefense,
  modifierTotal,
  damageTypeOf,
  statScale,
  unitAttack,
  computeHeal,
  unitMaxHp,
  unitsHit,
} from '../engine/combat.ts';
import {
  describeAbility,
  describeChain,
  describeCost,
  describeElement,
  describeEnemyUsage,
  describePassive,
} from '../engine/describe.ts';
import {
  columnRank,
  PARTY_SLOTS_ALL,
  STANDARD_PARTY_SLOTS,
  type Slot,
} from '../engine/formation.ts';
import { actionLine, floaterClass, type Floater } from './narrate.ts';
import {
  ROLE_LABEL,
  alive,
  freezeThreshold,
  type Ability,
  type Die,
  type Passive,
  type CharacterDef,
  type Element,
  type Pos,
  type Side,
  type SpriteSheet,
  type Unit,
} from '../engine/types.ts';
import { Avatar, ElementIcon, SymbolIcon, themeOf } from './Avatar.tsx';
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
  /** Die ids, never indices -- the pool is mutable and can be added to. */
  dice: string[];
}

const NO_SELECTION: Selection = { unit: null, ability: null, dice: [] };

/**
 * A stat, as the sheet shows it.
 *
 * Stats are whole numbers again now that ATK and DEF are measured in tenths of
 * a damage point (`ATK_PER_DAMAGE`), so this is normally a no-op. It stays
 * because an authored `Ability.power` may still carry a decimal and the buff
 * rows read it directly -- one place that rounds beats four that forget to.
 */
const stat = (n: number): string => String(Math.round(n * 10) / 10);


/** Must match the floater CSS animation length. */
const FLOATER_MS = 1500;

/*
 * How long one resolved action stays on screen.
 *
 * Paced for READING, not for animation. Every step writes a new line into the
 * message box -- "Benjamin uses Quick Cut!" -- and at the old 620ms the next
 * unit had already overwritten it before the sentence could be finished, so a
 * five-action round was a blur of text nobody could follow. A beat is roughly
 * how long it takes to read a short sentence and glance at the damage floater
 * it explains.
 *
 * The enemy beat is slightly longer because their actions are the ones you did
 * NOT choose, so they are the ones actually worth reading.
 */
const BEAT_MS = 1500;
const ENEMY_BEAT_MS = 1700;
/** The pause on handing the turn between sides, with the box cleared. */
const HANDOVER_MS = 800;
/** Between pressing Commit and the first action landing. */
const COMMIT_LEAD_MS = 400;

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
  /**
   * A hand-built test party, or null to fall back to `devLevel`/the real save.
   *
   * Outranks `devLevel` because it is strictly more specific: it names who is
   * on the team AND what level each of them is, where the level box only ever
   * said "everyone, at this level".
   */
  const [devParty, setDevParty] = useState<DevMember[] | null>(null);
  const [rosterOpen, setRosterOpen] = useState(false);
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
  /** A hovered innate passive, shown in the same slot as an ability's rules. */
  const [previewPassive, setPreviewPassive] = useState<Passive | null>(null);
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
  const party = useMemo(() => {
    if (devParty) return buildParty(devParty);
    if (devLevel === null) return basePartyProp;
    return ROSTER.slice(0, 5).map((d) => applyLevel(d, devLevel));
  }, [devParty, devLevel, basePartyProp]);

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

  /**
   * Dice subsets that pay for an ability.
   *
   * The filtering for spent and blank dice used to live here; it is inside
   * `payingMasks` now, because "a mask may only name dice you can spend" is a
   * property of the pool rather than of whoever is asking it.
   */
  function masksFor(ability: Ability, unit = sel.unit): number[] {
    return payingMasks(battle.dice, ability, unit?.freeCast);
  }

  /**
   * Who lent a die, by name. The pool stores a character id; the tray says
   * "Benjamin", because an id on a tooltip is a leak rather than a label.
   */
  const sourceName = (id: string): string =>
    battle.units.find((u) => u.def.id === id)?.def.name ?? id;

  /** The value of a die by id -- 0 for a blank, and for one that has gone. */
  const dieValue = (id: string): number => battle.dice.find((d) => d.id === id)?.value ?? 0;
  const pickedSum = (): number => sel.dice.reduce((n, id) => n + dieValue(id), 0);

  /** Could SOME subset of this roll pay for it? Greys out what is impossible. */
  const affordable = useMemo(() => {
    const out = new Map<string, boolean>();
    if (!sel.unit || sel.unit.side !== 'player') return out;
    for (const a of sel.unit.def.abilities) out.set(a.name, masksFor(a).length > 0);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel.unit, battle.turn, battle.phase, battle.dice, battle.dice.map((d) => `${d.id}:${d.value}:${d.spent}`).join()]);

  /**
   * Abilities the dice in hand pay for EXACTLY -- the gate that makes dice the
   * only route to an action. A different question from `affordable`.
   */
  const matched = useMemo(() => {
    const out = new Set<string>();
    if (!sel.unit || sel.unit.side !== 'player' || sel.dice.length === 0) return out;
    const sum = pickedSum();
    for (const a of sel.unit.def.abilities) {
      if (!(affordable.get(a.name) ?? false)) continue;
      if (paysAsWildcard(a, sel.unit.freeCast) ? sel.dice.length === 1 : sum === a.cost)
        out.add(a.name);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel.unit, sel.dice, affordable, battle.turn, battle.phase]);

  const diceCover = (cost: number): boolean => sel.dice.length > 0 && pickedSum() === cost;

  // ------------------------------------------------------------- target sets

  /** Slots the chosen ability may legally be aimed at. */
  const targets = useMemo(() => {
    const out = new Set<string>();
    if (!sel.unit || !sel.ability || over) return out;
    // A slot ability is aimed at SQUARES, not at bodies -- the empty ones are
    // the whole point of it -- so its candidates are the board rather than the
    // units standing on it.
    if ((sel.ability.scope ?? 'one') === 'slot') {
      for (const sl of PARTY_SLOTS_ALL) {
        const at = { x: sl.col, y: sl.row };
        if (canTarget(sel.ability, sel.unit, at, battle.units)) out.add(pk(at));
      }
      // Standing still is not a move; offering it as a target invites spending
      // a die on nothing.
      out.delete(pk(sel.unit.pos));
      return out;
    }
    const pool = livingOf(battle, sel.ability.kind === 'attack'
      ? (sel.unit.side === 'player' ? 'enemy' : 'player')
      : sel.unit.side);
    for (const u of pool) {
      if (canTarget(sel.ability, sel.unit, u.pos, battle.units)) out.add(pk(u.pos));
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel.unit, sel.ability, battle.turn, battle.phase, over, battle.units.map((u) => pk(u.pos)).join()]);

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
  }, [devLevel, devParty]);

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
  function playDiceRoll(pool: Die[]) {
    stopDiceRoll();
    const STAGGER = 170;
    const SPIN = 500;
    // Tumble through the die's OWN faces, so a die with blanks is visibly a
    // different die while it is in the air rather than only once it lands.
    const faces = pool.map((d) => d.spec.faces);
    const values = pool.map((d) => d.value);

    setRoll(values.map(() => ({ phase: 'pending' as const, face: 1 })));
    rollInterval.current = window.setInterval(() => {
      setRoll(
        (prev) =>
          prev &&
          prev.map((d, i) => {
            if (d.phase !== 'tumbling') return d;
            const f = faces[i] ?? [1, 2, 3, 4, 5, 6];
            return { ...d, face: f[Math.floor(Math.random() * f.length)] ?? 1 };
          }),
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
        side: c.unit.side,
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

  function toggleDie(id: string) {
    const die = battle.dice.find((d) => d.id === id);
    // A blank is not a small die, it is an absent one: it can never be picked,
    // on a wildcard or on a sum.
    if (!die || die.spent || die.value === 0 || busy || over) return;
    // Updater form: several toggles can land in one React batch, and reading the
    // closed-over selection would make all but the first compute from stale dice.
    setSel((s) => ({
      ...s,
      dice: s.dice.includes(id) ? s.dice.filter((d) => d !== id) : [...s.dice, id],
      // A chosen ability can never survive a die toggle -- a die is worth at
      // least 1, so adding or removing one always shifts the total, and a
      // wildcard needs exactly one die so it always moves off that count.
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
  const fireAt = (target: Unit) => aimAt(target.pos);

  /**
   * Queue the chosen ability at a POSITION.
   *
   * Taking a slot rather than a unit is what lets an empty square be a target.
   * Every other ability reaches this through `fireAt` with the occupant's own
   * position, so the two paths cannot disagree about what "aiming here" means.
   */
  function aimAt(at: Pos) {
    if (!sel.unit || !sel.ability || busy || over) return;
    if (!targets.has(pk(at))) return;

    const err = planAction(battle, sel.unit, sel.ability, sel.dice, at);
    if (err) setError(err);
    else {
      // The unit stays selected; only the spent dice and the chosen ability go.
      // Emptying the sheet the instant an action was queued blanked the panel
      // mid-turn, which is the same complaint as blanking it on commit -- and
      // it is why there was never anything left for the commit to preserve.
      setSel((prev) => ({ unit: prev.unit, ability: null, dice: [] }));
      setPreviewPassive(null);
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
      setSel((prev) => ({ unit: prev.unit, ability: null, dice: [] }));
      setPreview(null);
      setPreviewPassive(null);
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
    // Keep whoever is selected, drop only what the commit consumes.
    //
    // The dice and the chosen ability are genuinely spent, so they go. The UNIT
    // is not -- clearing it emptied the sheet at the exact moment the turn was
    // resolving, so the panel went blank just as you wanted to watch what your
    // plan did to the Performer you had been reading.
    setSel((prev) => ({ unit: prev.unit, ability: null, dice: [] }));
    setError(null);
    setBusy(true);
    bump();
    playerTimer.current = window.setTimeout(stepPlan, COMMIT_LEAD_MS);
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
      enemyTimer.current = window.setTimeout(stepEnemy, HANDOVER_MS);
      return;
    }

    lunge(step.unit.def.id, step.unit.side);
    setNarration(actionLine(step.unit, step.ability, step.target, battle.units));
    bump();
    playerTimer.current = window.setTimeout(stepPlan, BEAT_MS);
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
    enemyTimer.current = window.setTimeout(stepEnemy, ENEMY_BEAT_MS);
  }

  // ------------------------------------------------------------------ derived

  /**
   * The kit, and the board action, kept apart.
   *
   * `kind: 'move'` marks an ability the BOARD grants rather than the kit --
   * `REPOSITION` is injected into every player character and authored on none
   * of them. The sheet splits them for the same reason: four authored
   * abilities is what a Performer is, and a universal action listed among them
   * reads as a fifth thing they chose.
   */
  const kitAbilities = useMemo(
    () => (sel.unit?.def.abilities ?? []).filter((a) => a.kind !== 'move'),
    [sel.unit],
  );
  const boardAction = useMemo(
    () => (sel.unit?.def.abilities ?? []).find((a) => a.kind === 'move'),
    [sel.unit],
  );

  /**
   * The ability being aimed, when it is an attack that the element wheel
   * applies to.
   *
   * An ability with no element is not neutral -- the elemental layer simply
   * does not apply to it -- so Benjamin's whole kit correctly shows no matchup
   * markers at all rather than a row of zeroes.
   */
  const aiming =
    sel.ability && sel.ability.kind === 'attack' && sel.ability.element ? sel.ability : null;

  const diceSum = pickedSum();
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
  /** Whether the selected Performer can still be given an action this round. */
  const canAct =
    !!sel.unit &&
    sel.unit.side === 'player' &&
    !sel.unit.hasActed &&
    !isPlanned(battle, sel.unit) &&
    !over;
  // Recomputed on every plan change, which is what makes reordering legible:
  // move an action above its arming symbol and its chain marker goes out.
  const chained = chainPreview(battle.plan, battle.armed);
  const nextTier =
    sel.unit && sel.unit.side === 'player' ? (sel.unit.def.upgrades ?? [])[sel.unit.upgrades] : undefined;
  const upgradeMasks = nextTier ? masksFor({ cost: nextTier.cost } as Ability) : [];
  const upgradeReady = nextTier != null && upgradeMasks.length > 0 && diceCover(nextTier.cost);

  const hoveredUnit = hover ? battle.units.find((u) => alive(u) && pk(u.pos) === pk(hover)) : undefined;

  return (
    <div className="game battle">
      <style>{IDLE_KEYFRAMES}</style>
      <div className="stage" style={{ backgroundImage: `url(${encounter.background})` }}>
        {/* `moving` is aiming-at-SLOTS, which needs the floor readable and
            clickable in a way aiming at bodies does not. */}
        <div
          className={`stage-frame ${sel.ability ? 'aiming' : ''} ${
            sel.ability && (sel.ability.scope ?? 'one') === 'slot' ? 'moving' : ''
          }`}
        >
        {/*
          Empty squares of the party's 3x3, drawn ONLY while a reposition is
          being aimed.
          
          Permanently visible footprints would turn the stage into a board and
          the backdrop is a painted theatre, not a battlemap -- and the four
          gaps are ordinary scenery every other turn. They appear exactly when
          they become clickable, which is also when the player needs to see the
          shape of the grid they are moving inside.
        */}
        {sel.ability && (sel.ability.scope ?? 'one') === 'slot' &&
          PARTY_SLOTS_ALL.filter(
            (sl) => !battle.units.some((u) => alive(u) && u.side === 'player' && u.pos.x === sl.col && u.pos.y === sl.row),
          ).map((sl) => {
            const at = { x: sl.col, y: sl.row };
            const key = pk(at);
            if (!targets.has(key)) return null;
            return (
              <button
                key={`slot-${key}`}
                className="open-slot"
                title={`Move ${sel.unit!.def.name} here`}
                /*
                  No `zIndex` here, deliberately. It was set inline the way a
                  unit's is -- painter's order by depth -- and an inline style
                  beats the stylesheet, so the `z-index: 250` meant to lift
                  every footprint over every sprite never applied and they sat
                  at 161-183, among the units. Depth ordering is wrong for these
                  anyway: a footprint is a marker, not a body, and it has to be
                  visible over whoever is standing in front of it.
                */
                style={{ left: `${sl.xPct * 100}%`, top: `${sl.yPct * 100}%` }}
                onMouseEnter={() => setHover(at)}
                onMouseLeave={() => setHover(null)}
                onClick={() => aimAt(at)}
              />
            );
          })}

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
            const slot = slotAt(u.pos, 'enemy', encounter);
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

        {/* Escalation, called out on the creature itself.
            The ramp is not random, but BATTLE_DESIGN's rule that a fight must
            be plannable applies to it all the same: a boss quietly doubling its
            damage is indistinguishable from the numbers being broken. Shown in
            BOTH phases, unlike intent -- it is the one number that is still
            true while the enemies are resolving.

            Stacked above the intent die in ONE column per creature rather than
            placed individually. Two badges anchored to the same point is two
            badges on top of each other the first time a ramping boss is also
            aimed at, and "usually they do not coincide" is not a layout. */}
        {battle.units.filter(alive).map((u) => {
          const slot = slotAt(u.pos, u.side, encounter);
          if (!slot) return null;
          const enemy = u.side === 'enemy';
          const mult = enemy ? rampMultiplier(u.def, battle.turn) : 1;
          // The matchup is aiming-time information: it answers "which of these
          // should I point this at", so it is shown only while there is
          // something to point, and only on the ones that can be reached.
          const aimed =
            enemy && aiming && aiming.element && targets.has(pk(u.pos))
              ? elementResistance(u, aiming.element)
              : null;
          const st = u.statuses;
          // `aimed` of 0 is a real answer -- neutral -- and it is the answer
          // that gets NO badge, so an empty marker column must not be left
          // behind for it.
          const shows =
            mult > 1 || (aimed !== null && aimed !== 0) || st.frost > 0 || st.frozen > 0 || st.asleep;
          if (!shows) return null;
          return (
            <span
              key={`marks-${u.def.id}`}
              className="unit-marks"
              style={{ left: `${slot.xPct * 100}%`, top: `${slot.yPct * 100}%` }}
            >
              {mult > 1 && (
                <span
                  className="escalation"
                  title={`${u.def.name} is escalating: ${Math.round((mult - 1) * 100)}% more damage`}
                >
                  ×{mult.toFixed(2)}
                </span>
              )}
              {aimed !== null && aimed !== 0 && (
                <span
                  className={`matchup ${aimed < 0 ? 'weak' : 'resists'}`}
                  title={`${u.def.name} — ${matchupLabel(aimed)} against ${aiming!.element}`}
                >
                  <span className="glyph">
                    <ElementIcon element={aiming!.element!} size={11} />
                  </span>
                  {aimed <= -100
                    ? '×2+'
                    : aimed >= RESIST_CAP
                      ? 'immune'
                      : `${aimed < 0 ? '+' : '−'}${Math.abs(aimed)}%`}
                </span>
              )}
              {/*
                Frost, on the creature. It was on the roster row only, which is
                the one place it could not do its job: the design rests on the
                count and the bar being visible so freezing is a decision made
                BEFORE the dice are spent, and a number in a side panel is not
                competing on equal terms with the intent die drawn at the
                creature's feet.

                On both sides, unlike everything above it. Nothing frosts the
                party yet, but `frost` is a status like any other and a party
                that could not see its own would be a bug waiting for the first
                enemy that applies it. Sleep is already player-side today --
                Rebar puts himself under.
              */}
              {st.frozen > 0 ? (
                <span className="status-mark frozen" title={`${u.def.name} is frozen — loses its next action`}>
                  ❄ frozen
                </span>
              ) : (
                st.frost > 0 && (
                  <span
                    className="status-mark frost"
                    title={`${u.def.name}: ${st.frost} frost of ${freezeThreshold(u)}. Reaching the bar freezes them, spends the stacks and raises it.`}
                  >
                    ❄ {st.frost}/{freezeThreshold(u)}
                  </span>
                )
              )}
              {st.asleep && (
                <span className="status-mark asleep" title={`${u.def.name} is asleep — any damage wakes them`}>
                  ☾ asleep
                </span>
              )}
            </span>
          );
        })}

        {floaters.map((f) => {
          const slot = slotAt(f.at, f.side, encounter);
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
              <button className={devParty ? 'primary' : ''} onClick={() => setRosterOpen(true)}>
                {devParty ? `Party (${devParty.length})` : 'Party'}
              </button>
              <button onClick={() => setShowLog(true)}>Show log</button>
              <button onClick={() => restart(seed)}>Restart</button>
              <button onClick={() => restart(Math.floor(Math.random() * 100000))}>New seed</button>
            </>
          )}
        </div>
      </div>

      {/* The two rosters flank the stage, in the darkened surround either side of
          the letterboxed backdrop -- space that was otherwise doing nothing,
          and which puts each side's list on that side's half of the board. */}
      <div className="hud hud-party">
        <TeamPanel title={`Your team (${livingOf(battle, 'player').length}/${players.length})`}
          units={players} selected={sel.unit} onSelect={selectUnit} />
      </div>

      <div className="hud hud-foes">
        <TeamPanel title={`Enemies (${livingOf(battle, 'enemy').length}/${enemies.length})`}
          units={enemies} selected={sel.unit} onSelect={selectUnit} />
      </div>

      <div className="hud hud-right">
        {!sel.unit && (
          // The band is the widest thing in the dock and it is empty until
          // something is picked. Saying so beats leaving what reads as a
          // rendering fault.
          <div className="panel detail-empty">
            <span>Select a Performer or an enemy to see their sheet.</span>
          </div>
        )}
        {sel.unit && (
          <div className="panel detail">
            {/* Three deliberate sections rather than one flat list.
                They used to flow through a multi-column box, which split the
                ability list across columns and stranded the turn badge at the
                top of a column away from the stats it belongs with -- the
                layout was deciding what grouped with what, and it had no idea. */}
            <div className="sheet-id">
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
              <span>ATK {stat(unitAttack(sel.unit))}</span>
              <span>P.DEF {stat(effectiveDefense(sel.unit, 'physical'))}</span>
              <span>M.DEF {stat(effectiveDefense(sel.unit, 'magical'))}</span>
              {sel.unit.upgrades > 0 && (
                <span className="boosted">+{Math.round((statScale(sel.unit) - 1) * 100)}%</span>
              )}
            </div>
            <div className="terrain-note">
              {ROLE_LABEL[sel.unit.def.role]} · {elementsOf(sel.unit.def).join('/')} ·{' '}
              {rankLabel(sel.unit, battle)}
            </div>
            {sel.unit.def.ramp && (
              <div className="ramp-note">
                <strong>Escalation</strong> · +{sel.unit.def.ramp.percent}% damage each turn past
                turn {sel.unit.def.ramp.after} · now{' '}
                <em>×{rampMultiplier(sel.unit.def, battle.turn).toFixed(2)}</em>
              </div>
            )}

            {/*
              What this unit takes MORE and LESS of, for allies and enemies
              alike. Resistance is a signed percentage on the sheet -- negative
              is weak, positive is resistant -- so both lists come from one
              field and the sign decides which side it lands on.

              Shown even when empty: "no elemental weakness" is a real property
              here rather than missing data. Benjamin is deliberately unaligned,
              and a blank space would read as the panel failing to load rather
              than as the answer.
            */}
            <div className="matchups">
              {(() => {
                const entries = Object.entries(sel.unit!.def.resistances ?? {}) as [Element, number][];
                const weak = entries.filter(([, v]) => v < 0).sort((a, b) => a[1] - b[1]);
                const resist = entries.filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
                if (!weak.length && !resist.length) {
                  return <span className="dim">no elemental weakness or resistance</span>;
                }
                const row = (label: string, list: [Element, number][], cls: string) =>
                  list.length > 0 && (
                    <div className={`matchup-row ${cls}`}>
                      <span className="lbl">{label}</span>
                      {list.map(([el, v]) => (
                        // The glyph carries the element, the number the size of
                        // it. `title` keeps the name reachable for anyone who
                        // does not read the shape at a glance.
                        <span
                          key={el}
                          className="chip"
                          style={{ borderColor: ELEMENT_COLOR[el] }}
                          title={`${el} — ${v < 0 ? `takes ${-v}% more` : `takes ${v}% less`}`}
                        >
                          <span className="glyph" style={{ color: ELEMENT_COLOR[el] }}>
                            <ElementIcon element={el} />
                          </span>
                          <em>{v < 0 ? `+${-v}%` : `−${v}%`}</em>
                        </span>
                      ))}
                    </div>
                  );
                return (
                  <>
                    {row('weak', weak, 'weak')}
                    {row('resists', resist, 'resist')}
                  </>
                );
              })()}
            </div>

            {/*
              The innate passive sits with IDENTITY, not with the upgrade tiers:
              it is what the Performer is for, and it is true before any dice are
              spent. Name only -- the rules go to the inspect slot on hover, the
              same place an ability's do, so the sheet stays a list of names and
              one panel explains whichever you are pointing at.
            */}
            {(sel.unit.def.passives ?? []).map((pas) => (
              <button
                key={pas.name ?? pas.kind}
                className={`passive-chip ${previewPassive === pas ? 'on' : ''}`}
                onMouseEnter={() => setPreviewPassive(pas)}
                onMouseLeave={() => setPreviewPassive(null)}
                onFocus={() => setPreviewPassive(pas)}
                onBlur={() => setPreviewPassive(null)}
              >
                <span className="tag">passive</span>
                <strong>{pas.name ?? pas.kind}</strong>
              </button>
            ))}

            {/*
              REPOSITION is a chip beside the passive, not a fifth ability.
              
              Two reasons, and the layout one is the smaller. It is a rule of
              the BOARD rather than a thing this kit chose -- every Performer
              has it, none of them authored it -- so listing it among four
              authored abilities said it was part of the kit, which is the one
              thing it is not. And a five-row ability list did not fit the band,
              so the panel scrolled: the fix and the correct structure happened
              to be the same move.
            */}
            {boardAction && sel.unit.side === 'player' && (
              <button
                className={`board-chip ${sel.ability === boardAction ? 'on' : ''} ${
                  matched.has(boardAction.name) ? 'ready' : ''
                }`}
                disabled={!canAct || !matched.has(boardAction.name)}
                onClick={() => chooseAbility(boardAction)}
                onMouseEnter={() => setPreview(boardAction)}
                onMouseLeave={() => setPreview(null)}
                onFocus={() => setPreview(boardAction)}
                onBlur={() => setPreview(null)}
                title={
                  !canAct
                    ? `${sel.unit.def.name} is not acting again this round`
                    : matched.has(boardAction.name)
                      ? 'Choose a slot to step into'
                      : 'Select any single die'
                }
              >
                <span className="tag">✳ move</span>
                <strong>{boardAction.name}</strong>
              </button>
            )}

            </div>

            <div className="sheet-kit">
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

            {/*
              Always shown, even while the Performer's action is queued or
              already resolved. The kit is a description of the character, not a
              menu that only exists when it can be used -- hiding it emptied the
              widest part of the sheet at the moment the turn was playing out,
              which is exactly when you want to read what they can do.

              `inert` says they cannot be clicked right now. The buttons were
              disabled anyway -- `ready` needs dice selected for this unit, and a
              committed one has none -- so this is about how they READ.
            */}
            {sel.unit.side === 'player' && (
              <ul className={`abilities ${canAct ? '' : 'inert'}`}>
                {kitAbilities.map((a) => {
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
                        className={`ability ${!canAct || ok ? '' : 'locked'} ${active ? 'active' : ''} ${ready ? 'ready' : ''}`}
                        onClick={() => chooseAbility(a)}
                        disabled={!canAct || !ready}
                        title={
                          !canAct
                            ? `${sel.unit!.def.name} is not acting again this round`
                            : !ok
                              ? `No dice in this roll can total ${a.cost}`
                              : !ready
                                ? paysAsWildcard(a, sel.unit!.freeCast)
                                  ? 'Select any single die'
                                  : `Select dice totalling ${a.cost}`
                                : undefined
                        }
                      >
                        {/* A charge that makes this cast free shows AS a
                            wildcard, because that is what it is for this one
                            cast -- printing the sheet's 7 beside a die the
                            player can actually pay with would read as a bug. */}
                        <span
                          className={`cost${!a.wildcard && paysAsWildcard(a, sel.unit!.freeCast) ? ' charged' : ''}`}
                        >
                          {paysAsWildcard(a, sel.unit!.freeCast) ? '✳' : a.cost}
                        </span>
                        <span className="body">
                          <strong>
                            {a.name}
                            {/* On the row itself, because "which two of these
                                four chain together" is a question about the KIT
                                and cannot be answered by hovering one of them. */}
                            {a.symbol && (
                              <em className={`sym ${a.trigger ? 'has-trigger' : ''}`} title={describeChain(a) ?? ''}>
                                <SymbolIcon symbol={a.symbol} size={13} />
                              </em>
                            )}
                          </strong>
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

            </div>

            <div className="sheet-extra">
            {/*
              A Performer's innate passive is shown as a NAMED CHIP up in the
              identity block, not as a row here. Two reasons it does not live in
              this column: it is not something you buy, and `activePassives`
              also returns the passives bought upgrades granted -- listing those
              printed every purchase twice under two different names (Aethis
              bought "Herbalist" and grew a second entry called "regen" doing
              exactly the same thing).
            */}

            {sel.unit.side === 'player' && !over && (
              <div className="upgrades">
                <div className="upgrade-track">
                  {(sel.unit.def.upgrades ?? []).map((t, i) => (
                    <span key={t.name} className={`pip-tier ${i < sel.unit!.upgrades ? 'on' : ''}`} title={t.name} />
                  ))}
                  <span className="dim">upgrades</span>
                </div>

                {/*
                  Every tier, always -- bought ones lit, the next one live, the
                  rest dimmed. Showing only the next tier hid what the track was
                  FOR: the pips said "three of these exist" and nothing said what
                  the other two were, so the choice to spend 6 now or hold for 12
                  could not be made from the panel it is made in.
                */}
                {(sel.unit.def.upgrades ?? []).map((tier, i) => {
                  const bought = i < sel.unit!.upgrades;
                  const isNext = i === sel.unit!.upgrades;
                  const payable = isNext && upgradeMasks.length > 0;
                  return (
                    <button
                      key={tier.name}
                      className={[
                        'upgrade-btn',
                        bought ? 'bought' : '',
                        isNext ? 'next' : '',
                        isNext && upgradeReady ? 'ready' : '',
                        isNext && !payable ? 'locked' : '',
                        !bought && !isNext ? 'future' : '',
                      ].filter(Boolean).join(' ')}
                      onClick={handleUpgrade}
                      disabled={
                        !isNext || sel.unit!.hasActed || isPlanned(battle, sel.unit!) || !upgradeReady
                      }
                      title={
                        bought
                          ? 'Already bought'
                          : !isNext
                            ? 'Buy the earlier tiers first'
                            : !payable
                              ? `No dice combination totals ${tier.cost}`
                              : !upgradeReady
                                ? `Select dice totalling ${tier.cost}`
                                : undefined
                      }
                    >
                      <span className="cost">{bought ? '✓' : tier.cost}</span>
                      <span className="body">
                        <strong>{tier.name}</strong>
                        <em>+10% stats · {describePassive(tier.passive)}</em>
                      </span>
                    </button>
                  );
                })}
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
            </div>
          </div>
        )}

        {/*
          The hovered ability's rules sit OUTSIDE `.detail`, in a slot of their
          own. Inside it they were items in a multi-column flow, so hovering
          inserted a block and the browser rebalanced every column -- the whole
          kit jumped, and the panel changed height, on every pointer move across
          the ability list. A sibling of fixed width cannot disturb what it sits
          beside.

          Rendered whether or not anything is hovered, for the same reason: a
          slot that appears and disappears is just a slower version of the same
          jump.
        */}
        {sel.unit && (
          <div className="panel inspect">
            {previewPassive ? (
              <div className="rules">
                <strong>{previewPassive.name ?? previewPassive.kind}</strong>
                <p className="sub">Passive — always on</p>
                <p>{describePassive(previewPassive)}</p>
              </div>
            ) : shownAbility ? (
              <div className="rules">
                <strong>{shownAbility.name}</strong>
                <p>{describeAbility(shownAbility)}</p>
                <p className="sub">{describeCost(shownAbility)}</p>
                {describeElement(shownAbility) && <p className="sub">{describeElement(shownAbility)}</p>}
                {/*
                  The MARK, not a sentence about the mark. A symbol is pure
                  identity -- it does nothing, it matches -- so the shape states
                  the whole rule and the only text worth keeping is what THIS
                  ability does differently when it chains.
                */}
                {shownAbility.symbol && (
                  <p className="sub chain">
                    <SymbolIcon symbol={shownAbility.symbol} />
                    {shownAbility.trigger && (
                      <span>
                        <strong>Chained:</strong> {shownAbility.trigger.text}.
                      </span>
                    )}
                  </p>
                )}
              </div>
            ) : (
              <p className="inspect-hint">Hover an ability or passive for its rules.</p>
            )}

            {sel.ability && hoveredUnit && targets.has(pk(hoveredUnit.pos)) && (
              <ForecastPanel battle={battle} source={sel.unit} ability={sel.ability} centre={hoveredUnit.pos} />
            )}
          </div>
        )}
      </div>

      {/* The turn's own voice, over the stage rather than in the dock.
          It belongs with the action it describes, and the dock is where you
          read numbers rather than watch. Only mounted while something is being
          said -- it overlays the apron, which is empty floor, so there is
          nothing to reserve space for. */}
      {narration && (
        <div className="hud hud-narration">
          <div className="narration">{narration}</div>
        </div>
      )}

      <div className="hud hud-bottom">

        <div className="panel tray">
          {battle.phase === 'player' && !busy ? (
            <DiceTray
              dice={battle.dice}
              selected={sel.dice}
              onToggle={toggleDie}
              disabled={over}
              roll={roll}
              nameFor={sourceName}
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
                <li key={`${entry.unit.def.id}-${i}`} className={chained[i] ? 'chains' : ''}>
                  <span className="ord">{i + 1}</span>
                  <span className="who">{entry.unit.def.name}</span>
                  <span className="what">
                    {entry.ability?.name ?? 'Upgrade'}
                    {/* The symbol is on every carrier, lit only where it fires.
                        Showing it on the arming action too is what makes the
                        reorder buttons legible -- you can see WHY moving this
                        above that one turns the chain on. */}
                    {entry.ability?.symbol && (
                      <em className={`sym ${chained[i] ? 'on' : ''}`} title={describeChain(entry.ability) ?? ''}>
                        <SymbolIcon symbol={entry.ability.symbol} size={13} />
                      </em>
                    )}
                  </span>
                  {chained[i] && <span className="trigger">{entry.ability!.trigger!.text}</span>}
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
                  <strong>
                    {paysAsWildcard(sel.ability, sel.unit?.freeCast)
                      ? '1 die'
                      : `${diceSum} / ${sel.ability.cost}`}
                  </strong>
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

      {rosterOpen && devMode && (
        <RosterPanel
          current={devParty}
          onApply={setDevParty}
          onClose={() => setRosterOpen(false)}
        />
      )}
    </div>
  );
}

/**
 * Which slot a unit is standing in, matched by its formation coordinates.
 *
 * The party is looked up in the WHOLE 3x3, never in the encounter's list.
 * `encounter.partySlots` is a FILL order -- seven of the nine, the ones units
 * deploy into -- so a Performer who repositioned into either of the other two
 * found no slot and rendered as nothing. Two of the nine squares made you
 * vanish, which is the sort of bug a fill list masquerading as a board causes.
 */
function slotFor(u: Unit, _partySlots: Slot[], enemySlots: Slot[], _units: Unit[]): Slot | undefined {
  const pool = u.side === 'player' ? PARTY_SLOTS_ALL : enemySlots;
  return pool.find((s) => s.col === u.pos.x && s.row === u.pos.y);
}

/**
 * Where a position is DRAWN -- which needs to know whose board it is on.
 *
 * `Pos` is not unique across the stage: the party occupies columns 0-2 and the
 * enemy block 2-4, so **column 2 is both the party's front rank and the
 * enemy's**. That overlap is fine for the rules, which only ever ask about one
 * side at a time (`withinReach` computes the defender's side first), and it is
 * exactly wrong for a renderer, which is asking "where on the stage".
 *
 * Searching the party first and taking the first match therefore drew every
 * col-2 ENEMY at a party slot: the front two enemies' intent dice appeared
 * under the front two Performers.
 */
function slotAt(p: Pos, side: Side, enc: { partySlots: Slot[]; enemySlots: Slot[] }): Slot | undefined {
  const pool = side === 'player' ? PARTY_SLOTS_ALL : enc.enemySlots;
  return pool.find((s) => s.col === p.x && s.row === p.y);
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
      // The SNAP STEP, not the file height: for art drawn on a larger canvas
      // those differ, and stepping by the file height rounds it to nothing.
      // The strip and the still share a step, since both are that actor's art.
      sheet.snapPx,
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

/**
 * The pool, as buttons.
 *
 * Three states a die can be in that all read as "not available", and they are
 * deliberately drawn differently: SPENT is promised to something in the queue
 * and can be got back by unqueueing it, BLANK is a face this die actually
 * rolled and nothing will change it this turn, and a CONTRIBUTED die is
 * available but belongs to somebody -- if that Performer falls it is not here
 * next turn. One grey for all three would hide the only one the player can act
 * on.
 */
function DiceTray({
  dice,
  selected,
  onToggle,
  disabled,
  roll,
  nameFor,
}: {
  dice: Die[];
  selected: string[];
  onToggle: (id: string) => void;
  disabled: boolean;
  roll: { phase: 'pending' | 'tumbling' | 'settled'; face: number }[] | null;
  nameFor: (id: string) => string;
}) {
  return (
    <div className="dice">
      {dice.map((die, i) => {
        const anim = roll?.[i];
        // While a die is in the air it shows a random face, not its real value.
        const face = anim && anim.phase !== 'settled' ? anim.face : die.value;
        const locked = anim !== undefined && anim.phase !== 'settled';
        const blank = die.value === 0;
        const settled = !anim || anim.phase === 'settled';
        const classes = [
          'die',
          die.spent ? 'spent' : '',
          selected.includes(die.id) ? 'picked' : '',
          die.source ? 'contributed' : '',
          blank && settled ? 'blank' : '',
          altered(die) ? 'altered' : '',
          anim ? anim.phase : '',
        ];
        const who = die.source ? nameFor(die.source) : null;
        return (
          <button
            key={die.id}
            className={classes.filter(Boolean).join(' ')}
            onClick={() => onToggle(die.id)}
            disabled={disabled || die.spent || locked || blank}
            title={
              who
                ? `${die.spec.label} — ${who}. ${describeDie(die.spec)}.` +
                  (blank && settled ? ' Rolled a blank this turn.' : '')
                : `${describeDie(die.spec)}.`
            }
          >
            <span className="pip">{blank && settled ? '·' : DIE_PIPS[face]}</span>
            <span className="val">
              {!settled ? ' ' : blank ? '—' : die.value}
            </span>
            {altered(die) && settled && <span className="was">{die.rolled}</span>}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Frost, freeze and sleep, in the smallest form that still says the thing.
 *
 * A status the player cannot see is a status they cannot plan around, and
 * frost in particular is a running total they are spending dice to move -- so
 * it shows the count AND the bar it is counting toward. `3/6` is a decision;
 * a snowflake is decoration.
 */
function StatusChips({ u }: { u: Unit }) {
  if (!alive(u)) return null;
  return (
    <>
      {u.statuses.frozen > 0 && (
        <span className="chip frozen" title="Frozen — loses its next action">
          ✻
        </span>
      )}
      {u.statuses.asleep && (
        <span className="chip asleep" title="Asleep until damaged">
          z
        </span>
      )}
      {u.statuses.frost > 0 && (
        <span
          className="chip frost"
          title={`Frost ${u.statuses.frost} of ${freezeThreshold(u)} — freezes at the threshold, which then rises`}
        >
          {u.statuses.frost}/{freezeThreshold(u)}
        </span>
      )}
    </>
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
              <StatusChips u={u} />
              {/* Level, on both sides. The enemy's is the whole reason to show
                  it -- how far ahead or behind the stage is running is the
                  first thing you want to know, and it was previously only
                  inferable from the stat line in the detail panel. */}
              <span className="lv">Lv {levelOf(u.def)}</span>
              <span className="hp">
                {alive(u) ? `${u.hp}/${unitMaxHp(u)}` : 'down'}
                {/* Net attack modifier, buffs and shreds together, so a row
                    says at a glance whether this unit is currently running hot
                    or has been cut down. */}
                {modifierTotal(u, 'attack') !== 0 && (
                  <span className={modifierTotal(u, 'attack') > 0 ? 'buff' : 'shred'}>
                    {' '}
                    {modifierTotal(u, 'attack') > 0 ? '+' : ''}
                    {stat(modifierTotal(u, 'attack'))}
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
          const dmg = computeDamage(source, ability, t, pool);
          const lethal = dmg >= t.hp;
          return (
            <div key={t.def.id} className={lethal ? 'line lethal' : 'line'}>
              {t.def.name} <strong>-{dmg}</strong>
              {lethal ? ' (lethal)' : ` → ${t.hp - dmg} hp`}
            </div>
          );
        }
        if (ability.kind === 'heal') {
          // Was reading the ability's POWER -- a multiplier on ATK -- as if it
          // were an HP amount. At the old scale that printed a plausible number
          // and nobody caught it; at this one it printed "+0.63".
          // Reads the effect list when there is one, so the forecast is the number
          // the engine will actually apply rather than a second guess at it.
          const heal = (ability.effects ?? []).find((f) => f.do === 'heal');
          const amt = Math.min(
            heal ? computeHeal(source, heal.power, heal.of, t) : computeHeal(source, ability.power),
            unitMaxHp(t) - t.hp,
          );
          return (
            <div key={t.def.id} className="line heal">
              {t.def.name} <strong>+{amt}</strong>
            </div>
          );
        }
        return (
          <div key={t.def.id} className="line buff">
            {t.def.name} <strong>+{stat(ability.power)} atk</strong>
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
        return `      +${stat(e.amount)} atk ${e.target}`;
      case 'frost':
        return `      ❄ ${e.target} ${e.stacks}/${e.threshold} frost`;
      case 'freeze':
        return `      ❄ ${e.target} FROZEN (spent ${e.spent}; next freeze costs ${e.nextThreshold})`;
      case 'shatter':
        return `      ❄ ${e.target} shatters — ${e.stacks} frost into ${e.amount} damage`;
      case 'sleep':
        return `      ☾ ${e.unit} sleeps`;
      case 'wake':
        return `      ☾ ${e.unit} wakes`;
      case 'move':
        return `      ${e.unit} steps to rank ${e.to.x}, row ${e.to.y}`;
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

/**
 * Dev-only party builder.
 *
 * Testing a composition means fielding exactly the Performers you want at
 * exactly the levels you want, which through the real game means grinding to
 * it. This is the shortcut, and saving is what keeps it from having to be
 * redone after every reload.
 *
 * The working set is local state so that half-built parties are never written
 * to storage; only Save commits, and only Apply reaches the battle.
 */
/** Battle line-up size. The party slots are the authority on it. */
const PARTY_SIZE = STANDARD_PARTY_SLOTS.length;

function RosterPanel({
  current,
  onApply,
  onClose,
}: {
  current: DevMember[] | null;
  onApply: (members: DevMember[] | null) => void;
  onClose: () => void;
}) {
  const saved = useDevRosters();
  const [members, setMembers] = useState<DevMember[]>(
    () => current ?? ROSTER.slice(0, 5).map((d) => ({ id: d.id, level: 1, stars: 0 })),
  );
  const [name, setName] = useState('');

  const picked = (id: string) => members.find((m) => m.id === id);
  const full = members.length >= PARTY_SIZE;

  function toggle(id: string) {
    setMembers((prev) =>
      prev.some((m) => m.id === id)
        ? prev.filter((m) => m.id !== id)
        : prev.length >= PARTY_SIZE
          ? prev
          : [...prev, { id, level: 1, stars: 0 }],
    );
  }

  const edit = (id: string, patch: Partial<DevMember>) =>
    setMembers((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));

  /** Applied to every SELECTED member, which is the common case when sweeping
      a stage for the level it becomes winnable at. */
  const setAll = (patch: Partial<DevMember>) =>
    setMembers((prev) => prev.map((m) => ({ ...m, ...patch })));

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal roster-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong>Test party</strong>
          <span className="dim">
            {members.length}/{PARTY_SIZE} chosen · order is the battle line-up
          </span>
          <button onClick={onClose}>Close</button>
        </div>

        <div className="roster-pool">
          {ROSTER.map((d) => {
            const m = picked(d.id);
            return (
              <div key={d.id} className={`roster-slot ${m ? 'on' : ''}`}>
                <button
                  className="pick"
                  disabled={!m && full}
                  title={!m && full ? `Party is full (${PARTY_SIZE})` : undefined}
                  onClick={() => toggle(d.id)}
                >
                  <span className="nm">{d.name}</span>
                  <span className="dim">
                    {d.rarity}★ {d.role}
                  </span>
                </button>
                {m && (
                  <div className="tune">
                    <label>
                      lv
                      <input
                        type="number"
                        min={1}
                        max={MAX_LEVEL}
                        value={m.level}
                        onChange={(e) => edit(d.id, { level: Math.max(1, Number(e.target.value) || 1) })}
                      />
                    </label>
                    <label>
                      ★
                      <input
                        type="number"
                        min={0}
                        max={MAX_STARS}
                        value={m.stars}
                        onChange={(e) => edit(d.id, { stars: Number(e.target.value) || 0 })}
                      />
                    </label>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="roster-bulk">
          <span className="dim">all chosen →</span>
          <button onClick={() => setAll({ level: 1, stars: 0 })}>lv 1</button>
          <button onClick={() => setAll({ level: 20 })}>lv 20</button>
          <button onClick={() => setAll({ level: 40 })}>lv 40</button>
          <button onClick={() => setAll({ stars: MAX_STARS })}>5★</button>
        </div>

        <div className="roster-save">
          <input
            placeholder="roster name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && name.trim()) {
                saveRoster(name, members);
                setName('');
              }
            }}
          />
          <button
            className="primary"
            disabled={!name.trim() || members.length === 0}
            onClick={() => {
              saveRoster(name, members);
              setName('');
            }}
          >
            Save roster
          </button>
        </div>

        {saved.length > 0 && (
          <ul className="roster-saved">
            {saved.map((r) => (
              <li key={r.name}>
                <button className="load" onClick={() => setMembers(r.members.map((m) => ({ ...m })))}>
                  {r.name}
                </button>
                <span className="dim">
                  {r.members.length} · lv {r.members.map((m) => m.level).join('/')}
                </span>
                <button className="quiet" title="Delete" onClick={() => deleteRoster(r.name)}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="roster-foot">
          <button
            onClick={() => {
              onApply(null);
              onClose();
            }}
          >
            Use real save
          </button>
          <button
            className="primary"
            disabled={members.length === 0}
            onClick={() => {
              onApply(members);
              onClose();
            }}
          >
            Field this party
          </button>
        </div>
      </div>
    </div>
  );
}
