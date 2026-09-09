import type { CharacterDef, Element, Role, Side } from '../engine/types.ts';

/**
 * Character tokens: a role glyph on an element-tinted badge.
 *
 * Deliberately not portraits. These render at ~40px on top of detailed map art,
 * where facial detail turns to noise. What a player needs mid-battle is "which
 * of mine is the tank" and "is that one an archer", so the glyph carries the
 * combat role, the badge carries the element, and the pips carry rarity.
 *
 * Sides are separated three ways at once, because shape alone was not enough to
 * tell them apart at a glance: allies are rounded with a green rim, enemies are
 * angular shards with a red rim and a red wash over the element colour.
 */

interface Palette {
  light: string;
  deep: string;
  rim: string;
}

const PALETTE: Record<Element, Palette> = {
  fire: { light: '#ff8a5c', deep: '#5e1a10', rim: '#ffb98a' },
  wind: { light: '#5fd0a0', deep: '#0f3a2b', rim: '#a8f0d0' },
  earth: { light: '#d4a75f', deep: '#453016', rim: '#f2d69e' },
  // Vivid and electric against `light`'s muted gold. The two are the closest
  // pair in the set, and they get away with it because they are never in the
  // same cycle -- within fire/wind/earth/water, yellow is unclaimed.
  lightning: { light: '#ffd42a', deep: '#4a3a05', rim: '#fff3a8' },
  water: { light: '#4aa6ef', deep: '#0f3358', rim: '#a8d8ff' },
  light: { light: '#f5dc7a', deep: '#544413', rim: '#fff6c4' },
  dark: { light: '#a77fd6', deep: '#2e1548', rim: '#ddc6f5' },
};

export function Avatar({
  def,
  size = 44,
  side = 'player',
}: {
  def: CharacterDef;
  size?: number;
  side?: Side;
}) {
  const p = PALETTE[def.element];
  const foe = side === 'enemy';
  const gid = `bdg-${foe ? 'e' : 'a'}-${def.id}`;
  // Allies read as rounded tokens; enemies as angular shards with spiked corners.
  const shape = foe
    ? 'M32 1 L47 9 L63 6 L58 22 L63 32 L58 42 L63 58 L47 55 L32 63 L17 55 L1 58 L6 42 L1 32 L6 22 L1 6 L17 9 Z'
    : 'M14 2 H50 A12 12 0 0 1 62 14 V50 A12 12 0 0 1 50 62 H14 A12 12 0 0 1 2 50 V14 A12 12 0 0 1 14 2 Z';
  // Rim colour is the side, not the element -- it is the fastest read on a board.
  const rim = foe ? '#ff6a6a' : '#7ce8a4';

  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className="avatar"
      role="img"
      aria-label={`${def.name}, ${def.element} ${def.role}`}
    >
      <defs>
        <linearGradient id={`${gid}-g`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={p.light} />
          <stop offset="100%" stopColor={p.deep} />
        </linearGradient>
      </defs>

      <path d={shape} fill={`url(#${gid}-g)`} stroke={rim} strokeWidth="4" />

      {/* Enemies get a red wash so the element gradient never reads as friendly. */}
      {foe && <path d={shape} fill="#c01f2e" opacity="0.34" />}

      {/* Glyph sits on a dark plate so it stays legible on the pale elements. */}
      <path
        d={shape}
        fill="rgba(0,0,0,0.34)"
        transform="translate(32 32) scale(0.7) translate(-32 -32)"
      />

      {/* Lifted and shrunk slightly to clear the rarity strip below. */}
      <g
        fill="#fdfdff"
        stroke="rgba(0,0,0,0.55)"
        strokeWidth="1"
        strokeLinejoin="round"
        transform="translate(32 29) scale(0.86) translate(-32 -32)"
      >
        {def.icon ? <Creature icon={def.icon} /> : <Glyph role={def.role} />}
      </g>

      {/* Pips need their own dark strip -- unbacked they vanished into the glyph. */}
      <rect x="14" y="47" width="36" height="11" rx="5" fill="rgba(0,0,0,0.55)" />
      {Array.from({ length: def.rarity }, (_, i) => (
        <circle key={i} cx={32 + (i - (def.rarity - 1) / 2) * 10} cy="52.5" r="3" fill={p.rim} />
      ))}
    </svg>
  );
}

/**
 * Monster silhouettes. Enemies are creatures rather than classes, so they get a
 * shape that says what they ARE; player characters keep the role glyph that says
 * what they DO. Drawn bold and solid to stay readable at 40px over map art.
 */
function Creature({ icon }: { icon: string }) {
  switch (icon) {
    case 'husk': // charred skull wreathed in flame
      return (
        <>
          <path d="M25 6 q2-6 5-5 q-2 5 2 6 z" />
          <path d="M36 7 q3-5 6-3 q-3 4 0 6 z" />
          <path d="M32 12 C42 12 47 20 47 28 C47 34 44 38 40 40 V46 H24 V40 C20 38 17 34 17 28 C17 20 22 12 32 12 Z" />
          <circle cx="25" cy="28" r="4.6" fill="rgba(0,0,0,0.62)" stroke="none" />
          <circle cx="39" cy="28" r="4.6" fill="rgba(0,0,0,0.62)" stroke="none" />
          <path d="M27 41 h3 v5 h-3 z M34 41 h3 v5 h-3 z" fill="rgba(0,0,0,0.55)" stroke="none" />
        </>
      );

    case 'wisp': // floating orb trailing vapour
      return (
        <>
          <circle cx="32" cy="23" r="13" />
          <circle cx="32" cy="23" r="5.5" fill="rgba(0,0,0,0.55)" stroke="none" />
          {/* One drifting tail plus loose motes; three stubs read as fangs. */}
          <path d="M32 35 q-7 6 -4 12 q8-4 7-12 z" />
          <circle cx="23" cy="42" r="2.6" />
          <circle cx="41" cy="44" r="2" />
        </>
      );

    case 'golem': // blocky stone body with slab arms
      return (
        <>
          <rect x="25" y="10" width="14" height="10" rx="2" />
          <path d="M22 21 H42 L45 46 H19 Z" />
          {/* Arms hang lower and tuck in; set wide they read as ears. */}
          <rect x="12" y="27" width="8" height="16" rx="2.5" />
          <rect x="44" y="27" width="8" height="16" rx="2.5" />
          <path d="M31 25 L28 33 L34 32 L31 42" fill="none" stroke="rgba(0,0,0,0.5)" strokeWidth="2.4" />
        </>
      );

    case 'shade': // hooded wraith fading into vapour
      return (
        <>
          <path d="M32 8 C43 8 49 18 49 29 V38 Q41 46 32 42 Q23 46 15 38 V29 C15 18 21 8 32 8 Z" />
          <path d="M32 15 C39 15 43 21 43 28 Q43 35 32 37 Q21 35 21 28 C21 21 25 15 32 15 Z" fill="rgba(0,0,0,0.66)" stroke="none" />
          <circle cx="27" cy="27" r="2.7" fill="#fdfdff" stroke="none" />
          <circle cx="37" cy="27" r="2.7" fill="#fdfdff" stroke="none" />
          <path d="M20 41 q5 6 12 4 q7 2 12-4 q-4 9 -12 7 q-8 2 -12-7 z" />
        </>
      );

    case 'seraph': // winged figure beneath a broken halo
      return (
        <>
          {/* Detailed wings turn to mush at 40px -- horizontal ones read as a
              bowtie, swept-up ones as leaves. The halo is the signifier that
              survives, so it carries the silhouette and the wings only hint. */}
          <ellipse cx="32" cy="9" rx="11" ry="4" fill="none" stroke="#fdfdff" strokeWidth="3.4" />
          <circle cx="32" cy="22" r="6.2" />
          <path d="M32 28 L45 50 H19 Z" />
          <path d="M20 30 C11 30 6 36 5 43 C12 42 18 38 21 34 Z" />
          <path d="M44 30 C53 30 58 36 59 43 C52 42 46 38 43 34 Z" />
        </>
      );

    default:
      return null;
  }
}

function ShortBlade() {
  return (
    <>
      <path d="M32 15 L35.5 22 V37 H28.5 V22 Z" />
      <rect x="24" y="37" width="16" height="4" rx="1.4" />
      <rect x="30" y="41" width="4" height="8" rx="1.4" />
    </>
  );
}

function Glyph({ role }: { role: Role }) {
  switch (role) {
    case 'blade': // upright sword — melee damage
      return (
        <>
          <path d="M32 9 L37 18 V37 H27 V18 Z" />
          <rect x="20" y="37" width="24" height="5" rx="1.5" />
          <rect x="29.5" y="42" width="5" height="9" />
          <circle cx="32" cy="53" r="3.4" />
        </>
      );

    case 'shield': // kite shield — tank
      return (
        <>
          <path d="M32 9 L50 15 V32 C50 42 42 49 32 54 C22 49 14 42 14 32 V15 Z" />
          <path d="M32 17 L43 21 V32 C43 38 38 43 32 46 C26 43 21 38 21 32 V21 Z" fill="rgba(0,0,0,0.45)" stroke="none" />
        </>
      );

    case 'staff': // orb-topped staff — healer / caster
      return (
        <>
          <rect x="29.5" y="22" width="5" height="33" rx="2" />
          <circle cx="32" cy="16" r="9" />
          <circle cx="32" cy="16" r="4" fill="rgba(0,0,0,0.5)" stroke="none" />
        </>
      );

    case 'dagger': // crossed daggers — assassin.
      // A single dagger was indistinguishable from the sword at 40px; crossing
      // two of them reads instantly and differently from every other glyph.
      return (
        // Scaled up, since crossing them shrinks each blade's apparent size.
        <g transform="translate(32 32) scale(1.18) translate(-32 -32)">
          <g transform="rotate(-30 32 32)">
            <ShortBlade />
          </g>
          <g transform="rotate(30 32 32)">
            <ShortBlade />
          </g>
        </g>
      );

    case 'bow': // drawn bow — ranged damage
      return (
        <>
          <path
            d="M22 11 C40 22 40 42 22 53"
            fill="none"
            stroke="#fdfdff"
            strokeWidth="5"
            strokeLinecap="round"
          />
          <path d="M22 11 L22 53" fill="none" stroke="#fdfdff" strokeWidth="2.2" />
          <path d="M20 32 H46" fill="none" stroke="#fdfdff" strokeWidth="3.4" strokeLinecap="round" />
          <path d="M40 26 L48 32 L40 38 Z" />
        </>
      );

    case 'banner': // standard — buffer / support
      return (
        <>
          <rect x="21" y="9" width="4.5" height="46" rx="2" />
          <path d="M25.5 13 H50 L43 24 L50 35 H25.5 Z" />
          <circle cx="23.2" cy="7" r="3.2" />
        </>
      );
  }
}
