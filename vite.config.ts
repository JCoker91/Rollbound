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
            const { who, clip, placement, frames, order, stepMs } = JSON.parse(body) as {
              who?: string;
              clip?: string;
              placement?: Record<string, number>;
              frames?: Record<string, number>[];
              order?: number[];
              stepMs?: number;
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

            const settings: Record<string, unknown> = {};
            if (placement && Object.keys(placement).length) settings.placement = placement;
            if (frames && frames.length) settings.frames = frames;
            if (order?.length) settings.order = order;
            if (stepMs != null) settings.stepMs = Math.round(stepMs);

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
  const GENERATED = /\.(pack|anim)\.json$/;
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

      const changed = (file: string) => {
        if (!resolve(file).startsWith(ART) || GENERATED.test(file)) return;
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
