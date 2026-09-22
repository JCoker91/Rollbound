import { useRef, useState } from 'react';
import { ROSTER } from '../../engine/content.ts';
import { ANIMATION_CLIPS } from '../../engine/sprites.generated.ts';

/**
 * Drop a sheet, see where it will be cut, write the frames.
 *
 * The naming conventions exist because the packer has to be told things a file
 * cannot say for itself -- which actor, which clip, how many frames. None of
 * that has to be spelled into a filename if it can be picked from a list
 * instead, and every one of those choices has a known set: the roster knows the
 * actors and their ability order, and the clip names are fixed.
 *
 * So this page is the naming convention, made into a form. `_4x1`, slot-versus-
 * name, and "why did nothing happen" (a sheet left in art/samples/) all stop
 * being things to remember.
 *
 * THE CUT IS NOT DONE HERE. The sheet is posted to the dev server, which runs
 * `scripts/split_sheet.py` -- the same cut the packer would make, because that
 * script imports the packer's own cutter. Reimplementing it against a canvas
 * would be a second answer to "where does frame 2 start", and two answers drift.
 * What this page draws is the cut positions the script reports back.
 */

/** Every clip a finished character owns. Abilities come from the roster. */
function clipsFor(id: string): { value: string; label: string }[] {
  const def = ROSTER.find((d) => d.id === id);
  const out = (def?.abilities ?? []).map((a, i) => ({
    // Filed by SLOT, because that is the choice that does not require knowing
    // how the kit spells itself -- and the label still says which ability it is.
    value: `ability_${i + 1}`,
    label: `ability_${i + 1} — ${a.name}`,
  }));
  for (const [value, label] of [
    ['idle', 'idle — resting loop'],
    ['idle_2', 'idle_2 — alternate stance'],
    ['idle_3', 'idle_3 — alternate stance'],
    ['idle_4', 'idle_4 — alternate stance'],
    ['ready', 'ready — held while walking out'],
    ['thinking', 'thinking — still, held while selected'],
    ['upgrade', 'upgrade — buying an upgrade'],
    ['move', 'move — repositioning'],
    ['celebration', 'celebration — victory'],
    ['celebration_ending', 'celebration_ending — the pose it settles into'],
  ] as const) {
    out.push({ value, label });
  }
  return out;
}

interface Cut {
  width: number;
  height: number;
  cols: number;
  rows: number;
  frames: number;
  xs: number[];
  ys: number[];
  inferred: boolean;
  refused: boolean;
  seams: string[];
}

export function SheetDrop() {
  const [who, setWho] = useState(ROSTER[0]?.id ?? '');
  const [clip, setClip] = useState('idle');
  const [grid, setGrid] = useState('');
  const [bleed, setBleed] = useState(false);
  const [png, setPng] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [cut, setCut] = useState<Cut | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  /**
   * How many frames this clip already has.
   *
   * Not a blocker. A clip does not have to come from one sheet -- a celebration
   * might be a back-flip generated on its own followed by a sword-raise from
   * another pass -- so an existing clip is an invitation to add to it, and the
   * only question is whether that is what you meant.
   */
  const already = (ANIMATION_CLIPS[who] ?? {})[clip]?.frames ?? 0;
  const [append, setAppend] = useState(false);
  const blocked = already > 0 && !append;

  async function post(payload: Record<string, unknown>) {
    const r = await fetch('/__art/upload', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
    return j;
  }

  /** Read the drop, then ask the server where it would cut. */
  async function take(file: File) {
    setError(null);
    setStatus(null);
    setCut(null);
    setToken(null);
    const url = await new Promise<string>((done, stop) => {
      const fr = new FileReader();
      fr.onload = () => done(String(fr.result));
      fr.onerror = () => stop(new Error('could not read that file'));
      fr.readAsDataURL(file);
    });
    setPng(url);
    setBusy(true);
    try {
      const j = await post({ mode: 'analyse', png: url, grid: grid || undefined });
      setToken(j.token);
      setCut(j.cut);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  /** Re-ask with a different grid, without re-uploading. */
  async function reanalyse(next: string) {
    setGrid(next);
    if (!png) return;
    setBusy(true);
    try {
      const j = await post({ mode: 'analyse', png, grid: next || undefined });
      setToken(j.token);
      setCut(j.cut);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const j = await post({
        mode: 'commit',
        who,
        clip,
        grid: grid || undefined,
        bleed: bleed ? '10%' : undefined,
        append: append || undefined,
        token,
      });
      setStatus(j.log || 'written');
      setPng(null);
      setCut(null);
      setToken(null);
      if (fileRef.current) fileRef.current.value = '';
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sheet-drop">
      <h2>Drop a sprite sheet</h2>
      <p className="dim">
        Pick who it belongs to and what it is. The file is named, cut and filed for you — there is no
        convention to remember. The cut is made by <code>scripts/split_sheet.py</code>, so it is the
        same cut the packer would make.
      </p>

      <div className="drop-form">
        <label>
          Character
          <select
            value={who}
            onChange={(e) => {
              setWho(e.target.value);
              setStatus(null);
              setAppend(false);
            }}
          >
            {ROSTER.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Clip
          <select
            value={clip}
            onChange={(e) => {
              setClip(e.target.value);
              setAppend(false);
            }}
          >
            {clipsFor(who).map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
                {(ANIMATION_CLIPS[who] ?? {})[c.value] ? '  ✓ has art' : ''}
              </option>
            ))}
          </select>
        </label>

        <label>
          Frames across
          <select value={grid} onChange={(e) => reanalyse(e.target.value)}>
            <option value="">work it out</option>
            {[2, 3, 4, 5, 6, 8, 12, 16].map((n) => (
              <option key={n} value={`${n}x1`}>
                {n}
              </option>
            ))}
          </select>
        </label>

        <label className="drop-check" title="Use when a drawing crosses into the next frame">
          <input type="checkbox" checked={bleed} onChange={(e) => setBleed(e.target.checked)} />
          Cut wide (overlapping art)
        </label>
      </div>

      {already > 0 && (
        <div className="drop-existing">
          <p>
            <code>{clip}</code> already has <strong>{already}</strong> frame
            {already === 1 ? '' : 's'}.
          </p>
          <label className="drop-check">
            <input
              type="checkbox"
              checked={append}
              onChange={(e) => setAppend(e.target.checked)}
            />
            Add these frames to it
          </label>
          <p className="dim">
            New frames go on the <strong>end</strong>. Move them where you want in the anim lab —
            it can reorder, duplicate and disable frames while the clip plays, which is a better
            place to decide order than a file listing. To replace the clip instead, delete{' '}
            <code>
              art/actors/{who}/animations/{clip}/
            </code>
            .
          </p>
        </div>
      )}

      <div
        className="drop-zone"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files[0];
          if (f) take(f);
        }}
        onClick={() => fileRef.current?.click()}
      >
        <input
          ref={fileRef}
          type="file"
          accept="image/png"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) take(f);
          }}
        />
        {png ? <SheetPreview png={png} cut={cut} /> : <span>Drop a PNG here, or click to pick one</span>}
      </div>

      {busy && <p className="dim">working…</p>}
      {error && <p className="warn-line">{error}</p>}

      {cut && (
        <div className="drop-report">
          <p>
            <strong>
              {cut.width}×{cut.height}
            </strong>{' '}
            → <strong>{cut.frames}</strong> frame{cut.frames === 1 ? '' : 's'}{' '}
            {cut.inferred ? <em>(worked out from the size)</em> : <em>(you chose {grid})</em>}
          </p>
          {cut.refused && (
            <p className="warn-line">
              That is almost certainly wrong — a sheet whose cells are not square cannot be counted
              from its size. Pick the number of frames above.
            </p>
          )}
          {cut.seams.map((sm) => (
            <p key={sm} className="warn-line">
              {sm}
              {!bleed && ' — tick “cut wide” and it will keep both drawings whole.'}
            </p>
          ))}
          <button className="primary" disabled={busy || cut.refused || blocked} onClick={commit}>
            {append ? 'Add' : 'Cut into'} {cut.frames} file{cut.frames === 1 ? '' : 's'}
            {append ? ' to the end' : ' and save'}
          </button>
        </div>
      )}

      {status && (
        <pre className="drop-log">
          {status}
          {'\n\n'}Packed and live. Tune it in the anim lab.
        </pre>
      )}
    </div>
  );
}

/**
 * The sheet with the cut drawn on it.
 *
 * Positions come from the server, in the sheet's own pixels, so this is pure
 * rendering -- percentages of the natural size, which survives whatever width
 * the image is displayed at.
 */
function SheetPreview({ png, cut }: { png: string; cut: Cut | null }) {
  return (
    <div className="sheet-preview">
      <img src={png} alt="" />
      {cut &&
        cut.xs.slice(1, -1).map((x) => (
          <span key={x} className="cut-line" style={{ left: `${(x / cut.width) * 100}%` }} />
        ))}
      {cut &&
        cut.ys.slice(1, -1).map((y) => (
          <span key={y} className="cut-line flat" style={{ top: `${(y / cut.height) * 100}%` }} />
        ))}
    </div>
  );
}
