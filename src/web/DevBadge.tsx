import { SHOW_DEV_ENTRY, setDevTools, useDevTools } from './dev.ts';

/**
 * The dev switch, floating over whatever is on screen.
 *
 * It is rendered outside the hub/battle branch and fixed to the viewport, so
 * it is reachable from every screen including a fight -- the battle screen
 * replaces the hub entirely, and a toggle that lived in the hub's chrome
 * vanished exactly when you were most likely to want it. Flipping it costs
 * nothing: no reload, so a fight in progress survives the switch.
 *
 * The separation is the point of the component. With the switch off, nothing
 * in the game's own chrome hints that any of this exists: the header is a
 * title and a wallet, the nav is five tabs. Turning it on raises a panel of
 * tools ABOVE the switch -- the lab, the save wipe -- visibly laid over the
 * game rather than mixed into it, and leaving the switch itself a single
 * control that never changes shape.
 */
export function DevBadge({
  /** Sit above the hub's nav bar rather than in the corner it occupies. */
  overNav = false,
  /** Open the animation lab. Omitted where it cannot be reached, e.g. mid-fight. */
  onLab,
  /** Wipe the save. Omitted for the same reason. */
  onReset,
  /** Whether the lab is the screen currently showing. */
  labActive = false,
  /** Open the stage lab, where battle scenes are composed. */
  onStage,
  stageActive = false,
  onTips,
  tipsActive = false,
  onDrop,
  dropActive = false,
}: {
  overNav?: boolean;
  onLab?: () => void;
  onReset?: () => void;
  labActive?: boolean;
  onStage?: () => void;
  stageActive?: boolean;
  /** Open the toolbox: the commands and filename rules, one click from the lab. */
  onTips?: () => void;
  tipsActive?: boolean;
  /** Open the sheet drop, where art is uploaded and cut. */
  onDrop?: () => void;
  dropActive?: boolean;
}) {
  const dev = useDevTools();

  // Nothing at all in a shipped build -- unless the tools were turned on by
  // URL, in which case the switch has to exist or there is no way back out.
  if (!SHOW_DEV_ENTRY && !dev) return null;

  return (
    <>
      {/*
        The tools, in a panel of their own stacked above the switch.
        They were inside the badge, which made the switch grow a row of
        unrelated buttons the moment it was flipped -- so the thing you click
        constantly changed size and position depending on its own state. The
        switch is one control and keeps one shape; anything it REVEALS belongs
        in something else.
      */}
      {dev && (onLab || onStage || onTips || onDrop || onReset) && (
        <div className={`dev-panel${overNav ? ' over-nav' : ''}`}>
          <span className="dev-panel-title">Dev tools</span>
          {onLab && (
            <button
              className={`quiet dev-link${labActive ? ' on' : ''}`}
              title="Frame timing, offsets and ordering for every sprite sheet"
              onClick={onLab}
            >
              ▶ Anim lab
            </button>
          )}
          {onStage && (
            <button
              className={`quiet dev-link${stageActive ? ' on' : ''}`}
              title="Compose a battle scene: add props, place them, save it"
              onClick={onStage}
            >
              ▦ Stage lab
            </button>
          )}
          {onDrop && (
            <button
              className={`quiet dev-link${dropActive ? ' on' : ''}`}
              title="Drop a sprite sheet: it is named, cut into frames and filed for you"
              onClick={onDrop}
            >
              ⤓ Drop art
            </button>
          )}
          {onTips && (
            <button
              className={`quiet dev-link${tipsActive ? ' on' : ''}`}
              title="Commands, art filenames, and what to check when something looks wrong"
              onClick={onTips}
            >
              ? Toolbox
            </button>
          )}
          {onReset && (
            <button
              className="quiet dev-link"
              title="Clear the save stored in this browser"
              onClick={onReset}
            >
              Reset save
            </button>
          )}
        </div>
      )}

      {/*
        A switch, not a link, and alone.
        Its label stays the word "Dev" in both states and a lamp beside it
        carries the state, because a button whose TEXT changes reads as two
        different buttons -- and it used to navigate to the animation lab as it
        turned on, which made it look like a link to that screen rather than a
        mode being flipped. It stays exactly where you are now, and reaching
        the lab is a separate, visible step in the panel above.
      */}
      <div className={`dev-badge${overNav ? ' over-nav' : ''}`}>
        <button
          className={`quiet dev-entry${dev ? ' on' : ''}`}
          aria-pressed={dev}
          title={dev ? 'Dev tools are ON — click to turn off' : 'Turn dev tools on'}
          onClick={() => setDevTools(!dev)}
        >
          <span className="dev-led" aria-hidden="true" />
          Dev
        </button>
      </div>
    </>
  );
}
