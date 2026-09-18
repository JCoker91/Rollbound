import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Lets the animation lab save its edits back to `art/actors/<name>/<name>.anim.json`.
 *
 * A browser page cannot write to the repo, and the alternatives are both bad:
 * downloading a file leaves you to move it by hand, and copying JSON to paste
 * into an editor makes every small nudge a chore. Since the lab only exists on
 * the dev server, the dev server is the natural place to do the write.
 *
 * `apply: 'serve'` means this never exists in a production build. It still
 * validates its inputs, because a dev server is reachable from the network if
 * anyone runs it with `--host`:
 *
 *   - `who` and `clip` are matched against a strict character set, so neither
 *     can contain a path separator or `..`
 *   - the resolved path is checked to be inside `art/actors/<who>/`, so a name
 *     that slips the pattern still cannot escape
 *   - the actor's folder must already exist, so this can only write beside art
 *     that is already there
 */
function animationSaver(): Plugin {
  const NAME = /^[a-z0-9][a-z0-9_]*$/;
  const root = process.cwd();

  return {
    name: 'stagebound:animation-saver',
    apply: 'serve',
    configureServer(server) {
      /*
       * The stage lab's save, alongside the animation lab's.
       *
       * Same shape and same reasons: one file per scene under art/, written
       * whole because a scene IS its layer list -- there is no per-field merge
       * to do, and reordering layers is an edit to the list itself.
       */
      server.middlewares.use('/__scene/save', (req, res) => {
        const fail = (code: number, error: string) => {
          res.statusCode = code;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ error }));
        };
        if (req.method !== 'POST') return fail(405, 'POST only');

        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
          if (body.length > 2_000_000) req.destroy();
        });
        req.on('end', () => {
          try {
            const { id, name, layers, board, enemy, stages, acts } = JSON.parse(body) as {
              id?: string;
              name?: string;
              layers?: unknown[];
              board?: unknown[];
              enemy?: unknown[];
              stages?: unknown;
              acts?: unknown;
            };
            if (!id || !NAME.test(id)) return fail(400, 'bad scene id');
            if (!Array.isArray(layers)) return fail(400, 'layers must be an array');
            for (const l of layers) {
              const src = (l as { src?: unknown })?.src;
              // Published scenery only. A scene file becomes a URL the game
              // fetches, so an arbitrary string here would be an open redirect
              // dressed up as a prop.
              if (typeof src !== 'string' || !src.startsWith('/background/') || src.includes('..')) {
                return fail(400, 'layer.src must be a published /background/ image');
              }
            }
            const folder = resolve(root, 'art', 'scenes');
            const file = resolve(folder, `${id}.json`);
            if (!file.startsWith(folder + '\\') && !file.startsWith(folder + '/')) {
              return fail(400, 'path escaped art/scenes');
            }
            if (!existsSync(folder)) return fail(404, 'no art/scenes/');
            // Marks are optional, and an empty list means "use the defaults"
            // rather than "this scene has nowhere to stand" -- so they are
            // omitted entirely rather than written as [].
            const slots = (v: unknown[] | undefined) =>
              Array.isArray(v) && v.length
                ? v.filter(
                    (m) =>
                      m &&
                      typeof m === 'object' &&
                      ['col', 'row', 'xPct', 'yPct'].every(
                        (k) => typeof (m as Record<string, unknown>)[k] === 'number',
                      ),
                  )
                : undefined;
            /*
             * The acting marks, validated as a pair.
             *
             * Both sides or neither: half an override would put one side on the
             * scene's mark and the other on the global default, which is a
             * staging nobody chose. Fractions of the stage, so anything outside
             * 0..1 is a number that escaped a drag rather than a position.
             */
            const point = (v: unknown) => {
              const o = v as { x?: unknown; y?: unknown } | undefined;
              if (!o || typeof o.x !== 'number' || typeof o.y !== 'number') return undefined;
              if (!Number.isFinite(o.x) || !Number.isFinite(o.y)) return undefined;
              if (o.x < -1 || o.x > 2 || o.y < -1 || o.y > 2) return undefined;
              return { x: +o.x.toFixed(4), y: +o.y.toFixed(4) };
            };
            const a = acts as { player?: unknown; enemy?: unknown } | undefined;
            const player = point(a?.player);
            const foe = point(a?.enemy);
            const marks = { board: slots(board), enemy: slots(enemy) };
            /*
             * Which stages this scene dresses, validated rather than trusted.
             *
             * This one field decides what players see, so a malformed pair is
             * worth rejecting outright instead of writing a range nothing can
             * match. Anything that is not two real, ordered, positive numbers
             * is dropped, which leaves the scene simply out of rotation -- the
             * same as never having set it.
             */
            const range =
              Array.isArray(stages) &&
              stages.length === 2 &&
              stages.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 1) &&
              (stages[1] as number) >= (stages[0] as number)
                ? [Math.floor(stages[0] as number), Math.floor(stages[1] as number)]
                : undefined;
            writeFileSync(
              file,
              JSON.stringify(
                {
                  name: name || id,
                  ...(range ? { stages: range } : null),
                  ...(player && foe ? { acts: { player, enemy: foe } } : null),
                  layers,
                  ...(marks.board ? { board: marks.board } : null),
                  ...(marks.enemy ? { enemy: marks.enemy } : null),
                },
                null,
                2,
              ) + '\n',
              'utf-8',
            );
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: true, file: `art/scenes/${id}.json` }));
          } catch (e) {
            fail(400, e instanceof Error ? e.message : 'bad request');
          }
        });
      });

      /*
       * Damage splits, written whole.
       *
       * The file is regenerated from scratch every time rather than patched,
       * because a half-applied edit to a module the engine imports is a broken
       * build, and "regenerate the whole thing" is the only write that cannot
       * leave one behind.
       *
       * Everything is validated before anything is written: keys have to look
       * like `<id>/<Ability Name>` and shares have to be finite positives. A
       * bad number here does not produce a wrong colour somewhere -- it changes
       * what an ability does.
       */
      server.middlewares.use('/__hits/save', (req, res) => {
        if (req.method !== 'POST') return void res.end();
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => {
          const fail = (code: number, error: string) => {
            res.statusCode = code;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ error }));
          };
          try {
            const { splits } = JSON.parse(body) as { splits?: unknown };
            if (!splits || typeof splits !== 'object') return fail(400, 'splits must be an object');

            const KEY = /^[a-z0-9_]+\/[A-Za-z0-9 '’\-]+$/;
            const clean: [string, number[]][] = [];
            for (const [key, value] of Object.entries(splits as Record<string, unknown>)) {
              if (!KEY.test(key)) return fail(400, `bad key: ${key}`);
              if (!Array.isArray(value) || value.length < 2) continue; // one hit is no split
              if (!value.every((n) => typeof n === 'number' && Number.isFinite(n) && n > 0)) {
                return fail(400, `shares must be positive numbers: ${key}`);
              }
              if (value.length > 32) return fail(400, `too many hits: ${key}`);
              clean.push([key, value.map((n) => +(+n).toFixed(4))]);
            }
            clean.sort(([a], [b]) => a.localeCompare(b));

            const file = resolve(root, 'src', 'engine', 'hitSplits.ts');
            const current = readFileSync(file, 'utf-8');
            const marker = 'export const HIT_SPLITS: Record<string, number[]> = {';
            const start = current.indexOf(marker);
            const end = current.indexOf('};', start);
            if (start < 0 || end < 0) return fail(500, 'hitSplits.ts does not look generated');

            const rows = clean
              .map(([k, v]) => `  '${k.replace(/'/g, "\\'")}': [${v.join(', ')}],`)
              .join('\n');
            const next =
              current.slice(0, start + marker.length) +
              (rows ? `\n${rows}\n` : '\n') +
              current.slice(end);
            writeFileSync(file, next, 'utf-8');
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: true, count: clean.length }));
          } catch (e) {
            fail(400, e instanceof Error ? e.message : 'bad request');
          }
        });
      });

      server.middlewares.use('/__anim/save', (req, res) => {
        const fail = (code: number, error: string) => {
          res.statusCode = code;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ error }));
        };
        if (req.method !== 'POST') return fail(405, 'POST only');

        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
          if (body.length > 1_000_000) req.destroy();
        });
        req.on('end', () => {
          try {
            const { who, clip, placement, frames, order, stepMs, impacts } = JSON.parse(body) as {
              who?: string;
              clip?: string;
              placement?: Record<string, number>;
              frames?: Record<string, number>[];
              order?: number[];
              stepMs?: number;
              impacts?: unknown[];
            };
            if (!who || !NAME.test(who)) return fail(400, 'bad actor name');
            if (!clip || !NAME.test(clip)) return fail(400, 'bad clip name');

            const folder = resolve(root, 'art', 'actors', who);
            const file = resolve(folder, `${who}.anim.json`);
            if (!file.startsWith(folder + '\\') && !file.startsWith(folder + '/')) {
              return fail(400, 'path escaped the actor folder');
            }
            if (!existsSync(folder)) return fail(404, `no art/actors/${who}/`);

            // Merge rather than replace: the file holds every clip for this
            // actor, and the lab only ever edits one at a time.
            let data: Record<string, unknown> = {};
            if (existsSync(file)) {
              try {
                data = JSON.parse(readFileSync(file, 'utf-8'));
              } catch {
                return fail(500, `${who}.anim.json is not valid JSON -- fix or delete it`);
              }
            }

            // Frame indices only, and only sane ones: this file outlives the
            // sheet it was authored against, and a junk index would render a
            // blank rather than fail loudly.
            if (order && (!Array.isArray(order) || order.some((i) => !Number.isInteger(i) || i < 0))) {
              return fail(400, 'order must be an array of frame indices');
            }

            // Bounded, because this becomes a CSS animation duration: a zero
            // would divide by nothing and a negative would never play.
            if (stepMs != null && (!Number.isFinite(stepMs) || stepMs < 1 || stepMs > 5000)) {
              return fail(400, 'stepMs must be between 1 and 5000');
            }

            /*
             * Start from what is ALREADY saved for this clip, then overwrite
             * only the fields the lab sent.
             *
             * Building this fresh dropped everything the lab does not edit:
             * changing an attack's speed silently erased its `impacts`, and the
             * particle effects simply stopped happening with nothing to say
             * why. A save endpoint that discards what it does not understand is
             * a data-loss bug waiting for the next field anyone adds.
             */
            const existing = (data[clip] ?? {}) as Record<string, unknown>;
            const settings: Record<string, unknown> = { ...existing };
            delete settings.placement;
            delete settings.frames;
            delete settings.order;
            delete settings.stepMs;
            if (placement && Object.keys(placement).length) settings.placement = placement;
            if (frames && frames.length) settings.frames = frames;
            if (order?.length) settings.order = order;
            if (stepMs != null) settings.stepMs = Math.round(stepMs);
            if (impacts !== undefined) {
              if (!Array.isArray(impacts)) return fail(400, 'impacts must be an array');
              for (const i of impacts) {
                if (!i || typeof i !== 'object') return fail(400, 'bad impact');
                const { frame, effect, at } = i as Record<string, unknown>;
                if (!Number.isInteger(frame) || (frame as number) < 0) {
                  return fail(400, 'impact.frame must be a frame index');
                }
                if (typeof effect !== 'string' || !NAME.test(effect)) {
                  return fail(400, 'impact.effect must be an effect id');
                }
                if (at != null && at !== 'each' && at !== 'centre') {
                  return fail(400, 'impact.at must be "each" or "centre"');
                }
              }
              if (impacts.length) settings.impacts = impacts;
              else delete settings.impacts;
            }

            // An empty entry is a deletion, so resetting a clip in the lab and
            // saving actually clears it rather than leaving `{}` behind.
            if (Object.keys(settings).length) data[clip] = settings;
            else delete data[clip];

            const sorted = Object.fromEntries(Object.entries(data).sort(([a], [b]) => a.localeCompare(b)));
            writeFileSync(file, JSON.stringify(sorted, null, 2) + '\n', 'utf-8');

            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: true, file: `art/actors/${who}/${who}.anim.json` }));
          } catch (e) {
            fail(400, e instanceof Error ? e.message : 'bad request');
          }
        });
      });
    },
  };
}

/**
 * Runs the art pipeline whenever `art/` changes, so `public/` is never stale.
 *
 * `public/` is derived, not authored -- scripts/pack_sprites.py owns every file
 * in it. Before this, that derivation was a manual step, so dropping a new sprite
 * into `art/` changed nothing on screen until someone remembered to run the
 * script, and the failure mode was silent: the game kept happily serving the
 * previous version.
 *
 * Two triggers, because there are two ways art goes stale:
 *
 *   serving  a watcher on art/, so a save shows up in the running game
 *   building  once before the bundle is written, so a build cannot ship art
 *             older than its sources
 *
 * Only the actor whose folder changed is re-packed. A save touches one
 * character, and a whole-roster run is several seconds of work to redo five
 * boards and twenty animation strips that nobody edited.
 */
function artPipeline(): Plugin {
  const root = process.cwd();
  const ART = resolve(root, 'art');
  // The pipeline writes <name>.pack.json back into the actor's folder and the
  // lab writes <name>.anim.json, both INSIDE the tree being watched. Without
  // this the pipeline's own output would retrigger it, forever.
  /*
   * Written BY the packer, so reacting to it would loop forever.
   *
   * `.anim.json` used to be in here too, and that was the bug: lumping it in
   * with the packer's own output meant an animator's saved timing was ignored
   * outright -- no repack, which is correct, but also no reload, so the running
   * game kept the tuning it had read at page load and the lab appeared to save
   * into a void. See `DATA_ONLY`.
   */
  const GENERATED = /\.pack\.json$/;
  /*
   * Hand-authored data that the game READS but the packer does not produce:
   * clip tuning and lab-built scenes. Neither contains a pixel, so neither
   * needs a repack -- but both are baked into the bundle by an eager
   * `import.meta.glob`, so both need the page to reload before the change
   * exists as far as the running app is concerned.
   *
   * Splitting these out is what makes a save feel immediate. A scene file did
   * technically reach the game before, by falling through to the full-pack
   * path: every save ran the whole roster through Python and only reloaded when
   * that finished, ten seconds later and long after the animator had walked
   * back to the battle screen to see nothing changed.
   */
  const DATA_ONLY = /(\.anim\.json|[\\\/]art[\\\/]scenes[\\\/][^\\\/]+\.json)$/;
  const ACTOR = /[\\/]art[\\/]actors[\\/]([a-z0-9][a-z0-9_]*)[\\/]/i;

  const python = process.env.STAGEBOUND_PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');

  /**
   * Never spawnSync here. The watcher and the startup pack both run while the
   * dev server is live, and a synchronous child would block the event loop for
   * the seconds the pack takes -- stalling every request the page has in flight.
   */
  function pack(actors: Set<string>, log: (m: string) => void): Promise<boolean> {
    const args = ['scripts/pack_sprites.py', ...[...actors].flatMap((a) => ['--only', a])];
    return new Promise((done) => {
      const child = spawn(python, args, { cwd: root });
      let out = '';
      let err = '';
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (err += d));
      child.on('error', (e) => {
        // Worth being loud about: the alternative is a dev server that silently
        // stops updating art and looks like the pipeline itself is broken.
        log(`cannot run ${python} (${e.message}). Set STAGEBOUND_PYTHON to your interpreter.`);
        done(false);
      });
      child.on('close', (code) => {
        if (code !== 0) {
          log(`pack failed:\n${(err || out).trim()}`);
          return done(false);
        }
        // The script's own report already names what it wrote and lists any
        // audit notes, so surface it rather than inventing a summary of it.
        for (const line of out.trim().split('\n')) if (line.trim()) log(line);
        done(true);
      });
    });
  }

  let building = false;

  return {
    name: 'stagebound:art-pipeline',

    configResolved(config) {
      building = config.command === 'build';
    },

    async buildStart() {
      // Serving has its own trigger below. Vite calls buildStart for the dev
      // server too, and packing here would hold up startup by the length of a
      // full roster pack and report every audit note as a build warning.
      if (building && !process.env.STAGEBOUND_SKIP_PACK) {
        await pack(new Set(), (m) => this.warn(m));
      }
    },

    configureServer(server) {
      const log = (m: string) => server.config.logger.info(`  art  ${m}`, { timestamp: true });
      const pendingActors = new Set<string>();
      let full = false;
      let timer: ReturnType<typeof setTimeout> | undefined;

      // Data-only saves reload on their own short clock, so a scene or a clip
      // tuning cannot be held up behind a pack that has nothing to do with it.
      let dataTimer: ReturnType<typeof setTimeout> | undefined;

      const changed = (file: string) => {
        if (!resolve(file).startsWith(ART) || GENERATED.test(file)) return;
        if (DATA_ONLY.test(resolve(file))) {
          clearTimeout(dataTimer);
          dataTimer = setTimeout(() => {
            log('data changed — reloading');
            server.ws.send({ type: 'full-reload' });
          }, 120);
          return;
        }
        const who = ACTOR.exec(resolve(file));
        if (who) pendingActors.add(who[1].toLowerCase());
        else full = true; // backgrounds, or a new actor folder

        // Debounced: dropping a sprite, its icon and an animation sheet in one
        // go is three events, and each full pack is seconds of work.
        clearTimeout(timer);
        timer = setTimeout(run, 300);
      };

      // One pack at a time. A pack writes <name>.pack.json back into art/, and
      // two overlapping runs would race each other over the same manifest.
      let active: Promise<unknown> = Promise.resolve();
      const run = () => {
        const actors = full ? new Set<string>() : new Set(pendingActors);
        pendingActors.clear();
        full = false;
        active = active
          .then(() => pack(actors, log))
          .then((ok) => {
            // A full reload, not HMR: most of what changed is files under
            // public/, which the module graph knows nothing about.
            if (ok) server.ws.send({ type: 'full-reload' });
          });
      };

      server.watcher.add(ART);
      server.watcher.on('add', changed);
      server.watcher.on('change', changed);
      server.watcher.on('unlink', changed);

      // Catch up on anything that changed while the server was down, once it is
      // actually listening so this costs startup nothing.
      server.httpServer?.once('listening', () => {
        full = true;
        run();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), animationSaver(), artPipeline()],
  server: { open: false },
});
