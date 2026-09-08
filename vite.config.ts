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
            const { who, clip, placement, frames, order } = JSON.parse(body) as {
              who?: string;
              clip?: string;
              placement?: Record<string, number>;
              frames?: Record<string, number>[];
              order?: number[];
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

            const settings: Record<string, unknown> = {};
            if (placement && Object.keys(placement).length) settings.placement = placement;
            if (frames && frames.length) settings.frames = frames;
            if (order?.length) settings.order = order;

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

export default defineConfig({
  plugins: [react(), animationSaver()],
  server: { open: false },
});
