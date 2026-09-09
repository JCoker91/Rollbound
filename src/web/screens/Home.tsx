import { useEffect, useRef, useState } from 'react';
import { ROSTER, BESTIARY } from '../../engine/content.ts';
import { accrued, claim, duration, ratesFor, short, type Profile } from '../../engine/idle.ts';
import { Figure } from '../Figure.tsx';

/**
 * The idle hub.
 *
 * The scene in the middle is theatre, not simulation: your party endlessly
 * whittles down a training dummy while rewards tick up. It shares no state with
 * the real battle engine on purpose -- this is a progress bar with a costume,
 * and coupling it to combat would mean running a whole fight to animate a loop.
 */

interface Hit {
  id: number;
  amount: number;
  x: number;
}

const STRIKE_INTERVAL = 1400;

export function Home({
  profile,
  onProfile,
  onBattle,
}: {
  profile: Profile;
  onProfile: (p: Profile) => void;
  onBattle: () => void;
}) {
  const party = ROSTER.filter((d) => (profile.owned[d.id] ?? 0) > 0).slice(0, 5);
  // A sparring dummy for the idle scene, from the bestiary rather than the
  // deployed lineup -- the hub should show a creature, not whatever the
  // current test encounter happens to field.
  const dummy = BESTIARY.find((e) => e.id === 'golem') ?? BESTIARY[0]!;

  const [striker, setStriker] = useState(-1);
  const [hits, setHits] = useState<Hit[]>([]);
  const hitId = useRef(0);
  /** Re-render on a timer so the pending-reward figures count up live. */
  const [, tick] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  // The attack loop: one party member swings, the dummy takes a number.
  useEffect(() => {
    if (party.length === 0) return;
    let i = 0;
    const id = window.setInterval(() => {
      i = (i + 1) % party.length;
      setStriker(i);
      window.setTimeout(() => setStriker(-1), 420);

      const amount = 40 + Math.floor(Math.random() * 220);
      const entry = { id: hitId.current++, amount, x: 40 + Math.random() * 40 };
      setHits((h) => [...h, entry]);
      window.setTimeout(() => setHits((h) => h.filter((n) => n.id !== entry.id)), 900);
    }, STRIKE_INTERVAL);
    return () => window.clearInterval(id);
  }, [party.length]);

  const pending = accrued(profile, Date.now());
  const rates = ratesFor(profile.stage);
  const canClaim = pending.gold > 0 || pending.shards > 0 || pending.xp > 0;

  return (
    <div className="home">
      <section className="scene">
        <div className="scene-art">
          {party.map((def, i) => (
            <Figure
              key={def.id}
              def={def}
              height={104}
              striking={striker === i}
              className={`party-member p${i}`}
            />
          ))}

          <div className="dummy">
            <Figure def={dummy} height={110} facing={-1} />
            {hits.map((h) => (
              <span key={h.id} className="scene-hit" style={{ left: `${h.x}%` }}>
                -{h.amount}
              </span>
            ))}
          </div>
        </div>

        <div className="scene-caption">
          Stage {profile.stage} · per minute: {short(rates.goldPerMin)} gold,{' '}
          {rates.shardsPerMin.toFixed(1)} shards, {short(rates.xpPerMin)} XP
        </div>
      </section>

      <section className="panel claim">
        <div className="claim-head">
          <strong>Idle rewards</strong>
          <span className="dim">
            {pending.capped
              ? 'Storage full — collect to keep earning'
              : `accumulating for ${duration(pending.seconds)}`}
          </span>
        </div>

        <div className="claim-body">
          <div className="reward">
            <span className="coin gold" />
            <strong>{short(pending.gold)}</strong>
          </div>
          <div className="reward">
            <span className="coin shard" />
            <strong>{short(pending.shards)}</strong>
          </div>
          <div className="reward">
            <span className="coin xp" />
            <strong>{short(pending.xp)}</strong>
          </div>
          <button
            className="primary big"
            disabled={!canClaim}
            onClick={() => onProfile(claim(profile, Date.now()).profile)}
          >
            {canClaim ? 'Collect' : 'Nothing yet'}
          </button>
        </div>
      </section>

      <section className="quick">
        <button className="primary big" onClick={onBattle}>
          Battle — Stage {profile.stage}
        </button>
        <p className="dim">
          Clearing a stage raises your idle rate. Rewards keep building for up to 8 hours
          while you are away.
        </p>
      </section>
    </div>
  );
}
