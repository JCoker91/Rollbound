import { short, type Profile } from '../../engine/idle.ts';

/**
 * Inventory.
 *
 * Currencies are real and read from the profile. Everything below them is a
 * placeholder shelf: the item system does not exist yet, and inventing fake
 * counts would make it look finished when nothing is wired up.
 */

interface Slot {
  name: string;
  note: string;
  icon: string;
}

const PLANNED: Slot[] = [
  { name: 'Upgrade materials', note: 'Spent raising a character between stages', icon: '⚒' },
  { name: 'Skill tomes', note: 'Unlock nodes on a character skill tree', icon: '📘' },
  { name: 'Element cores', note: 'Reroll or reweight a character element', icon: '◈' },
  { name: 'Stage keys', note: 'Retry a cleared stage for extra drops', icon: '🗝' },
];

export function Inventory({ profile }: { profile: Profile }) {
  return (
    <div className="inventory">
      <section className="panel">
        <h3>Currency</h3>
        <div className="currency-grid">
          <div className="currency">
            <span className="coin gold" />
            <div>
              <strong>{short(profile.gold)}</strong>
              <p className="dim">Gold — earned idle, spent on upgrades</p>
            </div>
          </div>
          <div className="currency">
            <span className="coin shard" />
            <div>
              <strong>{short(profile.shards)}</strong>
              <p className="dim">Shards — earned idle, spent summoning</p>
            </div>
          </div>
          <div className="currency">
            <span className="coin xp" />
            <div>
              <strong>{short(profile.xp)}</strong>
              <p className="dim">Experience — earned idle, spent levelling characters</p>
            </div>
          </div>
        </div>
      </section>

      <section className="panel">
        <h3>Items</h3>
        <p className="dim">
          Nothing here yet — the item system is not built. These are the slots it is
          planned around, listed so the shape is visible rather than faked with numbers.
        </p>
        <div className="item-grid">
          {PLANNED.map((s) => (
            <div key={s.name} className="item empty">
              <span className="item-icon">{s.icon}</span>
              <div>
                <strong>{s.name}</strong>
                <p className="dim">{s.note}</p>
              </div>
              <span className="tag">planned</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
