import { useEffect, useState } from 'react';
import { ROSTER } from '../engine/content.ts';
import { short, type Profile } from '../engine/idle.ts';
import { load, save, wipe } from '../engine/save.ts';
import { applyStars, progressFor } from '../engine/stars.ts';
import { applyLevel } from '../engine/levels.ts';
import { BattleScreen } from './BattleScreen.tsx';
import { Home } from './screens/Home.tsx';
import { Characters } from './screens/Characters.tsx';
import { Summon } from './screens/Summon.tsx';
import { Inventory } from './screens/Inventory.tsx';
import { Events } from './screens/Events.tsx';

type Screen = 'home' | 'characters' | 'summon' | 'inventory' | 'events';

const TABS: { id: Screen; label: string; icon: string }[] = [
  { id: 'home', label: 'Home', icon: '⌂' },
  { id: 'characters', label: 'Characters', icon: '⚔' },
  { id: 'summon', label: 'Summon', icon: '✦' },
  { id: 'inventory', label: 'Inventory', icon: '◰' },
  { id: 'events', label: 'Events', icon: '◷' },
];

/** The party you begin with, so a fresh save can fight immediately. */
const STARTERS = ROSTER.map((d) => d.id);

const IDS = TABS.map((t) => t.id);

/** Screens are addressable by hash, so a tab survives a reload. */
function screenFromHash(): Screen {
  const raw = window.location.hash.replace('#', '') as Screen;
  return IDS.includes(raw) ? raw : 'home';
}

export function App() {
  const [profile, setProfile] = useState<Profile>(() => load(Date.now(), STARTERS));
  const [screen, setScreen] = useState<Screen>(screenFromHash);
  const [inBattle, setInBattle] = useState(false);

  // Persist on every change. Cheap at this size, and it means a closed tab never
  // costs more than the last action.
  useEffect(() => save(profile), [profile]);

  useEffect(() => {
    window.location.hash = screen;
  }, [screen]);

  useEffect(() => {
    const onHash = () => setScreen(screenFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  if (inBattle) {
    // Star picks are folded into the character sheets here, once, so nothing in
    // the battle engine needs to know the star system exists.
    const party = ROSTER.filter((d) => (profile.owned[d.id] ?? 0) > 0)
      .slice(0, 5)
      // Level growth first, then star picks, so a star's percentage is of the
      // levelled stat rather than the base sheet.
      .map((d) => applyStars(applyLevel(d, profile.levels[d.id] ?? 1), progressFor(profile.stars, d.id)));
    return <BattleScreen party={party} onExit={() => setInBattle(false)} />;
  }

  return (
    <div className="hub">
      <header className="hub-top">
        <strong className="title">Rollbound</strong>
        <div className="wallet">
          <span className="coin gold" />
          <span>{short(profile.gold)}</span>
          <span className="coin shard" />
          <span>{short(profile.shards)}</span>
          <span className="coin xp" />
          <span>{short(profile.xp)}</span>
        </div>
        <button
          className="quiet"
          title="Clear the save stored in this browser"
          onClick={() => {
            if (!confirm('Reset all progress on this device?')) return;
            wipe();
            setProfile(load(Date.now(), STARTERS));
          }}
        >
          Reset
        </button>
      </header>

      <main className="hub-body">
        {screen === 'home' && (
          <Home profile={profile} onProfile={setProfile} onBattle={() => setInBattle(true)} />
        )}
        {screen === 'characters' && <Characters profile={profile} onProfile={setProfile} />}
        {screen === 'summon' && <Summon profile={profile} onProfile={setProfile} />}
        {screen === 'inventory' && <Inventory profile={profile} />}
        {screen === 'events' && <Events profile={profile} />}
      </main>

      <nav className="hub-nav">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={screen === t.id ? 'on' : ''}
            onClick={() => setScreen(t.id)}
          >
            <span className="nav-icon">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
