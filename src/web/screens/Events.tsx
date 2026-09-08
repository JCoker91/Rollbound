import { duration, type Profile } from '../../engine/idle.ts';

/**
 * Events.
 *
 * A shell. The countdowns below are computed from real clock time so the screen
 * behaves like the finished thing, but nothing here grants rewards yet -- there
 * is no event system behind it, and each card says so.
 */

interface EventDef {
  id: string;
  name: string;
  blurb: string;
  /** Hours from now that this notional event ends. */
  endsInHours: number;
  tone: 'banner' | 'raid' | 'daily';
}

const EVENTS: EventDef[] = [
  {
    id: 'rally',
    name: 'Market Quarter Rally',
    blurb: 'Double idle shards while the quarter is contested.',
    endsInHours: 42,
    tone: 'banner',
  },
  {
    id: 'seraph',
    name: 'The Fallen Seraph',
    blurb: 'A boss stage that telegraphs one devastating strike. Walk out of it.',
    endsInHours: 9,
    tone: 'raid',
  },
  {
    id: 'daily',
    name: 'Daily dispatch',
    blurb: 'Clear one stage for a shard bundle. Resets every day.',
    endsInHours: 5,
    tone: 'daily',
  },
];

export function Events({ profile }: { profile: Profile }) {
  const now = Date.now();

  return (
    <div className="events">
      <section className="panel">
        <h3>Active</h3>
        <p className="dim">
          None of these are wired up yet — no event grants anything. The countdowns are
          real so the layout behaves honestly; the rewards are not.
        </p>
      </section>

      {EVENTS.map((e) => {
        // Anchored to the profile clock so the countdown is stable across reloads
        // rather than resetting every time the screen mounts.
        const ends = profile.lastTickAt + e.endsInHours * 3600 * 1000;
        const left = Math.max(0, (ends - now) / 1000);
        return (
          <section key={e.id} className={`panel event ${e.tone}`}>
            <div className="event-head">
              <strong>{e.name}</strong>
              <span className="tag">{e.tone}</span>
            </div>
            <p className="dim">{e.blurb}</p>
            <div className="event-foot">
              <span className="dim">{left > 0 ? `${duration(left)} remaining` : 'ended'}</span>
              <button disabled>Not implemented</button>
            </div>
          </section>
        );
      })}
    </div>
  );
}
