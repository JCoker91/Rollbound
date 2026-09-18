import { useEffect, useMemo, useReducer, useRef, useState, type CSSProperties } from 'react';
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
  armedAfter,
  chainFires,
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
  activePassives,
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
  DOWNSTAGE,
  PARTY_SLOTS_ALL,
  STANDARD_PARTY_SLOTS,
  type Slot,
} from '../engine/formation.ts';
import { actionLine, floaterClass, modifierGroups, type Floater } from './narrate.ts';
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
import { ANIMATION_CLIPS, EFFECTS } from '../engine/sprites.generated.ts';
import { impactTimes, type Impact } from './animationData.ts';
import { sceneActs, sceneIdForStage, sceneLayers, sceneSlots } from './sceneData.ts';
import {
  centreOn,
  clampCentre,
  FRAME_ASPECT,
  focusZoomFor,
  PUSH_ZOOM,
  REST_EYE,
  REST_ZOOM,
} from './camera.ts';
import { LayerImg } from './stageLayer.tsx';
import { crispCss } from './crisp.ts';
import {
  clipAnimName,
  clipBox,
  clipDuration,
  clipTimeline,
  abilityClipName,
  keyframesFor,
  orderFor,
  poseAnimName,
  poseKeyframes,
  stepMsFor,
  idleStances,
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

/**
 * Whether this ability actually deals damage.
 *
 * `kind` says who an ability is AIMED at, not what it does -- Kael's Challenge
 * is `kind: 'attack'` because it has to target an enemy, and it deals nothing.
 * Printing "attack · physical" beside it claims a damage type it does not have,
 * which is the same drift the generated rules text exists to prevent.
 */
const dealsDamage = (a: Ability): boolean =>
  a.effects ? a.effects.some((fx) => fx.do === 'damage') : a.kind === 'attack';

const DIE_PIPS = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

/**
 * How tall one "slot" is as a fraction of the stage, before a sprite's own scale
 * is applied. This is the single knob for how big everyone is on the battlefield
 * -- `UnitChip` derives sprite height from it exactly as the old tile grid did,
 * so the roster's relative statures carry over untouched.
 */
// Down from 0.155: the cast was filling the boards edge to edge, which left no
// stage for them to be standing on. A smaller figure on a visible set reads
// better than a large one crowding the frame.
const SLOT_H = 0.132;
/**
 * Enemies render smaller than Performers.
 *
 * Not a balance statement -- a mob is a mob. It is that the pixel bestiary is
 * drawn at a different density from the paper cast, so at one slot height the
 * Understudies loom over the party they are supposed to be trash against.
 * Comes out when the enemy art is redrawn to match.
 */
const ENEMY_SCALE = 0.78;

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
  // EVERY packed clip, not just the one the board idles with. A clip the board
  // can reach without a matching keyframe rule is worse than one it cannot
  // reach at all: the animation name resolves to nothing, so the strip sits on
  // frame 0 and the character simply stands there mid-swing with no error.
  Object.entries(ANIMATION_CLIPS).flatMap(([who, clips]) =>
    Object.entries(clips).map(([clip, info]) => ({ who, clip, frames: info.frames })),
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
/**
 * How long a Performer's turn on the boards lasts: step out, act, step back.
 *
 * Shared with `--strike-ms` in styles.css. Long enough for a 16-frame attack
 * clip to play at the pace its sheet is tuned to, with the step at either end.
 */
const STRIKE_MS = 1150;
/** How long the walk downstage takes, and the walk back. Shared with the CSS. */
const STEP_OUT_MS = 260;
const STEP_BACK_MS = 320;
// The clip plays between the two hold keyframes of `stage-strike`, which sit at
// 22% and 72%. Kept here so the derived beat leaves the clip enough of that
// window rather than the walk eating into it.
const PERFORM_WINDOW = 0.5;
/**
 * The pause at the mark, after arriving and before performing.
 *
 * Without it the swing begins the instant the feet stop, and the two motions
 * read as one continuous slither rather than as a character taking position and
 * then acting. A full second is long for a transition and deliberately so: it
 * is the moment the turn belongs to somebody, and reading who is about to do
 * what is the thing the whole staging exists for.
 *
 * It is load-bearing, not decoration -- `beatOf` builds the beat out of it, and
 * both the walk keyframes and the impact schedule are derived from that. Change
 * it and everything downstream follows.
 */
const SETTLE_MS = 1000;

/**
 * The shape of one performance: how long it runs, and when the clip starts.
 *
 * Everything that has to agree about a beat derives from HERE, because for a
 * long time the pieces each did their own arithmetic and quietly disagreed.
 * `stage-strike` walks the performer out over the first 22% and holds them at
 * the mark until 72%, and the clip is meant to play inside that hold -- but the
 * clip carried no delay, so it started on the same frame as the walk and the
 * character swung the whole way to their mark. The impacts, meanwhile, were
 * offset by the walk the clip was not waiting for, so the spark arrived long
 * after the blade.
 *
 * One function, three consumers: the `--beat` the walk runs on, the delay on
 * the clip, and the schedule the impacts fire from. They cannot drift apart
 * because there is only one of them.
 */
function beatOf(id: string, clipName: string): {
  clipMs: number;
  beat: number;
  leadIn: number;
  holdStart: number;
  holdEnd: number;
} {
  const c = ANIMATION_CLIPS[id]?.[clipName];
  const clipMs = c
    ? clipDuration(
        clipTimeline(c.frames, tuningFor(id, clipName), orderFor(id, clipName)),
        stepMsFor(id, clipName),
      )
    : 0;
  /*
   * The beat is the SUM of its parts, not a multiple of the clip.
   *
   * It used to be `clip / PERFORM_WINDOW`, which made the walk a fixed
   * PROPORTION of the beat -- so a long clip stretched the walk along with it.
   * Benjamin's retuned Quick Cut runs 1343ms, which forced a 3-second beat and
   * a 660ms glide to the mark at either end: the character appeared to drift
   * out on ice before doing anything. The walk is a walk. It takes as long as a
   * walk takes, whatever happens afterwards.
   */
  const leadIn = STEP_OUT_MS + SETTLE_MS;
  const beat = Math.max(STRIKE_MS, leadIn + clipMs + STEP_BACK_MS);
  return {
    clipMs,
    beat,
    leadIn,
    holdStart: STEP_OUT_MS / beat,
    // Where the walk home begins. Derived rather than fixed at 72%, because the
    // hold has to stretch to hold whatever clip is playing.
    holdEnd: (beat - STEP_BACK_MS) / beat,
  };
}

/**
 * `stage-strike`, generated for one beat.
 *
 * The walk-out and walk-home keyframes have to sit at real proportions of THIS
 * beat, and a keyframe selector cannot take a `var()` -- percentages in an
 * `@keyframes` block are literals. So the rule is emitted per beat instead,
 * which is the same thing the clips themselves already do.
 */
function strikeKeyframes(holdStart: number, holdEnd: number): string {
  const a = +(holdStart * 100).toFixed(3);
  const b = +(holdEnd * 100).toFixed(3);
  return `@keyframes stage-strike {
  0% { transform: translate(0, 0); }
  ${a}%, ${b}% { transform: translate(var(--sx, 0), var(--sy, 0)); }
  100% { transform: translate(0, 0); }
}`;
}
/**
 * How far the camera slides the performer off centre while they act.
 *
 * A centred subject is a subject with nothing to act ON: the enemy they are
 * swinging at sits outside the frame, so the shot shows a character doing
 * something to nobody. Pushing them toward the side their BACK is on opens the
 * space in front of them, which is where the target is -- the same reason a
 * camera operator leads a moving subject rather than centring it.
 *
 * Applied before the scale in `scale(z) translate(x, y)`, so the screen shift
 * is this multiplied by the zoom. At 2.6x, 7% of the stage moves the performer
 * roughly a fifth of the frame -- off centre, still comfortably inside it.
 */
const LOOK_ROOM = 7;

/**
 * Turning a slot's position into a camera origin.
 *
 * Slots are fractions of the FRAME; `transform-origin` is a percentage of the
 * STAGE. They are not the same box -- the frame is 16:9 and height-led, the
 * stage cell is whatever shape the window leaves -- so a unit at 30% across the
 * frame is nowhere near 30% across the stage, and aiming at one using the other
 * points the camera consistently off-centre.
 *
 * Derived from the frame's own sizing rule (`height: 100%; width: auto` at
 * `FRAME_ASPECT`) rather than measured, so it cannot be perturbed by the
 * ambient sway that is also sitting on that element.
 */
function frameToStage(stageW: number, stageH: number): { ox: number; sx: number } {
  if (!stageW || !stageH) return { ox: 0, sx: 1 };
  const sx = Math.min(1, (stageH * FRAME_ASPECT) / stageW);
  return { ox: (1 - sx) / 2, sx };
}
/** How far down the frame the boards begin, as a fraction. */
const FLOOR_TOP = 0.56;
/**
 * How long a hit reaction is held before the character returns to their idle
 * stance. Shared with `stage-flinch` in styles.css.
 *
 * Long enough to read as a reaction rather than a flicker, short enough that a
 * character taking fire from several enemies is not frozen in a pose through
 * the whole volley.
 */
const PAIN_MS = 1000;
/** How long an impact burst is on screen. Matches `burst-pop` in styles.css. */
const BURST_MS = 380;

/*
 * How long one resolved action stays on screen.
 *
 * A short breath ADDED to however long the action itself took, rather than a
 * fixed interval that the action has to fit inside.
 *
 * It used to be the whole thing: a flat 1500ms between steps no matter what was
 * playing. That was already wrong before the pause at the mark grew -- Quick
 * Cut runs past two seconds, so the next Performer walked on while Benjamin was
 * still mid-swing. Two clocks, one of them guessing at the other.
 *
 * Reading still sets the floor. `STRIKE_MS` is the shortest a beat may be, and
 * it is roughly how long it takes to read "Benjamin uses Quick Cut!" and glance
 * at the floater it explains; anything with a longer animation simply takes
 * longer, and the queue waits for it.
 */
const AFTER_BEAT_MS = 180;
/** How long a reposition holds the screen. It has no clip and no walk. */
const MOVE_MS = 520;
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
  /*
   * Who the camera is looking at, when nobody is performing.
   *
   * Hovering a roster row beats whatever is selected: the hover is a live
   * question ("who is that?") and the selection is a standing one, so the
   * transient intent wins for as long as it lasts and the shot falls back to
   * the selection when the pointer leaves.
   */
  const [rosterHover, setRosterHover] = useState<Unit | null>(null);
  /* The stage's own shape, which decides how frame coordinates map onto it. */
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageBox, setStageBox] = useState({ w: 0, h: 0 });
  const [preview, setPreview] = useState<Ability | null>(null);
  /** A hovered innate passive, shown in the same slot as an ability's rules. */
  const [previewPassive, setPreviewPassive] = useState<Passive | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /*
   * The resting zoom, live.
   *
   * It existed only as a constant in camera.ts, which is a knob for whoever is
   * editing the source and nobody else -- and "how close should the camera sit"
   * is a judgement you make by looking at the stage, not by reading a number.
   *
   * Kept in localStorage so a value you dialled in survives the reload that
   * every scene or clip save triggers; without that, tuning it would mean
   * re-dialling after each save. Read through a try/catch because a blocked
   * storage throws rather than returning nothing.
   */
  const [restZoom, setRestZoom] = useState(() => {
    try {
      const v = Number(localStorage.getItem('sb.restZoom'));
      return Number.isFinite(v) && v >= 1 && v <= 4 ? v : REST_ZOOM;
    } catch {
      return REST_ZOOM;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('sb.restZoom', String(restZoom));
    } catch {
      // A viewer with storage blocked still gets the slider, just not the memory.
    }
  }, [restZoom]);
  const [narration, setNarration] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);

  // `clip` rides along so the sprite knows WHICH animation this beat is, not
  // merely that one is happening -- an actor can have a different sheet per
  // ability, and only the turn knows which ability was used.
  /*
   * `act` is the difference between walking out and swinging.
   *
   * They used to be one flag, so the attack clip was mounted for the whole beat
   * and simply held its first drawing through the walk and the pause. That put
   * the character into their windup pose the instant they set off, which reads
   * as a frozen sprite sliding across the boards rather than as somebody
   * walking to their mark. The idle keeps playing until `act` turns true.
   */
  const [pulse, setPulse] = useState<{
    id: string;
    dx: number;
    clip: string;
    act: boolean;
  } | null>(null);
  /**
   * Who is currently holding a hit reaction, cleared on a timer.
   *
   * Deliberately NOT `hits`, which is a monotonic counter whose only job is to
   * be a React key -- bumping it remounts the sprite so a CSS flinch replays.
   * It never returns to zero, so reading it as "is hurt right now" leaves the
   * first character to take a hit stuck in their pain pose for the rest of the
   * fight. A reaction is a moment, so it needs a clock of its own.
   */
  /** Who is mid-reaction, and which way they are turning. */
  const [flinching, setFlinching] = useState<Record<string, 'a' | 'b'>>({});
  /*
   * The hit reaction, held back until the blow actually lands.
   *
   * The engine resolves an action in one go, at the top of the beat -- so if
   * the reaction fired when the damage did, the target spun the instant the
   * attacker set off walking, a second and a half before the sword reached
   * them. The numbers were right and the staging was nonsense.
   *
   * Parked here instead and fired by `lunge` on the same schedule as the impact
   * sparks, which are already keyed to the frame the animator marked. One
   * clock for "this is the moment of contact", not two.
   */
  const pendingHit = useRef<((n: number, of?: number) => void) | null>(null);

  /*
   * Where one number is thrown.
   *
   * Random, but bounded: far enough apart that six of them read as six, close
   * enough that every one still clearly belongs to the body it came off. The
   * rise varies too, so numbers thrown at the same moment do not travel in
   * lockstep and arrive as a row.
   */
  const spray = () => ({
    x: (Math.random() * 2 - 1) * 26,
    rise: 0.75 + Math.random() * 0.5,
    tilt: (Math.random() * 2 - 1) * 14,
  });
  /** Impact effects currently playing, keyed so each one animates once. */
  const [bursts, setBursts] = useState<
    {
      id: number;
      on: string | null;
      at?: { x: number; y: number };
      /**
       * Rides the performer's walk to the mark.
       *
       * Decided when the burst is SPAWNED, from whether it landed on whoever is
       * acting, rather than from its placement -- a `caster` burst is not the
       * only one that can end up on the performer, since a team-wide buff hits
       * him along with everyone else. Fixing it at spawn also keeps a burst in
       * one container for its whole life: derived from the live `pulse` it
       * would change container the instant the beat ended, and React would tear
       * the element down and rebuild it mid-animation.
       */
      walks?: boolean;
      impact: Impact;
    }[]
  >([]);
  /** Ids damaged by the action just resolved. Written by `withHitReactions`. */
  /*
   * The battle root, purely so the pointer-follow has a shared place to write.
   *
   * Carried for the focus class and nothing else now; the pointer-follow that
   * used to write camera offsets here is gone.
   */
  const rootRef = useRef<HTMLDivElement>(null);
  /**
   * Whoever the action just resolved AFFECTED, for its impact effects to land
   * on. Not whoever it hurt.
   *
   * It was the hurt list, read from an HP diff, and that made a buff invisible:
   * Rally touches every ally and damages none of them, so the list came back
   * empty and `each` had nobody to burst on -- an ability set to show an effect
   * on all its targets showed nothing at all, with no error anywhere to say why.
   *
   * The HP diff still supplies half of it, in both directions now, and the
   * action's own log events supply the rest: a modifier landing, frost, a
   * freeze, a sleep. Reading the log rather than the ability's declared targets
   * keeps the original guarantee that made this a diff in the first place --
   * an effect appears only where something actually happened, so a miss, an
   * immunity or a resisted debuff still produces nothing.
   */
  const lastAffected = useRef<string[]>([]);
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

  /*
   * Which set this stage is dressed with.
   *
   * A scene that claims this stage number wins over the one named on the
   * encounter. The encounter's own `scene` stays the fallback, so an encounter
   * nothing has been authored for still has a set to stand on -- but assigning
   * scenes to stretches of the ladder is the normal way to dress the game, and
   * it belongs with the scenes rather than in the roster file.
   *
   * Resolved in the WEB layer on purpose. The engine is pure and runs headless,
   * and scene files are loaded through a Vite glob that does not exist outside
   * a browser build -- so `sceneFor` can only ever name a default, and which
   * set actually gets painted is a rendering decision.
   *
   * Declared HERE, high up, because `board` is read during render by the
   * `targets` memo -- the slot-scoped branch walks the marks to find empty
   * squares. It used to be declared with the rest of the staging, hundreds of
   * lines below that memo, which put it in the temporal dead zone: picking a
   * `scope: 'slot'` ability threw `Cannot access 'board' before initialization`
   * and took the screen down. Nothing else touched it during render, so the
   * only ability in the game that could reach it was the only one that broke.
   */
  const sceneId = sceneIdForStage(stage) ?? encounter.scene;
  const stageLayers = sceneLayers(sceneId) ?? encounter.layers;
  /*
   * Where a Performer stands to act. The scene's own marks if it has any, the
   * global default otherwise -- a set with a platform across the middle wants
   * its acting positions somewhere the rules could never guess.
   */
  const acts = sceneActs(sceneId) ?? DOWNSTAGE;
  const board = sceneSlots(sceneId, 'board') ?? PARTY_SLOTS_ALL;
  const foeSlots = sceneSlots(sceneId, 'enemy') ?? encounter.enemySlots;
  const marks = { board, enemySlots: foeSlots };

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
      // Cooling abilities never enter this set. `matched` is what every "can
      // this be cast" question in the screen reads -- the row's ready styling,
      // the board button, `chooseAbility`'s guard and the tray's count -- so
      // the cooldown belongs here rather than being re-tested at each of them.
      // It was not, and the tray cheerfully reported "1 ability ready" for an
      // ultimate the player could not cast; on a roll that matches nothing else
      // that line is the only feedback there is.
      if ((sel.unit.cooldowns[a.name] ?? 0) > 0) continue;
      if (paysAsWildcard(a, sel.unit.freeCast) ? sel.dice.length === 1 : sum === a.cost)
        out.add(a.name);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel.unit, sel.dice, affordable, battle.turn, battle.phase]);

  /**
   * What the dice WOULD have bought if it were not cooling, and how long is
   * left on it. Purely for the tray's hint, but the hint needs it: without this
   * a roll covering a cooling ultimate and nothing else fell through to
   * "Benjamin has nothing costing 10", which is a flat contradiction of the
   * row sitting a few pixels away with 10 on its badge and a counter over it.
   */
  const coolingMatch = useMemo(() => {
    if (!sel.unit || sel.unit.side !== 'player' || sel.dice.length === 0) return null;
    const sum = pickedSum();
    for (const a of sel.unit.def.abilities) {
      const turns = sel.unit.cooldowns[a.name] ?? 0;
      if (!turns) continue;
      if (paysAsWildcard(a, sel.unit.freeCast) ? sel.dice.length === 1 : sum === a.cost)
        return { name: a.name, turns };
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel.unit, sel.dice, battle.turn, battle.phase]);

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
      for (const sl of board) {
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

    /*
     * A chain that retargets widens the ability, and the preview has to say so.
     *
     * Rally is a single-target buff whose trigger turns it into a whole-team
     * one. Aiming it while the chain is live asked for one ally, glowed on one
     * ally, and then buffed five -- the ability was doing the right thing and
     * the board was describing a different ability. `scope` cannot express
     * this, because the widening is not a property of the ability; it is a
     * property of this particular cast.
     *
     * Still aimed at one body, because that is what the engine does: it
     * resolves the aim first and then moves the effects. The click is the same
     * click -- it is only the consequence that is wider, which is exactly what
     * the highlight is for.
     */
    const retarget = chainFires(armedAfter(battle.plan, battle.armed), sel.ability)
      ? sel.ability.trigger?.retarget
      : undefined;
    if (retarget === 'allies') {
      for (const u of livingOf(battle, sel.unit.side)) out.add(pk(u.pos));
      return out;
    }
    if (retarget === 'self') {
      out.add(pk(sel.unit.pos));
      return out;
    }

    for (const u of unitsHit(sel.ability, hover, pool)) out.add(pk(u.pos));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel.unit, sel.ability, hover, targets, battle.plan, battle.armed]);

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
    lastAffected.current = [];
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

    /*
     * Who this action reached, in any way that shows.
     *
     * Built here rather than below the `changed.length === 0` return, because
     * that return is the path EVERY pure buff takes -- no HP moved, so the
     * function used to give up before recording anything, and the impacts had
     * an empty list to work with.
     *
     * Log events are named by `def.name` while everything downstream is keyed
     * by id, so they are resolved back through the roster here rather than
     * leaving the burst code to match on names.
     */
    const affected = new Set(changed.map((c) => c.unit.def.id));
    for (const e of battle.log.slice(logMark)) {
      const name =
        e.t === 'damage' ||
        e.t === 'heal' ||
        e.t === 'buff' ||
        e.t === 'modify' ||
        e.t === 'frost' ||
        e.t === 'freeze' ||
        e.t === 'shatter'
          ? e.target
          : e.t === 'sleep'
            ? e.unit
            : null;
      if (!name) continue;
      const u = battle.units.find((x) => x.def.name === name);
      if (u) affected.add(u.def.id);
    }
    lastAffected.current = [...affected];

    if (changed.length === 0) return;

    const hurt = changed.filter((c) => c.delta < 0);

    /*
     * The blows of a multi-hit, each as its own batch of floaters.
     *
     * Built from the LOG rather than from the HP diff, because the diff can
     * only ever say what an action did in TOTAL -- it is one subtraction. The
     * log carries every strike separately with its own amount, element and
     * critical, and `hit` says which blow it belonged to. That is exactly the
     * grouping needed to land six numbers on six impact frames.
     */
    type Floater = (typeof spawned)[number];
    const byHit = new Map<number, Floater[]>();
    /* How much of a unit's loss the indexed blows already account for. */
    const indexed = new Map<string, number>();
    const unitByName = new Map(battle.units.map((u) => [u.def.name, u]));

    for (const e of battle.log.slice(logMark)) {
      if (e.t !== 'damage' || e.hit == null) continue;
      const u = unitByName.get(e.target);
      if (!u) continue;
      const list = byHit.get(e.hit) ?? [];
      list.push({
        id: floaterId.current++,
        amount: e.amount,
        kind: 'damage' as const,
        at: { ...u.pos },
        side: u.side,
        element: e.element,
        crit: e.crit,
        spray: spray(),
      });
      byHit.set(e.hit, list);
      indexed.set(u.def.id, (indexed.get(u.def.id) ?? 0) + e.amount);
    }

    /*
     * One floater for everything the blows did not describe.
     *
     * A unit whose whole loss came from indexed strikes is already covered and
     * must not also get a lump sum; anyone else -- healed, burned, hit by a
     * plain single strike -- still gets the net change the screen has always
     * shown.
     */
    const spawned = changed
      .filter((c) => !(c.delta < 0 && indexed.get(c.unit.def.id) === Math.abs(c.delta)))
      .map((c) => {
        const hit = c.delta < 0 ? style.get(c.unit.def.name) : undefined;
        return {
          id: floaterId.current++,
          amount: Math.abs(c.delta),
          kind: c.delta < 0 ? ('damage' as const) : ('heal' as const),
          at: { ...c.unit.pos },
          side: c.unit.side,
          element: hit?.element,
          crit: hit?.crit,
          spray: spray(),
        };
      });
    const hurtIds = hurt.map((c) => c.unit.def.id);

    /*
     * Everything the player should see AT THE MOMENT OF CONTACT.
     *
     * `n` is which blow this is and `of` how many the animation stages, so a
     * multi-hit releases one batch of numbers per impact frame and turns its
     * target the opposite way each time.
     *
     * When the two counts disagree -- more blows than impacts, which is what
     * happens the moment somebody raises the hit count without drawing new
     * impacts -- the leftovers all land on the final impact. Better to show
     * every number late than to silently drop damage that was really dealt.
     */
    const float = (batch: typeof spawned) => {
      if (!batch.length) return;
      const ids = new Set(batch.map((f) => f.id));
      setFloaters((f) => [...f, ...batch]);
      window.setTimeout(() => setFloaters((f) => f.filter((x) => !ids.has(x.id))), FLOATER_MS);
    };

    pendingHit.current = (n: number, of = 1) => {
      if (hurtIds.length > 0) {
        setHits((h) => {
          const next = { ...h };
          for (const i of hurtIds) next[i] = (next[i] ?? 0) + 1;
          return next;
        });
        const dir = n % 2 === 0 ? 'a' : ('b' as const);
        setFlinching((f) => ({ ...f, ...Object.fromEntries(hurtIds.map((i) => [i, dir])) }));
        // Per unit, so a later blow landing on somebody else cannot cut this
        // one short. A repeat hit on the SAME unit restarts it, which is what
        // the alternating direction is there to make legible.
        window.setTimeout(() => {
          setFlinching((f) => {
            const next = { ...f };
            for (const i of hurtIds) delete next[i];
            return next;
          });
        }, PAIN_MS);
      }
      // The unindexed changes -- heals, burns, plain single strikes -- belong
      // to the action rather than to any one blow, so they fly on the first.
      if (n === 0) float(spawned);

      const last = n >= of - 1;
      for (const [hit, batch] of byHit) {
        if (hit === n || (last && hit > n)) float(batch);
      }
    };
  }

  /**
   * The performance beat: step downstage, act, and slide back to the mark.
   *
   * A Performer who acts from where they are standing reads as a sprite being
   * nudged. Stepping out to the front of the boards and returning reads as
   * somebody taking their turn in the middle of a stage, which is the thing
   * this game is about -- and it also gives an attack clip a clear place to
   * play where nobody is standing in front of it.
   *
   * Long enough to carry a 16-frame clip. `STRIKE_MS` is shared with the CSS so
   * the class comes off exactly when the animation ends rather than mid-step.
   */
  /** The middle of a group of units, in stage fractions. */
  function centroidOf(ids: string[]): { x: number; y: number } {
    const slots = ids
      .map((id) => battle.units.find((u) => u.def.id === id))
      .filter((u): u is Unit => !!u)
      .map((u) => slotAt(u.pos, u.side, marks))
      .filter((sl): sl is Slot => !!sl);
    if (slots.length === 0) return { x: 0.5, y: 0.6 };
    return {
      x: slots.reduce((n, sl) => n + sl.xPct, 0) / slots.length,
      y: slots.reduce((n, sl) => n + sl.yPct, 0) / slots.length,
    };
  }

  /** Runs one performance and returns how long it will take. */
  function lunge(
    id: string,
    side: Unit['side'],
    targets: string[] = [],
    ability?: Ability,
    /**
     * A clip to play instead of the one the ability would name.
     *
     * Buying an upgrade is a real action -- it costs the Performer's turn and
     * their dice -- but it has no ability, so it fell through to `attack` and
     * the player watched Benjamin swing his sword at nobody in order to learn
     * Hold the Line. Named here rather than invented inside `abilityClipName`,
     * because that function answers "which clip does this ABILITY use" and an
     * upgrade is not one.
     *
     * Ignored when the actor has no such clip, which keeps this as incremental
     * as the per-ability clips are: whoever has been drawn one uses it, and
     * everyone else goes on swinging until somebody draws them one.
     */
    prefer?: string,
  ): number {
    /*
     * Repositioning is not a performance.
     *
     * Stepping downstage exists to give an action a stage to happen on -- the
     * performer walks out, does the thing where everyone can see it, and walks
     * back. A move IS the walk. Sending the character to the centre mark and
     * back before they change rank means two journeys for one decision, and the
     * one the player actually asked for is the one that gets buried.
     */
    if (ability?.kind === 'move') {
      const react = pendingHit.current;
      pendingHit.current = null;
      react?.(0);
      return MOVE_MS;
    }
    /*
     * The beat lasts as long as the clip needs, not a fixed 1150ms.
     *
     * A constant meant that retiming an attack in the lab silently broke it:
     * at 129ms a frame Benjamin's 16-frame swing runs 2064ms, so the beat cut
     * him off at frame 8 and his frame-10 impact was scheduled 363ms after he
     * had already walked home. Deriving it means the animator sets the pace and
     * the staging follows, which is the only order that cannot drift.
     */
    const clipName =
      prefer && ANIMATION_CLIPS[id]?.[prefer]
        ? prefer
        : abilityClipName(
            ANIMATION_CLIPS[id],
            ability?.name,
            // So a sheet filed by slot -- `benjamin_ability_2_4x1.png` --
            // finds its ability without anyone naming it twice.
            battle.units.find((u) => u.def.id === id)?.def.abilities,
          );
    const clip = ANIMATION_CLIPS[id]?.[clipName];
    const steps = clip
      ? clipTimeline(clip.frames, tuningFor(id, clipName), orderFor(id, clipName))
      : [];
    const { beat, leadIn } = beatOf(id, clipName);

    setPulse({ id, dx: side === 'player' ? 1 : -1, clip: clipName, act: false });
    // The swing begins when the walk and the pause are done, not when the turn
    // does. Guarded on the id so a beat that has already been replaced by the
    // next one cannot reach back and start an animation on the wrong actor.
    window.setTimeout(
      () => setPulse((p) => (p && p.id === id ? { ...p, act: true } : p)),
      leadIn,
    );
    window.setTimeout(() => setPulse(null), beat);

    /*
     * Schedule this clip's impacts onto whoever the ability actually hit.
     *
     * Timed off the clip's own played timeline rather than a fixed fraction of
     * the beat, so retiming the swing moves the spark with it and a two-hit
     * ability lands two bursts at the two frames its drawings connect on.
     *
     * NOT offset by the step out. The clip and the walk start on the same
     * frame -- measured: the sprite is at `ct` 0 while its transform is still
     * at 0 -- so the performer swings as they stride, and the clip's own
     * timeline already IS the beat's timeline.
     *
     * There used to be a `beat * 0.22 +` here, on the theory that the clip only
     * began once the performer reached the mark. It never did, so the term was
     * pure double-count: it pushed Benjamin's spark 300ms past the drawing that
     * was supposed to connect. At 16 frames and 2064ms that error was buried
     * inside a swing still in progress; at 4 frames and 683ms it put the spark
     * on the recovery pose, after the blade had finished its arc.
     *
     * The spark belongs to the SWORD, not to the feet. Keyed straight off the
     * frame the animator marked, it lands on the drawing where the blade passes
     * through, which is the only thing the impact is meant to agree with.
     */
    /*
     * The hit reaction rides the impacts.
     *
     * Taken out of the ref here so it fires exactly once per beat however this
     * function returns -- an ability with no clip, no impacts or no surviving
     * target still has to make its target flinch, it just has nothing to
     * synchronise with and lands on the lead-in instead.
     */
    const react = pendingHit.current;
    pendingHit.current = null;
    const marks = clip ? impactTimes(id, clipName, steps, stepMsFor(id, clipName)) : [];

    /*
     * A `caster` burst plays on the performer, so it does not need the ability
     * to have affected anybody -- which means an empty target list can no
     * longer cancel the whole schedule. It still cancels the other two
     * placements, since both are defined in terms of who was hit.
     */
    const onCaster = marks.some(({ impact }) => impact.at === 'caster');
    const nothingToLandOn = targets.length === 0 && !onCaster;

    if (!clip || nothingToLandOn || marks.length === 0) {
      if (react) window.setTimeout(() => react(0), leadIn);
      if (!clip || nothingToLandOn) return beat;
    }

    marks.forEach(({ at, impact }, n) => {
      window.setTimeout(() => {
        react?.(n, marks.length);
        const key = Date.now() + Math.random();
        // `centre` is ONE burst at the middle of everyone affected, so an area
        // ability reads as a single event rather than five simultaneous ones.
        // The point is the mean of their slots, which is where the group
        // visually is -- not the mean of the whole side.
        const spawned =
          // `caster` rides the performer's own slot, which is why it needs no
          // position of its own and no targets: `on` is the acting unit, and
          // the slot renderer does the rest exactly as it does for a target.
          impact.at === 'caster'
            ? [{ id: key, on: id, walks: true, impact }]
            : targets.length === 0
              ? []
              : impact.at === 'centre'
                ? [{ id: key, on: null, at: centroidOf(targets), impact }]
                : targets.map((on, i) => ({ id: key + i, on, walks: on === id, impact }));
        setBursts((b) => [...b, ...spawned]);
        const ids = new Set(spawned.map((x) => x.id));
        // Cleared when it has finished PLAYING, which is now per impact. A
        // fixed wait would cut a slow burst off or leave a fast one lingering.
        window.setTimeout(
          () => setBursts((b) => b.filter((x) => !ids.has(x.id))),
          impact.ms ?? BURST_MS,
        );
        // Offset by the lead-in, because the clip does not start until the
        // performer has reached the mark and taken their beat. `at` is a time
        // within the CLIP; this turns it into a time within the turn.
      }, leadIn + at);
    });
    return beat;
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

  /**
   * Show a held reaction now, because nothing is going to perform it.
   *
   * The null-step branches still resolve real HP changes -- end-of-phase
   * regeneration, a burn ticking down -- and those have no swing to land on.
   * Without this they would set a reaction nobody ever fires, and the next
   * action to call `lunge` would play it against the wrong moment.
   */
  function flushHit() {
    const react = pendingHit.current;
    pendingHit.current = null;
    react?.(0);
  }

  /** Resolve one queued action, then the next, then hand over to the enemies. */
  function stepPlan() {
    const held: { step: PlannedAction | null } = { step: null };
    withHitReactions(() => {
      held.step = commitNext(battle);
    });
    const step = held.step;

    if (!step) {
      flushHit();
      startEnemyPhase(battle);
      setNarration(null);
      bump();
      enemyTimer.current = window.setTimeout(stepEnemy, HANDOVER_MS);
      return;
    }

    // A null ability IS the upgrade purchase -- that is how the engine records
    // one -- so this is the only call site that can ask for the upgrade clip.
    const beat = lunge(
      step.unit.def.id,
      step.unit.side,
      lastAffected.current,
      step.ability ?? undefined,
      step.ability ? undefined : 'upgrade',
    );
    setNarration(actionLine(step.unit, step.ability, step.target, battle.units));
    bump();
    playerTimer.current = window.setTimeout(stepPlan, beat + AFTER_BEAT_MS);
  }

  function stepEnemy() {
    const held: { step: ReturnType<typeof nextAiStep> } = { step: null };
    withHitReactions(() => {
      held.step = nextAiStep(battle);
    });
    const step = held.step;

    if (!step) {
      flushHit();
      finishEnemyPhase(battle);
        setBusy(false);
      setNarration(null);
      bump();
      if (battle.outcome === 'ongoing' && battle.phase === 'player') playDiceRoll(battle.dice);
      return;
    }

    const beat = lunge(step.unit.def.id, step.unit.side, lastAffected.current, step.ability ?? undefined);
    setNarration(actionLine(step.unit, step.ability, step.target, battle.units));
    bump();
    enemyTimer.current = window.setTimeout(stepEnemy, beat + AFTER_BEAT_MS);
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
  /*
   * Whose sheet the panel shows.
   *
   * Hovering a roster row points the camera at somebody; leaving the sheet on
   * whoever was SELECTED meant the screen answered a different question from
   * the one the player just asked -- Benjamin's abilities while the camera sits
   * on Kael.
   *
   * It is a PREVIEW, not a change of selection. Nothing about it is actionable:
   * you cannot spend Benjamin's dice on Kael's abilities, so while the hover
   * lasts the ability list is inert and nothing reads as castable. The hover
   * ends the moment the pointer leaves the row, which is before it could reach
   * the panel -- but a panel that can be clicked into acting on the wrong
   * character is not one worth shipping, so the guard is explicit rather than
   * left to the geometry.
   */
  const shownUnit = rosterHover ?? sel.unit;
  const previewing = shownUnit !== sel.unit;

  const kitAbilities = useMemo(
    // Whoever the sheet is ABOUT, which is the hovered unit while previewing.
    // Reading these off the selection was why a preview showed the right name
    // over the wrong character's abilities.
    () => (shownUnit?.def.abilities ?? []).filter((a) => a.kind !== 'move'),
    [shownUnit],
  );
  const boardAction = useMemo(
    () => (shownUnit?.def.abilities ?? []).find((a) => a.kind === 'move'),
    [shownUnit],
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
  /*
   * What is armed for an action added NOW -- everything already queued has
   * resolved by then, so the plan arms into this too.
   *
   * The same set the splash preview reads, and the reason it is computed up
   * here: a chain being live is a fact about the round, not about the sheet you
   * happen to be looking at, so it reads the same on a previewed Performer's
   * abilities as on the selected one's.
   */
  const liveArmed = armedAfter(battle.plan, battle.armed);
  // Which resting stance each Performer is holding right now. Empty for
  // anyone who has only been drawn one idle, which is currently everyone.
  const stances = useIdleStances(battle.units);
  const nextTier =
    sel.unit && sel.unit.side === 'player' ? (sel.unit.def.upgrades ?? [])[sel.unit.upgrades] : undefined;
  const upgradeMasks = nextTier ? masksFor({ cost: nextTier.cost } as Ability) : [];
  const upgradeReady = nextTier != null && upgradeMasks.length > 0 && diceCover(nextTier.cost);



  // A lab-authored scene wins over the encounter's in-source layer list, and
  // over the default marks: a set and the places people stand on it are one
  // decision, so they travel together.

  const hoveredUnit = hover ? battle.units.find((u) => alive(u) && pk(u.pos) === pk(hover)) : undefined;
  // Whose mark the camera should be looking at. Falls back to the player side
  // so the origin is a real point even between turns, which keeps the ambient
  // sway anchored rather than snapping when a turn starts.
  const pulseSide: Unit['side'] =
    battle.units.find((u) => u.def.id === pulse?.id)?.side ?? 'player';

  /*
   * The camera, as plain custom properties on `.stage`.
   *
   * One element carries the whole shot now. The frame pieces used to be a
   * sibling that had to be handed the same numbers, and keeping two elements
   * agreeing about a transform was a recurring source of them disagreeing --
   * about scale, about which box a percentage meant, about whether the mouse
   * moved them. They are scenery inside the frame now, so there is nothing left
   * to synchronise.
   */
  /*
   * Who the camera has its eye on, and how hard it is looking.
   *
   * Three states in priority order, because they answer different questions and
   * the more specific one has to win:
   *   performing  -- the turn has decided; nothing else may argue with it
   *   focused     -- somebody is hovered or picked, so show me them
   *   resting     -- the whole set
   *
   * Resolved as ONE value rather than as separate zoom and origin decisions, so
   * the shot can never end up pushed in on nobody.
   */
  /*
   * `busy`, not just `pulse`.
   *
   * A resolving phase is a sequence of beats with gaps between them, and
   * `pulse` is only true during a beat. Keying off it alone meant the whole
   * focus treatment -- scrim, dimmed cast, closed-down vignette -- snapped on
   * and off in the hand-over between every action, which reads as flickering
   * rather than as a camera. While the battle is playing itself out, the
   * performance owns the shot and nothing else may dress it.
   *
   * Aiming releases it too, and that one is not a nicety. A focus shot is 5.7x
   * on one character with everyone else dimmed and blurred, which measured out
   * as all five enemies off screen -- so the moment you chose an ability you
   * could no longer see, let alone click, anything to aim it at. The camera
   * pulls back to show the board for exactly as long as you are choosing a
   * target, which is the one moment the board is what matters.
   */
  /*
   * The camera answers a LOOK, and only a look.
   *
   * Selecting used to focus too, and that made the zoom fight the thing it was
   * meant to serve: you picked a character, the camera pushed in to 5.7x, and
   * then the moment you chose an ability it had to pull straight back out
   * because at that zoom the enemies are off screen and unclickable. In and out
   * on every action, and the zoom-out arrived exactly when you were trying to
   * concentrate.
   *
   * The two gestures are not the same kind of thing. Hovering a roster row is a
   * question -- "who is that?" -- which is transient, ends by itself, and is
   * worth a hard push-in. Selecting is a working state that has to survive
   * while you choose an ability and pick a target, and a working state must not
   * take the view away. Selection still reads: the row highlights and the slot
   * outlines. It just does not move the camera.
   *
   * Still nothing during a beat or a resolving phase -- the performance owns
   * the shot -- and nothing while aiming, because that is the one moment the
   * whole board is the thing you need to see.
   */
  const focusUnit = pulse || busy || sel.ability ? null : rosterHover;

  const focusSlot = focusUnit ? slotFor(focusUnit, board, foeSlots) : undefined;
  const map = frameToStage(stageBox.w, stageBox.h);
  // Frame fractions -> stage percentages. Vertically the frame IS the stage's
  // height, so only the horizontal axis needs converting.
  const eyeOf = (p: { x: number; y: number }) => ({ x: map.ox + p.x * map.sx, y: p.y });

  /*
   * A unit's drawn height, as a fraction of the frame's.
   *
   * The same three factors the sprite itself is sized by, so anything measured
   * against it -- how hard to zoom, how high to start a damage number -- lands
   * the same way on a character who is scaled down on the boards as on one who
   * is not.
   */
  const figureHeight = (u: Unit, slot: Slot): number =>
    SLOT_H *
    (u.side === 'enemy' ? ENEMY_SCALE : 1) *
    (u.def.sprite?.scale ?? 1) *
    depthScale(slot.yPct);

  const focusHeight =
    focusUnit && focusSlot
      ? SLOT_H *
        (focusUnit.side === 'enemy' ? ENEMY_SCALE : 1) *
        (focusUnit.def.sprite?.scale ?? 1) *
        depthScale(focusSlot.yPct)
      : 0;

  /*
   * What goes in the middle of the shot, and how close.
   *
   * `zoom: null` during a beat because `.closing-in` owns the push-in value --
   * an inline zoom would beat the class and the push would never happen.
   */
  const shot = pulse
    ? { zoom: PUSH_ZOOM, inline: false, subject: eyeOf(acts[pulseSide]) }
    : focusSlot
      ? {
          zoom: focusZoomFor(focusHeight),
          inline: true,
          // Aim at the middle of the FIGURE, not at the mark under its feet.
          // The slot is a point on the floor; centring on that puts the
          // character in the top half of the shot with a screenful of boards
          // below them.
          subject: eyeOf({ x: focusSlot.xPct, y: focusSlot.yPct - focusHeight / 2 }),
        }
      : { zoom: restZoom, inline: true, subject: eyeOf(REST_EYE) };

  const aim = {
    x: clampCentre(shot.subject.x, shot.zoom),
    y: clampCentre(shot.subject.y, shot.zoom),
  };

  const camera = {
    ...(shot.inline ? { ['--cam-zoom' as string]: `${shot.zoom}` } : null),
    /*
     * The shot, as a translate that brings the subject to the middle.
     *
     * Players face right, so their back is to the left and a performance slides
     * them left to open up what they are swinging at; enemies go the other way.
     */
    ['--cam-x' as string]: `${(centreOn(aim.x) * 100 + (pulse ? (pulseSide === 'player' ? -LOOK_ROOM : LOOK_ROOM) : 0)).toFixed(2)}%`,
    ['--cam-y' as string]: `${(centreOn(aim.y) * 100).toFixed(2)}%`,
  } as CSSProperties;

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const read = () => {
      const r = el.getBoundingClientRect();
      // The RATIO is what matters and the camera's own scale cancels out of it,
      // so this needs no correction for whatever zoom is in effect.
      setStageBox((prev) => (prev.w === r.width && prev.h === r.height ? prev : { w: r.width, h: r.height }));
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      className={`game battle ${pulse ? 'in-beat' : ''} ${focusUnit ? 'focusing' : ''}`}
      ref={rootRef}
    >
      <style>{IDLE_KEYFRAMES}</style>
      {/* The walk, retimed for whoever is currently performing. */}
      <style>
        {(() => {
          const b = beatOf(pulse?.id ?? '', pulse?.clip ?? '');
          return strikeKeyframes(b.holdStart, b.holdEnd);
        })()}
      </style>
      <div
        ref={stageRef}
        className={`stage ${pulse ? 'closing-in' : ''}`}
        style={
          {
            ...camera,
            ...(stageLayers ? null : { backgroundImage: `url(${encounter.background})` }),
            // `.stage-frame` inherits this; a layered encounter paints its own.
            ...(stageLayers ? { backgroundImage: 'none' } : null),
          } as CSSProperties
        }
      >
        {/* `moving` is aiming-at-SLOTS, which needs the floor readable and
            clickable in a way aiming at bodies does not. */}
        <div
          className={`stage-frame ${sel.ability ? 'aiming' : ''} ${
            sel.ability && (sel.ability.scope ?? 'one') === 'slot' ? 'moving' : ''
          }`}
        >
        {/* Layered stage, rendered INSIDE `.stage-frame` rather than beside it.
            The frame carries `aspect-ratio: 1672/941` and is letterboxed within
            the wider stage -- which is exactly the shape this art was drawn for,
            so on the frame it needs no cropping at all. It also puts the layers
            in the same stacking context as the Performers, so ordering them
            against each other is a plain z-index instead of a fight with the
            frame's own context. */}
        {stageLayers?.filter((l) => !l.front).map((l, i) => (
          <LayerImg
            key={`${l.src}-${i}`}
            layer={l}
            zIndex={0}
            className="stage-layer"
          />
        ))}
        {/*
          A scrim between the set and the cast, raised while focusing.

          Sits at z 60: above every scenery layer, below every Performer at
          100+. That gap is the whole reason this is an element rather than a
          `filter` on the layers -- each layer already carries an inline
          `filter` for its cast shadow, and a stylesheet cannot add to an inline
          transform-like property, only lose to it.

          Painting a scrim also degrades better than dimming would: it settles
          over the whole set evenly, including the gaps between pieces, so the
          stage recedes as one surface rather than as a dozen separately
          darkened cutouts.
        */}
        <div className="stage-scrim" aria-hidden="true" />
        {/*
          Empty squares of the party's formation, drawn ONLY while a reposition is
          being aimed.
          
          Permanently visible footprints would turn the stage into a board and
          the backdrop is a painted theatre, not a battlemap. They appear
          exactly when they become clickable, which is also when the player
          needs to see the shape of the formation they are moving inside.

          With five slots and five Performers there is normally nothing to draw:
          a full board means every reposition is a SWAP, and the swap targets
          are the other Performers themselves. This is not dead code though --
          the filter is on `alive`, so a slot opens up when somebody falls, and
          stepping into a dead ally's place is a real move with real
          consequences for who the enemy can reach.
        */}
        {sel.ability && (sel.ability.scope ?? 'one') === 'slot' &&
          board.filter(
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
                onClick={(e) => {
                  e.stopPropagation();
                  aimAt(at);
                }}
              />
            );
          })}

        {/*
          The fallen, still on the boards.

          They used to vanish the moment their HP hit zero, because everything
          that draws the stage filters on `alive` -- which is correct for the
          RULES (a dead Performer cannot act, cannot be aimed at, and is not
          caught by an area attack; all four are enforced in the engine and none
          of that changed here) and wrong for the picture. A party of five that
          quietly becomes a party of three tells you the fight is going badly by
          leaving an empty stage, when a body on the boards says it better and
          says WHOSE.

          A pass of their own rather than a branch inside the living one. They
          take no pointer events, carry no marks, no intent, no hit reactions
          and no walk -- a downed unit has none of the states those describe --
          and a branch would have had to switch all of it off one prop at a
          time.

          Anyone without a `death` pose still leaves the stage, which is exactly
          what everyone did before this existed.
        */}
        {battle.units
          .filter((u) => !alive(u) && u.def.sprite?.death)
          .map((u) => {
            const slot = slotFor(u, board, foeSlots);
            if (!slot) return null;
            const sheet = u.def.sprite!;
            // The same figure height the living are drawn at, spent on WIDTH
            // instead: lying down, a Performer is about as long as they are
            // tall. The packer clamps a pose to the board height, which for a
            // drawing wider than it is tall would otherwise blow it up to
            // twice the size of everyone standing over it.
            const len =
              SLOT_H * (u.side === 'enemy' ? ENEMY_SCALE : 1) * sheet.scale * depthScale(slot.yPct);
            const down = placementFor(u.def.id, 'death') ?? {};
            return (
              <div
                key={`down-${u.def.id}`}
                className="stage-slot downed"
                style={{
                  left: `${slot.xPct * 100}%`,
                  top: `${slot.yPct * 100}%`,
                  /*
                   * Between the scrim and the living.
                   *
                   * Scenery sits at 0, the focus scrim at 60, every standing
                   * Performer at 100+. The first attempt put bodies at 0-40,
                   * which is on the SET's side of the scrim -- so every corpse
                   * was dimmed along with the backdrop the moment anyone took
                   * their turn, and mostly disappeared into it.
                   *
                   * A body belongs to the cast, so it goes above the scrim; it
                   * is on the floor, so it goes below anyone standing. That
                   * leaves 61-99, and they still sort among themselves by how
                   * far downstage they fell.
                   */
                  zIndex: 65 + Math.round(slot.yPct * 30),
                }}
                title={`${u.def.name} is down`}
              >
                <img
                  className={`sprite downed-sprite ${sheet.pixelated ? 'pixel' : ''}`}
                  src={sheet.death}
                  alt=""
                  draggable={false}
                  style={{
                    // Tuned in the animation lab like anything else. The pose is
                    // packed as a one-frame clip purely so the lab can reach it,
                    // and this is the half that makes editing it mean something.
                    width: `${len * (down.scale ?? 1) * 100}cqh`,
                    height: 'auto',
                    transform:
                      `translate(${down.dx ?? 0}%, ${down.dy ?? 0}%)` +
                      ` scaleX(${u.side === 'player' ? 1 : -1})`,
                  }}
                />
              </div>
            );
          })}

        {battle.units.filter(alive).map((u) => {
          const slot = slotFor(u, board, foeSlots);
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
            // Everyone who is NOT the subject of the shot, while there is one.
            // Carried on the slot rather than the unit so it composes with the
            // spent dim instead of replacing it -- two `filter` declarations on
            // one element means the later wins, and a focused-but-spent
            // character would pop back to full brightness.
            focusUnit && focusUnit !== u ? 'unfocused' : '',
            // Which body the pointer is actually over. Sprites overlap and have
            // transparent margins, so "the one nearest the cursor" is a genuine
            // question the player was being left to guess at.
            hoveredUnit === u ? 'hovered' : '',
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
                // Where this unit steps to when it performs, as a delta from its
                // own slot to the downstage mark on its own side. Container
                // units, because a percentage transform would be read against
                // the sprite's own box rather than against the stage.
                // The clip THIS beat is playing decides its length, so a long
                // ability holds the mark longer than a short one.
                ['--beat' as string]: `${beatOf(u.def.id, pulse?.id === u.def.id ? pulse.clip : '').beat}ms`,
                ['--sx' as string]: `${(acts[u.side].x - slot.xPct) * 100}cqw`,
                ['--sy' as string]: `${(acts[u.side].y - slot.yPct) * 100}cqh`,
              }}
              onMouseEnter={() => setHover(u.pos)}
              onMouseLeave={() => setHover(null)}
              // Stops here. The stage's own click clears the selection, and a
              // click that landed on a body is the opposite of a click on bare
              // boards -- without this, picking a second character wiped the
              // first instead of replacing it, because the stage handler reads
              // the selection as it was when it was last rendered.
              onClick={(e) => {
                e.stopPropagation();
                if (isTarget) fireAt(u);
                else selectUnit(u);
              }}
            >
              <UnitChip
                key={hits[u.def.id] ?? 0}
                unit={u}
                phase={battle.phase}
                slotH={SLOT_H * (u.side === 'enemy' ? ENEMY_SCALE : 1)}
                queued={u.side === 'player' && isPlanned(battle, u)}
                depth={depthScale(slot.yPct)}
                facing={u.side === 'player' ? 1 : -1}
                hit={hits[u.def.id] ?? 0}
                flinching={flinching[u.def.id] ?? null}
                striking={pulse?.id === u.def.id}
                actClip={pulse?.id === u.def.id && pulse.act ? (pulse.clip || null) : null}
                stance={stances[u.def.id]}
              />
              {u.pending && <span className="casting">!</span>}
              {/*
                A burst that landed on the PERFORMER has to walk out with him.

                The step-to-the-mark animation is on `.unit`, INSIDE this slot,
                so a burst placed beside it stays on the mark the performer left
                -- which is right for a target, who does not move, and plainly
                wrong for the caster, who is halfway downstage by the time the
                flourish fires. Rather than move the bursts inside `.unit` (whose
                box is the figure, not the slot, and would rescale every number
                already authored against a slot), this wrapper runs the SAME
                generated `stage-strike` keyframes off the same `--beat`, `--sx`
                and `--sy` this slot already carries.

                Rendered unconditionally and toggled by class, so its animation
                starts on the same frame as the performer's rather than
                whenever the first burst happens to spawn -- a wrapper mounted
                mid-beat would start its walk from the beginning, several
                hundred ms after he did.
              */}
              <span
                className={`caster-fx${pulse?.id === u.def.id ? ' striking' : ''}`}
                aria-hidden="true"
              >
                {bursts
                  .filter((b) => b.on === u.def.id && b.walks)
                  .map((b) => {
                    const fx = EFFECTS[b.impact.effect];
                    if (!fx) return null;
                    return (
                      <span
                        key={b.id}
                        className="impact-burst"
                        style={
                          {
                            width: `calc(${(b.impact.scale ?? 1) * 100}% * ${fx.aspect})`,
                            aspectRatio: `${fx.aspect}`,
                            left: `${50 + (b.impact.dx ?? 0)}%`,
                            top: `${50 + (b.impact.dy ?? 0)}%`,
                            backgroundImage: `url(${fx.src})`,
                            backgroundSize: `${fx.frames * 100}% 100%`,
                            ['--fx-frames' as string]: fx.frames,
                            ['--fx-end' as string]: `${fx.frames * 100}%`,
                            ['--fx-ms' as string]: `${b.impact.ms ?? BURST_MS}ms`,
                          } as CSSProperties
                        }
                      />
                    );
                  })}
              </span>
              {/* Impact effects land ON the target, inside its slot, so they
                  travel with it and inherit its depth in the painter's order
                  rather than needing a position of their own. */}
              {bursts
                .filter((b) => b.on !== null && b.on === u.def.id && !b.walks)
                .map((b) => {
                  const fx = EFFECTS[b.impact.effect];
                  if (!fx) return null;
                  return (
                    <span
                      key={b.id}
                      className="impact-burst"
                      style={
                        {
                          width: `calc(${(b.impact.scale ?? 1) * 100}% * ${fx.aspect})`,
                          aspectRatio: `${fx.aspect}`,
                          left: `${50 + (b.impact.dx ?? 0)}%`,
                          top: `${50 + (b.impact.dy ?? 0)}%`,
                          backgroundImage: `url(${fx.src})`,
                          backgroundSize: `${fx.frames * 100}% 100%`,
                          ['--fx-frames' as string]: fx.frames,
                          ['--fx-end' as string]: `${fx.frames * 100}%`,
                          ['--fx-ms' as string]: `${b.impact.ms ?? BURST_MS}ms`,
                        } as CSSProperties
                      }
                    />
                  );
                })}
            </div>
          );
        })}

        {/*
          The outer frame -- legs, columns, valance -- as SCENERY.

          These used to live in their own element outside the stage so they
          could sit still while the camera moved. That is what a proscenium does
          in a theatre, and it is not what these pieces are: they are painted
          flats standing at the edge of the set, and a flat that ignores the
          camera reads as a sticker on the monitor. Inside the frame they take
          the sway, the pointer drift and the push-in exactly as the trees do,
          because they are the same kind of object.

          A wrapper rather than loose images so the focus dim has something to
          hold: each layer already spends its inline `filter` on a cast shadow,
          and a stylesheet cannot add to that, only lose to it.
        */}
        {stageLayers?.some((l) => l.front) && (
          <div className="front-layers" aria-hidden="true">
            {stageLayers
              .filter((l) => l.front)
              .map((l, i) => (
                <LayerImg key={`${l.src}-${i}`} layer={l} zIndex={250 + i} className="stage-layer" />
              ))}
          </div>
        )}

        {/* Area bursts sit on the stage rather than in a slot: there is no
            single unit for them to ride, and the point they mark is the
            group's middle. */}
        {bursts
          .filter((b) => b.on === null && b.at)
          .map((b) => {
            const fx = EFFECTS[b.impact.effect];
            if (!fx) return null;
            return (
              <span
                key={b.id}
                className="impact-burst area"
                style={
                  {
                    left: `${b.at!.x * 100 + (b.impact.dx ?? 0)}%`,
                    top: `${b.at!.y * 100 + (b.impact.dy ?? 0)}%`,
                    width: `${(b.impact.scale ?? 1) * SLOT_H * 100 * fx.aspect}cqh`,
                    aspectRatio: `${fx.aspect}`,
                    backgroundImage: `url(${fx.src})`,
                    backgroundSize: `${fx.frames * 100}% 100%`,
                    ['--fx-frames' as string]: fx.frames,
                    ['--fx-end' as string]: `${fx.frames * 100}%`,
                    ['--fx-ms' as string]: `${b.impact.ms ?? BURST_MS}ms`,
                  } as CSSProperties
                }
              />
            );
          })}

        {/*
          Declared intent is NOT drawn on the stage.

          It was: a small badge at each creature's feet holding the rolled
          number, with the ability name in a tooltip. That worked at two or
          three enemies and stopped working at five. The block spans about an
          eighth of the frame, so five badges plus the escalation and matchup
          columns beside them landed in the same strip of boards and covered
          each other and the art underneath.

          The information is worth keeping -- a fight is meant to be plannable,
          and what each enemy is about to do is most of what you plan against
          -- so it moved to the enemy roster instead, where every creature
          already has a row of its own. Rows cannot collide, and there is space
          for the ability NAME rather than a number you had to hover to decode.

          What stays on the body is what is genuinely positional: the matchup
          while aiming, escalation, and the frost and sleep marks. Those answer
          "which of these do I point this at", and that question is about a
          place on the stage.
        */}

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
          const slot = slotAt(u.pos, u.side, marks);
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
          /*
           * Modifiers are deliberately NOT marked here.
           *
           * They were, as a `▲ 2t` / `▼ 3t` pair, and the clock is what killed
           * it: a unit can be carrying three buffs on three schedules, and one
           * number cannot speak for them without picking a winner and implying
           * the others do not exist. Anything honest enough to fix that is a
           * list, and a list does not belong on a character's head.
           *
           * The sheet answers it instead, which is what hover-to-read is for --
           * the same glance that shows a Performer's dice costs shows what is
           * currently on them. A status like frost stays here because it IS one
           * number, and one the design asks you to count before spending dice.
           */
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
          const slot = slotAt(f.at, f.side, marks);
          if (!slot) return null;
          /*
           * Whose body this number came off.
           *
           * Searched among ALL units rather than the living, because the number
           * that kills somebody is still theirs and still has to rise from
           * where they stood. Falling back to a plain slot height keeps a
           * floater from collapsing to the floor if the owner cannot be found
           * at all -- a wrong height is a much smaller problem than a number
           * that behaves differently from its neighbours.
           */
          const owner = battle.units.find(
            (u) => u.side === f.side && u.pos.x === f.at.x && u.pos.y === f.at.y,
          );
          const lift = owner ? figureHeight(owner, slot) : SLOT_H;
          return (
            <span
              key={f.id}
              className={floaterClass(f)}
              style={
                {
                  left: `${slot.xPct * 100}%`,
                  /*
                   * Halfway up the body, not at the mark.
                   *
                   * A slot's point is on the FLOOR -- it is where the feet go --
                   * so a number anchored to it started at the boards and rose
                   * past the character rather than off them. Lifting it by half
                   * the figure's height puts it at the chest, which is where a
                   * hit reads as landing.
                   *
                   * Derived per unit rather than a fixed nudge, because the
                   * cast is not one size: a constant that centres Rebar leaves
                   * Aethis wearing hers as a hat.
                   */
                  top: `${(slot.yPct - lift / 2) * 100}%`,
                  zIndex: 900,
                  // Thrown off in its own direction. The CSS reads these; the
                  // values were fixed when the floater was made, so a re-render
                  // cannot make a number jump mid-flight.
                  ['--spray-x' as string]: `${f.spray.x}px`,
                  ['--spray-rise' as string]: `${f.spray.rise}`,
                  ['--spray-tilt' as string]: `${f.spray.tilt}deg`,
                } as CSSProperties
              }
            >
              {f.crit && <b className="crit-flag">CRIT</b>}
              {f.kind === 'damage' ? '-' : '+'}
              {f.amount}
            </span>
          );
        })}
        </div>
      </div>

      {/* Fade to black around the picture. A SIBLING of `.stage`, not a child:
          the camera transforms the stage, and a vignette that zoomed and swayed
          with it would read as a hole in the set rather than as the edge of the
          frame. Ignores the pointer so the stage underneath stays clickable. */}
      <div className="stage-vignette" aria-hidden="true" />

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
              {/* How close the camera sits when nothing has its attention.
                  A slider because the right value is a look, not a number --
                  and it reads back so the number is there when you want it. */}
              <label className="dev-zoom" title="Resting camera zoom">
                zoom
                <input
                  type="range"
                  min={1}
                  max={3}
                  step={0.05}
                  value={restZoom}
                  onChange={(e) => setRestZoom(Number(e.target.value))}
                />
                <b>{restZoom.toFixed(2)}×</b>
              </label>
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
          units={players} selected={sel.unit} onSelect={selectUnit} onPeek={setRosterHover} />
      </div>

      <div className="hud hud-foes">
        <TeamPanel title={`Enemies (${livingOf(battle, 'enemy').length}/${enemies.length})`}
          units={enemies} selected={sel.unit} onSelect={selectUnit} onPeek={setRosterHover}
          intents={battle.phase === 'player'} />
      </div>

      <div className="hud hud-right">
        {!shownUnit && (
          // The band is the widest thing in the dock and it is empty until
          // something is picked. Saying so beats leaving what reads as a
          // rendering fault.
          <div className="panel detail-empty">
            <span>Select a Performer or an enemy to see their sheet.</span>
          </div>
        )}
        {shownUnit && (
          <div className="panel detail">
            {/* Three deliberate sections rather than one flat list.
                They used to flow through a multi-column box, which split the
                ability list across columns and stranded the turn badge at the
                top of a column away from the stats it belongs with -- the
                layout was deciding what grouped with what, and it had no idea. */}
            <div className="sheet-id">
              <h3 className="portrait-head">
              {shownUnit.def.sprite ? (
                <SpritePortrait sheet={shownUnit.def.sprite} height={54} />
              ) : (
                <Avatar def={shownUnit.def} size={40} side={shownUnit.side} />
              )}
              <span className="who">{shownUnit.def.name}</span>
              <span className="stars">{'★'.repeat(shownUnit.def.rarity)}</span>
            </h3>
            <div className="stat-row">
              <span>
                HP {shownUnit.hp}/{unitMaxHp(shownUnit)}
              </span>
              <span>ATK {stat(unitAttack(shownUnit))}</span>
              <span>P.DEF {stat(effectiveDefense(shownUnit, 'physical'))}</span>
              <span>M.DEF {stat(effectiveDefense(shownUnit, 'magical'))}</span>
              {shownUnit.upgrades > 0 && (
                <span className="boosted">+{Math.round((statScale(shownUnit) - 1) * 100)}%</span>
              )}
            </div>
            {/*
              What is currently ON this Performer, and for how long.

              Under the stat row on purpose: these ARE those numbers' second
              half. `ATK 130` is not a fact about Benjamin, it is a fact about
              Benjamin this turn, and the row above could not say which part of
              it was about to lapse.

              Grouped by the ability that applied them, which is also how the
              engine stores them -- one cast of Rally is one thing with one
              clock that happens to move three stats, and three separate rows
              would read as three buffs that might expire apart. They cannot.
            */}
            {modifierGroups(shownUnit).length > 0 && (
              <div className="mods">
                {modifierGroups(shownUnit).map((g) => (
                  <span
                    key={g.ability}
                    className={`mod ${g.good ? 'good' : 'bad'}`}
                    title={`${g.ability}: ${g.parts.join(', ')} — ${g.turns} turn${
                      g.turns === 1 ? '' : 's'
                    } left`}
                  >
                    <strong>{g.ability}</strong>
                    <span className="mod-parts">{g.parts.join(' · ')}</span>
                    <em>{g.turns}t</em>
                  </span>
                ))}
              </div>
            )}
            <div className="terrain-note">
              {ROLE_LABEL[shownUnit.def.role]} · {elementsOf(shownUnit.def).join('/')} ·{' '}
              {rankLabel(shownUnit, battle)}
            </div>
            {shownUnit.def.ramp && (
              <div className="ramp-note">
                <strong>Escalation</strong> · +{shownUnit.def.ramp.percent}% damage each turn past
                turn {shownUnit.def.ramp.after} · now{' '}
                <em>×{rampMultiplier(shownUnit.def, battle.turn).toFixed(2)}</em>
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
                const entries = Object.entries(shownUnit!.def.resistances ?? {}) as [Element, number][];
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
            {(shownUnit.def.passives ?? []).map((pas) => (
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
            {boardAction && shownUnit.side === 'player' && (
              <button
                className={`board-chip ${sel.ability === boardAction ? 'on' : ''} ${
                  !previewing && matched.has(boardAction.name) ? 'ready' : ''
                }`}
                disabled={previewing || !canAct || !matched.has(boardAction.name)}
                onClick={() => chooseAbility(boardAction)}
                onMouseEnter={() => setPreview(boardAction)}
                onMouseLeave={() => setPreview(null)}
                onFocus={() => setPreview(boardAction)}
                onBlur={() => setPreview(null)}
                title={
                  !canAct
                    ? `${shownUnit.def.name} is not acting again this round`
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
            {shownUnit.side === 'enemy' && (
              <ul className="rolltable">
                {shownUnit.def.abilities
                  .filter((a) => a.roll)
                  .map((a) => {
                    const [lo, hi] = a.roll!;
                    const now = shownUnit!.intent?.roll;
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
            {shownUnit.side === 'player' && (
              <ul className={`abilities ${canAct ? '' : 'inert'}`}>
                {kitAbilities.map((a) => {
                  // Three states. `locked` is hopeless: no subset of this roll can
                  // pay for it. `ready` means the dice in hand cover it now.
                  // Plain-but-disabled is the middle -- payable, wrong dice.
                  const ok = affordable.get(a.name) ?? false;
                  const active = sel.ability?.name === a.name;
                  // Turns left before this can be cast again. Its own state,
                  // separate from affordability: a cooled-down ability is not
                  // "you picked the wrong dice", it is "not this turn, whatever
                  // you roll", and the two should not read the same.
                  const cooling = shownUnit!.cooldowns[a.name] ?? 0;
                  // Somebody ahead of this one has already put the symbol out,
                  // so casting this now fires its trigger. Worth saying loudly:
                  // it is the one thing on the sheet that changes what the
                  // ability DOES, and until now the only way to know was to
                  // remember what had been queued and check the chip yourself.
                  const chainReady = chainFires(liveArmed, a);
                  // A previewed sheet shows no ability as castable, because none of
                  // them is: the dice belong to whoever is selected.
                  // `matched` already excludes anything cooling, so this does
                  // not need to re-test it -- `cooling` below is for the styling
                  // and the tooltip, which need to say WHY it is not ready.
                  const ready = !previewing && matched.has(a.name);
                  return (
                    // Hover lives on the <li>: disabled buttons swallow mouse events.
                    <li key={a.name} onMouseEnter={() => setPreview(a)} onMouseLeave={() => setPreview(null)}>
                      <button
                        className={[
                          'ability',
                          !canAct || cooling || ok ? '' : 'locked',
                          cooling ? 'cooling' : '',
                          chainReady ? 'chains' : '',
                          active ? 'active' : '',
                          ready ? 'ready' : '',
                        ].filter(Boolean).join(' ')}
                        onClick={() => chooseAbility(a)}
                        disabled={!canAct || !!cooling || !ready}
                        title={
                          cooling
                            ? `${a.name} is not ready for ${cooling} more turn${cooling === 1 ? '' : 's'}`
                            : !canAct
                              ? `${shownUnit!.def.name} is not acting again this round`
                              : !ok
                                ? `No dice in this roll can total ${a.cost}`
                                : !ready
                                  ? paysAsWildcard(a, shownUnit!.freeCast)
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
                          className={`cost${!a.wildcard && paysAsWildcard(a, shownUnit!.freeCast) ? ' charged' : ''}`}
                        >
                          {paysAsWildcard(a, shownUnit!.freeCast) ? '✳' : a.cost}
                        </span>
                        <span className="body">
                          <strong>
                            {a.name}
                            {/* On the row itself, because "which two of these
                                four chain together" is a question about the KIT
                                and cannot be answered by hovering one of them. */}
                            {a.symbol && (
                              <em
                                className={`sym ${a.trigger ? 'has-trigger' : ''} ${chainReady ? 'on' : ''}`}
                                title={
                                  (chainReady ? 'Chain is live — ' : '') + (describeChain(a) ?? '')
                                }
                              >
                                <SymbolIcon symbol={a.symbol} size={13} />
                              </em>
                            )}
                          </strong>
                          <em>
                            {a.kind}
                            {dealsDamage(a) ? ` · ${damageTypeOf(a)}` : ''} · {rangeLabel(a)}
                            {a.element && (
                              <>
                                {' · '}
                                <span style={{ color: ELEMENT_COLOR[a.element] }}>{a.element}</span>
                              </>
                            )}
                          </em>
                          {/* What the chain will DO, spelled out on the row, the
                              same way the queue spells it out on a planned
                              action. The lit chip says a trigger is live; it
                              cannot say that Rally is about to buff the whole
                              team instead of one ally, and that sentence is the
                              entire reason to cast this one now rather than
                              next turn. */}
                          {chainReady && a.trigger && (
                            <span className="trigger">{a.trigger.text}</span>
                          )}
                        </span>
                        {/* The turns left, on a sheet drawn over the whole row.

                            Two earlier versions put this number on the cost
                            badge and then in a pill at the row's right edge.
                            Both read as a price: a small numeral on an ability
                            row joins the scan the player is running down the
                            cost column against their dice, whatever it actually
                            means. Covering the row says "not this one" before
                            the number is read, and nothing else in this UI puts
                            a figure in the middle of a darkened button. */}
                        {cooling > 0 && (
                          <span
                            className="cd-overlay"
                            aria-label={`Ready in ${cooling} turn${cooling === 1 ? '' : 's'}`}
                          >
                            <strong>{cooling}</strong>
                            <em aria-hidden="true">{cooling === 1 ? 'turn' : 'turns'}</em>
                          </span>
                        )}
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

            {/*
              Shown while previewing, and inert -- the same rule the ability list
              follows, for the same reason.

              It used to be hidden outright, because `nextTier`, `upgradeMasks`
              and `upgradeReady` are all derived from the SELECTED unit, so a
              track drawn under somebody else's name mixed two characters and the
              button behind it spent real dice. But hiding it answered a
              presentation problem by deleting information: hovering a Performer
              is how you read them, and their upgrade line is half of what there
              is to read.

              So the selection-derived parts are suppressed instead. What is left
              is intrinsic to the hovered unit -- which tiers exist, what they
              cost, what they grant, how many are already bought -- and nothing
              reads as purchasable.
            */}
            {shownUnit.side === 'player' && !over && (
              <div className={`upgrades ${previewing ? 'inert' : ''}`}>
                <div className="upgrade-track">
                  {(shownUnit.def.upgrades ?? []).map((t, i) => (
                    <span key={t.name} className={`pip-tier ${i < shownUnit!.upgrades ? 'on' : ''}`} title={t.name} />
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
                {(shownUnit.def.upgrades ?? []).map((tier, i) => {
                  const bought = i < shownUnit!.upgrades;
                  // Affordability belongs to the selection, so while previewing
                  // there is no such thing: no tier is next, ready or locked,
                  // because none of them is anything to the dice in hand.
                  const isNext = !previewing && i === shownUnit!.upgrades;
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
                        previewing ||
                        !isNext ||
                        shownUnit!.hasActed ||
                        isPlanned(battle, shownUnit!) ||
                        !upgradeReady
                      }
                      title={
                        previewing
                          ? `Select ${shownUnit!.def.name} to buy this`
                          : bought
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

            {shownUnit.side === 'enemy' && (
              <div className="enemy-kit">
                {shownUnit.pending && (
                  <p className="incoming">
                    Casting <strong>{shownUnit.pending.ability.name}</strong> — lands next turn
                  </p>
                )}
                {shownUnit.def.abilities.map((a) => (
                  <div key={a.name} className="kit-row">
                    <strong>{a.name}</strong>
                    {(shownUnit!.cooldowns[a.name] ?? 0) > 0 && <em className="cd">{shownUnit!.cooldowns[a.name]}t</em>}
                    <p>{describeAbility(a)}</p>
                    {describeEnemyUsage(a) && <p className="sub">{describeEnemyUsage(a)}</p>}
                  </div>
                ))}
                {(shownUnit.def.passives ?? []).map((pas) => (
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
        {shownUnit && (
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
              <ForecastPanel battle={battle} source={sel.unit!} ability={sel.ability} centre={hoveredUnit.pos} />
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
                      : coolingMatch
                        ? ` — pays for ${coolingMatch.name}, ready in ${coolingMatch.turns} turn${
                            coolingMatch.turns === 1 ? '' : 's'
                          }`
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
 * Which resting stance each Performer is currently holding.
 *
 * Four idles exist so a waiting party does not read as four statues. The rule
 * is the simplest one that can look right: **play a stance all the way through,
 * then move to the next, in order, forever.**
 *
 * That is a correction. The first version held each stance for two to four
 * loops chosen at random, and staggered the first change by a random 400-3000ms
 * so the party would not move in unison -- and that stagger was the bug. A
 * delay picked at random is not a loop boundary, so the opening switch always
 * landed mid-animation, cutting a breath in half. A cut mid-loop reads as a
 * glitch rather than as a shift of weight, which is exactly the thing the
 * scheduling was supposed to avoid.
 *
 * Going round in order rather than picking at random fixes the other half. A
 * random pick can repeat a stance, or skip one for a minute at a time, and both
 * read as something misfiring rather than as a character shifting about.
 *
 * Nothing stops the party from switching together now, and that turns out not
 * to need solving: every Performer's clips have their own frame counts and
 * their own `stepMs`, so they drift apart within a cycle or two on their own.
 * An artificial offset would only buy the first few seconds, at the cost of the
 * alignment that makes every switch land cleanly.
 *
 * Held in state rather than derived at render. `Math.random()` inside a render
 * would re-roll on every unrelated state change -- a die landing, a floater
 * expiring -- and the board would strobe.
 *
 * A character with one idle is skipped entirely, so this costs nothing until
 * the alternate sheets exist.
 */
function useIdleStances(units: Unit[]): Record<string, string> {
  const [stance, setStance] = useState<Record<string, string>>({});
  // Only who is on stage matters here, not their hit points.
  const cast = units.map((u) => u.def.id).join();

  useEffect(() => {
    const timers: number[] = [];
    for (const id of cast ? cast.split(',') : []) {
      const options = idleStances(ANIMATION_CLIPS[id]);
      if (options.length < 2) continue;

      const runtime = (name: string): number => {
        const clip = ANIMATION_CLIPS[id]?.[name];
        return clip
          ? clipDuration(
              clipTimeline(clip.frames, tuningFor(id, name), orderFor(id, name)),
              stepMsFor(id, name),
            )
          : 1200;
      };

      /*
       * Scheduled against a running clock rather than by chaining delays.
       *
       * `setTimeout` fires late under load, and a chain of them accumulates
       * every one of those late arrivals. A few milliseconds is nothing once;
       * after a hundred switches it is enough to land a change in the middle of
       * a loop, which is the whole thing this is arranged to avoid. Tracking
       * when the NEXT switch is due and asking for the remaining time absorbs
       * the lateness instead of compounding it.
       */
      let at = performance.now() + runtime(options[0]!);
      let i = 0;
      const tick = () => {
        i = (i + 1) % options.length;
        const next = options[i]!;
        setStance((s) => ({ ...s, [id]: next }));
        at += runtime(next);
        timers.push(window.setTimeout(tick, Math.max(16, at - performance.now())));
      };
      timers.push(window.setTimeout(tick, Math.max(16, at - performance.now())));
    }
    return () => timers.forEach(window.clearTimeout);
  }, [cast]);

  return stance;
}

/**
 * Which slot a unit is standing in, matched by its formation coordinates.
 *
 * The party is looked up in the WHOLE formation, never in the encounter's list.
 * `encounter.partySlots` is a FILL order -- seven of the nine, the ones units
 * deploy into -- so a Performer who repositioned into either of the other two
 * found no slot and rendered as nothing. Two of the nine squares made you
 * vanish, which is the sort of bug a fill list masquerading as a board causes.
 */
function slotFor(u: Unit, board: Slot[], enemySlots: Slot[]): Slot | undefined {
  const pool = u.side === 'player' ? board : enemySlots;
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
/**
 * `board` is every party slot, NOT `encounter.partySlots` -- that is a fill
 * ORDER of seven, and looking a position up in it misses the two corners a
 * reposition can reach. Passed in rather than read from the constant so a
 * lab-authored scene can move the marks.
 */
function slotAt(p: Pos, side: Side, enc: { board: Slot[]; enemySlots: Slot[] }): Slot | undefined {
  const pool = side === 'player' ? enc.board : enc.enemySlots;
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
  actClip,
  stance,
  flinching = null,
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
  /** Currently holding a hit reaction. See `PAIN_MS`. */
  /** Mid-reaction, and which way the tumble turns. Null when untouched. */
  flinching?: 'a' | 'b' | null;
  /** Taking their turn: walking out, performing, walking back. Drives the step. */
  striking: boolean;
  /** The clip to PLAY, once they have arrived and taken their pause. */
  actClip: string | null;
  /**
   * Which resting stance to hold. Falls back to `idle`, so a character with one
   * idle sheet is drawn exactly as they were before alternates existed.
   */
  stance?: string;
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
    // The performing clip, and only once they are actually performing. The
    // catalogue carries every packed clip -- `sheet.idle` is just the one the
    // board loops at rest -- so nothing new had to be generated to reach it.
    const attack = actClip ? ANIMATION_CLIPS[unit.def.id]?.[actClip] : undefined;
    /*
     * An action is booked: stand ready rather than idle.
     *
     * A queued action is a promise the player has made and can still take back,
     * and until now the only sign of it was a marker pinned to the sprite. A
     * change of STANCE says it with the body -- you can read the whole board's
     * state at a glance and see who is still deciding.
     *
     * Held through the walk as well, which is why the test is `!attack` rather
     * than `!striking`: a Performer who has drawn their sword to say "I am
     * going" should not sheathe it to stroll to the mark and draw it again.
     * They keep the stance from the moment the action is booked right up to the
     * frame the swing starts.
     *
     * Falls through to the idle for anyone without a `ready` sheet, so this
     * costs nothing for a character who has not been drawn one.
     */
    const ready = !attack && (queued || striking) ? ANIMATION_CLIPS[unit.def.id]?.ready : undefined;
    // The resting stance, which is `idle` unless this character has alternates
    // and the scheduler has moved them onto one.
    const resting = (stance && ANIMATION_CLIPS[unit.def.id]?.[stance]) || undefined;
    const clipName = attack ? actClip! : ready ? 'ready' : (resting ? stance! : 'idle');
    const strip = attack ?? ready ?? resting ?? idle;
    const box = strip ? clipBox(strip, h, placementFor(unit.def.id, clipName)) : null;
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
    // A hit reaction is one drawing held for a moment, so it replaces the strip
    // entirely rather than playing. Falls through to the normal path for an
    // actor who ships no `pain` pose.
    const painting = flinching && sheet.pain && !striking;
    // One timeline, read by both tracks. Computed here rather than inline in
    // each so the pose can never end on a different frame than the strip.
    const clipSteps = strip
      ? clipTimeline(strip.frames, tuningFor(unit.def.id, clipName), orderFor(unit.def.id, clipName))
      : [];
    const { clipMs } = beatOf(unit.def.id, clipName);
    const poseName = poseKeyframes(poseAnimName(unit.def.id, clipName), clipSteps)
      ? poseAnimName(unit.def.id, clipName)
      : '';
    // Both stills are packed as one-frame clips so the lab can list them, which
    // is only useful if what the lab saves is what the battle draws.
    /*
     * The hit reaction, sized like a FIGURE rather than like the box.
     *
     * It used to be `height: 100%`, and 100% of what was the problem: the unit
     * element is as tall as the CLIP BOX, which is the union of every clip this
     * character owns -- as tall as their highest jump and as wide as their
     * widest swing. The figure fills only `restFill` of it. So a tight-cropped
     * still stretched to the box drew the character at `1 / restFill` of their
     * proper size: 1.45x for Benjamin, which reads as the sprite jumping bigger
     * on every hit, and looks like a deliberate effect rather than a bug.
     *
     * Now it goes through `clipBox`, the same helper the animated path uses,
     * against the pose's OWN packed metrics -- which is what putting `pain` in
     * the clip catalogue bought. Its `restFill` is 1 because it is tight
     * cropped, so its box is exactly the figure height, and its own `anchorX`
     * places it instead of the board sprite's, which was only ever an
     * approximation of where this drawing stands.
     *
     * `bottom: 0` because the unit element's bottom edge IS the ground line:
     * the animated path lands its feet there by pushing the clip down by
     * `footPad`, so a still whose feet are its own bottom edge simply sits on it.
     */
    const painClip = ANIMATION_CLIPS[unit.def.id]?.pain;
    const painBox = painClip ? clipBox(painClip, h, placementFor(unit.def.id, 'pain')) : null;
    /*
     * Pushed down to the ground line, not pinned to it.
     *
     * `bottom: 0` was the obvious way and it silently did nothing: in a battle
     * these sprites are `position: static` (`.battle .sprite-unit .sprite`), and
     * insets have no effect on a static element. So the still sat at the TOP of
     * a box 1.45x its own height and floated well above the mark -- which is
     * why the size fix alone left it hanging in the air.
     *
     * A translate works in flow and composes with the mirror already on this
     * element. The percentage is of the IMAGE's own height, so the distance from
     * its bottom to the box's bottom has to be expressed in those terms.
     */
    const boxH = box ? box.boxH : h;
    const body = painting ? (
      <img
        className={`sprite ${sheet.pixelated ? 'pixel' : ''}`}
        src={sheet.pain}
        alt=""
        draggable={false}
        style={{
          height: painBox
            ? crispCss(`${painBox.boxH * 100}cqh`, sheet.snapPx, sheet.pixelated)
            : '100%',
          width: 'auto',
          transform:
            `translate(${painBox ? painBox.shiftPct : (0.5 - sheet.anchorX) * 100}%,` +
            ` ${painBox ? ((boxH - painBox.boxH) / painBox.boxH) * 100 : 0}%)` +
            ` scaleX(${facing})`,
        }}
      />
    ) : strip && box ? (
      <span
        className="anim-clip"
        style={{ transform: `translate(${box.shiftPct}%, ${box.dropPct}%) scaleX(${facing})` }}
      >
        {/* The pose track: per-frame squash, stretch and lean.
            A wrapper rather than something folded into the strip's own
            transform, because that transform is measured in strip-widths and
            scaling it would slide the clip off its own frames. Left without an
            animation entirely when no frame poses anything, which is almost
            every clip. */}
        <span
          className="anim-pose"
          style={{
            animationName: poseName || undefined,
            animationDuration: poseName ? `${clipMs}ms` : undefined,
            animationTimingFunction: 'linear',
            // Locked to the strip's delay: the pose and the drawing it poses
            // have to start on the same frame or the squash lands on the wrong
            // one.
            ...(poseName && attack
              ? { animationIterationCount: 1, animationFillMode: 'forwards' as const }
              : null),
          }}
        >
        <img
          className={`sprite anim-strip ${sheet.pixelated ? 'pixel' : ''}`}
          src={strip.src}
          alt=""
          draggable={false}
          style={{
            width: `${strip.frames * 100}%`,
            // A plain loop, NOT a ping-pong. These sheets are already complete
            // bounce cycles -- the pack step trims them to whole cycles -- so
            // playing one backwards adds a second bounce that is not in the art.
            //
            // Driven by generated keyframes rather than `steps()` so that any
            // per-frame holds authored in <actor>.anim.json play in the battle
            // exactly as they did in the lab.
            animationName: clipAnimName(unit.def.id, clipName),
            animationTimingFunction: 'linear',
            animationDuration: `${clipMs}ms`,
            // An attack plays ONCE and holds its last drawing; the idle loops.
            // Staggering the start is only right for a loop -- delaying a
            // one-shot would leave the actor blank while they were swinging.
            // An attack plays ONCE, and not until the performer has walked to
            // their mark and taken a beat -- see `beatOf`. `both` rather than
            // `forwards` is what holds the clip's FIRST frame through that
            // lead-in: with `forwards` the strip sits at its untransformed
            // default during the delay, which ignores any offset authored on
            // frame 0 and can show the character half a frame off.
            // No delay: the strip is only swapped in once the performer has
            // arrived and taken their pause, so the clip starts the moment it
            // mounts. It used to be mounted for the whole beat with the lead-in
            // as a delay, which held its first drawing through the walk.
            ...(attack
              ? { animationIterationCount: 1, animationFillMode: 'forwards' }
              // A stance loops like an idle, and takes the same per-character
              // stagger so a party that all booked an action does not breathe
              // in lockstep.
              : { animationDelay: `${idlePhase(unit.def.id, strip.frames)}ms` }),
          }}
        />
        </span>
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
        className={`unit sprite-unit ${unit.side} ${spent} ${hit ? 'hurt' : ''} ${
          flinching === 'b' ? 'spin-b' : ''
        } ${striking ? 'striking' : ''}`}
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
        {/* The hit reaction spins THIS, not the artwork inside it.
            `paper-spin` animates `transform`, and every candidate element below
            is already using its own: the pain pose carries `scaleX(facing)`,
            and the strip carries the offset that picks which frame is showing.
            An animation does not compose with an inline transform, it replaces
            it -- so spinning the artwork directly threw the mirror away and
            every struck enemy finished the flip facing right, and would have
            dragged an animated sprite off its own frames too.
            Out here the flip multiplies with the facing instead: it ends on
            scaleX(1), which leaves whatever mirror the child had intact. */}
        <span className="hit-spin">{body}</span>
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
/** Whether anything this unit carries actually pays out on hits taken. */
const readsGrudge = (u: Unit): boolean =>
  activePassives(u).some((p) => p.kind === 'grudge' || p.kind === 'grudgeArmor');

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
      {/* Shown only where something reads it. Every unit counts hits taken, so
          printing it on all of them would put a number next to five names that
          means nothing for four of them. */}
      {u.grudge > 0 && readsGrudge(u) && (
        <span className="chip grudge" title={`Hit ${u.grudge} time${u.grudge === 1 ? '' : 's'} this turn`}>
          ✖{u.grudge}
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
  onPeek,
  intents = false,
}: {
  title: string;
  units: Unit[];
  selected: Unit | null;
  onSelect: (u: Unit) => void;
  /** Hovering a row points the camera at that unit; null when the pointer leaves. */
  onPeek?: (u: Unit | null) => void;
  /** Show each unit's declared intent. Enemies only, and only while planning. */
  intents?: boolean;
}) {
  return (
    <div className="card">
      <h3>{title}</h3>
      <ul className="roster">
        {units.map((u) => (
          <li key={u.def.id}>
            <button
              className={`row ${selected === u ? 'on' : ''} ${alive(u) ? '' : 'dead'}`}
              onClick={() => onSelect(u)}
              // Pointer, not mouse: the same gesture on a touch screen should
              // not leave the camera stuck on whoever was last brushed past.
              onPointerEnter={() => onPeek?.(u)}
              onPointerLeave={() => onPeek?.(null)}
              onFocus={() => onPeek?.(u)}
              onBlur={() => onPeek?.(null)}
            >
              {u.def.sprite?.icon ? (
                <img className="row-icon" src={u.def.sprite.icon} alt="" draggable={false} />
              ) : (
                <Avatar def={u.def} size={26} side={u.side} />
              )}
              <span className="nm">
                {u.def.name}
                {/* What this creature has declared. The ability name is the
                    useful half -- the roll is kept beside it because it is the
                    number the rules text refers to, and seeing both is how a
                    player learns which band does what. */}
                {intents && alive(u) && u.intent && !u.pending && (
                  <em className="intent-row" title={`rolled ${u.intent.roll}`}>
                    {u.intent.ability.name}
                    <b>{u.intent.roll}</b>
                  </em>
                )}
              </span>
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
