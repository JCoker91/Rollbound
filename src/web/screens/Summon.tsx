import { useState } from 'react';
import { ROSTER } from '../../engine/content.ts';
import { short, type Profile } from '../../engine/idle.ts';
import {
  MULTI_COST,
  MULTI_COUNT,
  RARITIES,
  RATES,
  SUMMON_COST,
  summon,
  type PullResult,
} from '../../engine/summon.ts';
import { Figure, Portrait } from '../Figure.tsx';

/**
 * Summoning.
 *
 * The rate table is printed on the page from the same constants the roll uses,
 * so the odds shown can never drift from the odds applied.
 */
export function Summon({
  profile,
  onProfile,
}: {
  profile: Profile;
  onProfile: (p: Profile) => void;
}) {
  const [results, setResults] = useState<PullResult[] | null>(null);

  function pull(count: number, cost: number) {
    if (profile.shards < cost) return;
    const { results: rolled, owned } = summon(ROSTER, profile.owned, count);
    setResults(rolled);
    onProfile({ ...profile, shards: profile.shards - cost, owned });
  }

  return (
    <div className="summon">
      <section className="panel banner">
        <div>
          <h2>Standard summon</h2>
          <p className="dim">
            Every character in the roster is available. Duplicates are spent on the star
            tree in the Characters screen rather than being wasted.
          </p>
          <div className="rates">
            {/* Derived from the rate table, rarest first, rather than a hard-coded
                tier list -- the previous one said [3, 2, 1] and went stale the
                moment rarity became a 3-5 scale. */}
            {RARITIES.map((r) => (
              <span key={r} className={`rate r${r}`}>
                {'★'.repeat(r)} {(RATES[r] * 100).toFixed(0)}%
              </span>
            ))}
          </div>
        </div>

        <div className="pull-buttons">
          <button
            className="primary big"
            disabled={profile.shards < SUMMON_COST}
            onClick={() => pull(1, SUMMON_COST)}
          >
            Summon ×1
            <em>{SUMMON_COST} shards</em>
          </button>
          <button
            className="primary big"
            disabled={profile.shards < MULTI_COST}
            onClick={() => pull(MULTI_COUNT, MULTI_COST)}
          >
            Summon ×{MULTI_COUNT}
            <em>{MULTI_COST} shards — one free</em>
          </button>
          <span className="dim">You have {short(profile.shards)} shards</span>
        </div>
      </section>

      {results && (
        <section className="panel pulls">
          <div className="pulls-head">
            <strong>Results</strong>
            <button onClick={() => setResults(null)}>Clear</button>
          </div>
          <div className="pull-grid">
            {results.map((r, i) => (
              <div key={i} className={`pull r${r.def.rarity} ${r.isNew ? 'fresh' : ''}`}>
                <Figure def={r.def} height={92} />
                <span className="nm">{r.def.name}</span>
                <span className={r.isNew ? 'tag new' : 'tag dupe'}>
                  {r.isNew ? 'NEW' : `copy ${r.copies}`}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="panel">
        <h3>Collection</h3>
        <div className="collection">
          {ROSTER.map((def) => {
            const copies = profile.owned[def.id] ?? 0;
            return (
              <div key={def.id} className={`slot ${copies ? '' : 'locked'}`}>
                <Portrait def={def} size={44} />
                <span className="nm">{def.name}</span>
                <span className="dim">{copies ? `×${copies}` : '—'}</span>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
