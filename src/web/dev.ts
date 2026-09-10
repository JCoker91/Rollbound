import { useSyncExternalStore } from 'react';

/**
 * Whether the dev tools are on, and how to turn them on and off.
 *
 * Two screens ask this question -- the hub, for the Animation Lab tab, and the
 * battle, for the stage picker and party-level box -- and they must agree, so
 * the answer lives in one place rather than being re-derived in each.
 *
 * The flag is a QUERY PARAM first and a stored preference second:
 *
 *   ?dev=1     turns the tools on for this page, and remembers it
 *   ?dev=0     turns them off for this page, and remembers that
 *   no param   whatever was remembered last
 *
 * A query param alone is not enough, which is what this module exists to fix.
 * The param was the whole gate, and it is lost by anything that retypes the
 * URL -- a bookmark, a paste of `localhost:5173`, a hand-edit that keeps the
 * hash and drops the search. The tools then vanish with no error and no
 * explanation, and the battle bar shows a lone Home button, which reads as a
 * missing feature rather than a dropped flag.
 *
 * The param still WINS when present, because being able to force the tools on
 * or off from the address bar is the reason it was a param to begin with:
 * opening them against a production build, or playing the real game on the dev
 * server without them. Remembering is a convenience layered under that, never
 * over it.
 */

const KEY = 'stagebound.dev';

/**
 * Storage that cannot throw.
 *
 * `localStorage` is not merely empty in a private window or with site data
 * blocked -- the accessor itself raises, and an exception here would take the
 * whole app down before it rendered. A forgotten preference is a fine outcome;
 * a blank page is not.
 */
function remembered(): boolean | null {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === null ? null : v === '1';
  } catch {
    return null;
  }
}

function remember(on: boolean): void {
  try {
    window.localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    /* Nothing to do: the flag stays per-URL for this browser. */
  }
}

function read(): boolean {
  const param = new URLSearchParams(window.location.search).get('dev');
  if (param !== null) {
    // Present and explicit: honour it, and make it the new default.
    const on = param !== '0' && param !== 'false';
    remember(on);
    return on;
  }
  return remembered() ?? false;
}

/**
 * Whether to offer the way IN to dev mode. Build-time, because a way in has to
 * exist before the flag is set -- and a button that turns on dev tools has no
 * business existing in a shipped build.
 */
export const SHOW_DEV_ENTRY = import.meta.env.DEV;

/*
 * The flag is LIVE, not read once at module load.
 *
 * It used to be a constant, and flipping it did a full page navigation to make
 * the new value take effect. That was fine while the switch lived in the hub's
 * header, and stopped being fine the moment it became reachable from every
 * screen: flipping it mid-fight reloaded the app and threw the battle away,
 * which is precisely the thing you were about to inspect. Switching between
 * playing live and testing under set parameters has to be free.
 *
 * A tiny store rather than React context, because two unrelated trees read it
 * -- the hub and the battle screen -- and the floating badge sits outside
 * both.
 */
let current = read();
const listeners = new Set<() => void>();

const subscribe = (fn: () => void): (() => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/**
 * The current value, for code that is not a component.
 *
 * A function and not a constant on purpose: an exported `const` would capture
 * the value at import time, which is the bug this replaced.
 */
export const devTools = (): boolean => current;

/** The current value, re-rendering the caller when it changes. */
export function useDevTools(): boolean {
  return useSyncExternalStore(subscribe, devTools, devTools);
}

/**
 * Flip dev mode. No reload: state updates, and the URL is rewritten in place
 * so the address bar still states which mode you are in and a copied link
 * still carries it.
 */
export function setDevTools(on: boolean): void {
  if (on === current) return;
  current = on;
  remember(on);

  const url = new URL(window.location.href);
  // Written explicitly in both directions rather than deleted when off, so the
  // URL always states the mode rather than merely failing to deny it.
  url.searchParams.set('dev', on ? '1' : '0');
  window.history.replaceState(null, '', url);

  for (const fn of listeners) fn();
}
