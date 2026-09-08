import { useState } from 'react';
import { ROSTER } from '../../engine/content.ts';
import { describeAbility, describeCost, describePassive } from '../../engine/describe.ts';
import { ROLE_LABEL, type CharacterDef, type StarNode } from '../../engine/types.ts';
import {
  MAX_STARS,
  applyStars,
  describeEffect,
  progressFor,
  spares,
  starCost,
  type StarProgress,
} from '../../engine/stars.ts';
import {
  MAX_LEVEL,
  applyLevel,
  levelCap,
  pacesetters,
  xpForNext,
} from '../../engine/levels.ts';
import type { Profile } from '../../engine/idle.ts';
import { Figure, Portrait } from '../Figure.tsx';

/** Roster browser, and where duplicates are spent on the star tree. */
export function Characters({
  profile,
  onProfile,
}: {
  profile: Profile;
  onProfile: (p: Profile) => void;
}) {
  const owned = ROSTER.filter((d) => (profile.owned[d.id] ?? 0) > 0);
  const locked = ROSTER.filter((d) => !(profile.owned[d.id] ?? 0));
  const [selectedId, setSelectedId] = useState<string | null>(owned[0]?.id ?? null);
  const selected = ROSTER.find((d) => d.id === selectedId) ?? null;

  const levelOf = (id: string) => profile.levels[id] ?? 1;
  const cap = levelCap(owned.map((d) => levelOf(d.id)));
  const holdingBack = pacesetters(owned.map((d) => ({ id: d.id, level: levelOf(d.id) })));

  function levelUp(def: CharacterDef) {
    const level = levelOf(def.id);
    const cost = xpForNext(level);
    if (level >= cap || level >= MAX_LEVEL || profile.xp < cost) return;
    onProfile({
      ...profile,
      xp: profile.xp - cost,
      levels: { ...profile.levels, [def.id]: level + 1 },
    });
  }

  function starUp(def: CharacterDef, nodeId: string) {
    const progress = progressFor(profile.stars, def.id);
    const copies = profile.owned[def.id] ?? 0;
    if (progress.level >= MAX_STARS) return;
    if (spares(copies, progress.level) < starCost(progress.level)) return;

    onProfile({
      ...profile,
      stars: {
        ...profile.stars,
        [def.id]: { level: progress.level + 1, picks: [...progress.picks, nodeId] },
      },
    });
  }

  return (
    <div className="characters">
      <div className="roster-grid">
        {owned.map((def) => {
          const progress = progressFor(profile.stars, def.id);
          const ready =
            spares(profile.owned[def.id] ?? 0, progress.level) >= starCost(progress.level) &&
            progress.level < MAX_STARS;
          return (
            <button
              key={def.id}
              className={`roster-card ${selectedId === def.id ? 'on' : ''}`}
              onClick={() => setSelectedId(def.id)}
            >
              {ready && <span className="ready-dot" title="Can star up" />}
              <Portrait def={def} size={56} />
              <span className="nm">{def.name}</span>
              <span className="lvl">Lv {levelOf(def.id)}</span>
              <StarPips level={progress.level} />
            </button>
          );
        })}

        {locked.map((def) => (
          <div key={def.id} className="roster-card locked" title="Not yet summoned">
            <Portrait def={def} size={56} />
            <span className="nm">{def.name}</span>
            <span className="dim">locked</span>
          </div>
        ))}
      </div>

      {selected && (
        <Detail
          def={selected}
          copies={profile.owned[selected.id] ?? 0}
          progress={progressFor(profile.stars, selected.id)}
          level={levelOf(selected.id)}
          cap={cap}
          xp={profile.xp}
          blockedBy={holdingBack.map((h) => ROSTER.find((d) => d.id === h.id)?.name ?? h.id)}
          onPick={(nodeId) => starUp(selected, nodeId)}
          onLevel={() => levelUp(selected)}
        />
      )}
    </div>
  );
}

function StarPips({ level }: { level: number }) {
  return (
    <span className="pips">
      {Array.from({ length: MAX_STARS }, (_, i) => (
        <span key={i} className={i < level ? 'pip on' : 'pip'}>
          ★
        </span>
      ))}
    </span>
  );
}

function Detail({
  def,
  copies,
  progress,
  level,
  cap,
  xp,
  blockedBy,
  onPick,
  onLevel,
}: {
  def: CharacterDef;
  copies: number;
  progress: StarProgress;
  level: number;
  cap: number;
  xp: number;
  blockedBy: string[];
  onPick: (nodeId: string) => void;
  onLevel: () => void;
}) {
  // Stats shown are what the character actually takes into battle, not the
  // sheet value -- otherwise levels and stars would look like they did nothing.
  const levelled = applyLevel(def, level);
  const live = applyStars(levelled, progress);
  const nextCost = xpForNext(level);
  const atCap = level >= cap;
  const canLevel = !atCap && level < MAX_LEVEL && xp >= nextCost;
  const available = spares(copies, progress.level);
  const cost = starCost(progress.level);
  const maxed = progress.level >= MAX_STARS;

  return (
    <div className="panel char-detail">
      <div className="char-hero">
        <Figure def={def} height={150} />
        <div className="char-head">
          <h2>{def.name}</h2>
          <div className="char-tags">
            <span className="tag lvl-tag">Lv {level}</span>
            <span className="tag">{ROLE_LABEL[def.role]}</span>
            <span className="tag">{def.element}</span>
            <StarPips level={progress.level} />
          </div>
          <div className="stat-row">
            <Stat label="HP" base={def.maxHp} live={live.maxHp} />
            <Stat label="ATK" base={def.attack} live={live.attack} />
            <Stat label="DEF" base={def.defense} live={live.defense} />
            <Stat label="MOV" base={def.move} live={live.move} />
          </div>
          <div className="dim copies">
            {copies} pulled · <strong>{available}</strong> spare
            {available === 1 ? '' : 's'}
            {maxed ? ' · fully starred' : ` · next star costs ${cost}`}
          </div>
        </div>
      </div>

      <div className="level-panel">
        <div className="level-bar">
          <strong>Level {level}</strong>
          <span className="dim">cap {cap}</span>
          <button className="primary" disabled={!canLevel} onClick={onLevel}>
            {atCap ? 'At cap' : `Level up — ${nextCost} XP`}
          </button>
        </div>
        {atCap ? (
          <p className="dim">
            The cap is set by your fifth-highest character, rounded up to the next
            multiple of five. Raise {blockedBy.join(' and ')} to lift it.
          </p>
        ) : (
          <p className="dim">
            {xp >= nextCost
              ? `You have enough experience for the next level.`
              : `${nextCost - xp} more XP needed.`}
          </p>
        )}
      </div>

      <h3>Star tree</h3>
      <StarTree def={def} progress={progress} available={available} onPick={onPick} />

      <h3>Abilities</h3>
      <ul className="kit">
        {live.abilities.map((a, i) => {
          const base = def.abilities[i]!;
          const changed = a.power !== base.power || a.range !== base.range || a.cost !== base.cost;
          return (
            <li key={a.name}>
              <span className={`cost ${changed ? 'boosted' : ''}`}>{a.wildcard ? '✳' : a.cost}</span>
              <div>
                <strong>{a.name}</strong>
                {changed && <span className="tag new">starred</span>}
                <p>{describeAbility(a)}</p>
                <p className="sub">{describeCost(a)}</p>
              </div>
            </li>
          );
        })}
      </ul>

      {(live.passives ?? []).length > 0 && (
        <>
          <h3>Passives from stars</h3>
          <ul className="kit">
            {(live.passives ?? []).map((p, i) => (
              <li key={`${p.kind}-${i}`}>
                <span className="cost up">◆</span>
                <div>
                  <strong>{p.kind}</strong>
                  <p>{describePassive(p)}</p>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function Stat({ label, base, live }: { label: string; base: number; live: number }) {
  return (
    <span>
      {label} {live}
      {live !== base && <em className="gain"> +{live - base}</em>}
    </span>
  );
}

/**
 * The tree itself.
 *
 * Rungs with two nodes are a choice kept for the run; rungs with one are where
 * the branches rejoin. Past picks stay visible so a character's build can be
 * read back at a glance.
 */
function StarTree({
  def,
  progress,
  available,
  onPick,
}: {
  def: CharacterDef;
  progress: StarProgress;
  available: number;
  onPick: (nodeId: string) => void;
}) {
  const tree = def.starTree ?? [];
  if (tree.length === 0) return <p className="dim">No star tree defined yet.</p>;

  return (
    <div className="star-tree">
      {tree.map((tier, i) => {
        const taken = i < progress.level;
        const active = i === progress.level;
        const cost = starCost(i);
        const affordable = available >= cost;
        const pickedId = progress.picks[i];

        return (
          <div
            key={i}
            className={`rung ${taken ? 'taken' : ''} ${active ? 'active' : ''} ${
              tier.nodes.length === 1 ? 'converge' : 'branch'
            }`}
          >
            <div className="rung-label">
              <span className="rung-star">★{i + 1}</span>
              <span className="dim">
                {taken ? 'unlocked' : active ? `${cost} duplicate${cost === 1 ? '' : 's'}` : 'locked'}
              </span>
            </div>

            <div className="rung-nodes">
              {tier.nodes.map((n) => (
                <NodeCard
                  key={n.id}
                  node={n}
                  state={
                    taken ? (pickedId === n.id ? 'chosen' : 'passed') : active ? 'open' : 'locked'
                  }
                  canAfford={affordable}
                  onPick={() => onPick(n.id)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function NodeCard({
  node,
  state,
  canAfford,
  onPick,
}: {
  node: StarNode;
  state: 'chosen' | 'passed' | 'open' | 'locked';
  canAfford: boolean;
  onPick: () => void;
}) {
  const clickable = state === 'open' && canAfford;
  return (
    <button
      className={`node ${state} ${clickable ? 'can' : ''}`}
      disabled={!clickable}
      onClick={onPick}
      title={state === 'open' && !canAfford ? 'Not enough duplicates' : undefined}
    >
      <strong>{node.name}</strong>
      <span className="effects">{node.effects.map(describeEffect).join(' · ')}</span>
      {state === 'chosen' && <span className="tag new">taken</span>}
      {state === 'passed' && <span className="tag">not taken</span>}
    </button>
  );
}
