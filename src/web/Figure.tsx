import type { CSSProperties } from 'react';
import type { CharacterDef } from '../engine/types.ts';
import { Avatar } from './Avatar.tsx';

/**
 * A character drawn at an arbitrary size, outside a battle.
 *
 * The battle board has its own unit renderer because it also carries HP, side
 * colour and turn state. This is the plain version for menus and the idle scene:
 * sprite art where a character has it, role badge where they do not, so a roster
 * half-way through getting art still renders cleanly.
 */
export function Figure({
  def,
  height,
  facing = 1,
  striking = false,
  className = '',
}: {
  def: CharacterDef;
  height: number;
  /** 1 as drawn (facing right), -1 mirrored. */
  facing?: number;
  striking?: boolean;
  className?: string;
}) {
  const sheet = def.sprite;

  if (!sheet) {
    return (
      <span className={`figure badge ${striking ? 'striking' : ''} ${className}`}>
        <Avatar def={def} size={height * 0.7} />
      </span>
    );
  }

  const w = height * sheet.aspect;
  return (
    <span
      className={`figure ${striking ? 'striking' : ''} ${className}`}
      style={{ width: w, height } as CSSProperties}
    >
      <img
        src={sheet.src}
        alt=""
        draggable={false}
        style={{
          width: w,
          height,
          // Mirror about the feet so a flipped character keeps its footing.
          transform: `scaleX(${facing})`,
          transformOrigin: `${w * sheet.anchorX}px bottom`,
        }}
      />
    </span>
  );
}

/** Square headshot, falling back to the role badge. */
export function Portrait({ def, size = 48 }: { def: CharacterDef; size?: number }) {
  if (def.sprite?.icon) {
    return (
      <img
        className="portrait"
        src={def.sprite.icon}
        alt=""
        draggable={false}
        style={{ width: size, height: size, flex: 'none' }}
      />
    );
  }
  return <Avatar def={def} size={size} />;
}
