import { ROSTER, ENEMIES, RIVERSIDE } from '../engine/content.ts';
import { simulateBattle } from '../engine/battle.ts';

const N = Number(process.argv[2] ?? 500);

let wins = 0,
  draws = 0,
  turns = 0,
  survivors = 0;
const abilityUse = new Map<string, number>();
let playerActs = 0,
  playerPhases = 0;

for (let seed = 1; seed <= N; seed++) {
  const r = simulateBattle(RIVERSIDE, ROSTER, ENEMIES, seed);
  if (r.outcome === 'victory') wins++;
  if (r.outcome === 'draw') draws++;
  turns += r.turns;
  survivors += r.playerSurvivors;

  for (const e of r.log) {
    if (e.t === 'roll' && e.side === 'player') playerPhases++;
    if (e.t === 'act' && e.side === 'player') {
      playerActs++;
      abilityUse.set(e.ability, (abilityUse.get(e.ability) ?? 0) + 1);
    }
  }
}

console.log(`\n=== ${N} battles · ${RIVERSIDE.name} ===`);
console.log(`  player win rate : ${((wins / N) * 100).toFixed(1)}%   (draws ${((draws / N) * 100).toFixed(1)}%)`);
console.log(`  avg turns       : ${(turns / N).toFixed(1)}`);
console.log(`  avg survivors   : ${(survivors / N).toFixed(2)} / 5`);
console.log(`  avg acting/phase: ${(playerActs / playerPhases).toFixed(2)} / 5`);
console.log(`\n  player ability usage:`);

const total = [...abilityUse.values()].reduce((a, b) => a + b, 0);
for (const [name, n] of [...abilityUse.entries()].sort((a, b) => b[1] - a[1])) {
  const pct = (n / total) * 100;
  console.log(`    ${name.padEnd(16)} ${pct.toFixed(1).padStart(5)}%  ${'#'.repeat(Math.round(pct / 2))}`);
}

const unused = ROSTER.flatMap((c) => c.abilities.map((a) => a.name)).filter((n) => !abilityUse.has(n));
if (unused.length) console.log(`\n  NEVER USED: ${unused.join(', ')}`);
console.log();
