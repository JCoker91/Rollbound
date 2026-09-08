import { ROSTER, ENEMIES, RIVERSIDE } from '../engine/content.ts';
import { simulateBattle } from '../engine/battle.ts';

const seed = Number(process.argv[2] ?? 12345);
const result = simulateBattle(RIVERSIDE, ROSTER, ENEMIES, seed);

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;

console.log(bold(`\n  DICE LEGENDS  ${dim(`${RIVERSIDE.name} · seed ${seed}`)}\n`));
console.log(dim('  (both sides on AI — this is the auto-battle used for idle stages)\n'));

for (const e of result.log) {
  switch (e.t) {
    case 'roll':
      console.log(
        `\n${bold(`── Turn ${e.turn} · ${e.side === 'player' ? 'YOUR PHASE' : 'ENEMY PHASE'}`)}  ` +
          cyan(`[ ${e.dice.join(' ')} ]`),
      );
      break;
    case 'move':
      console.log(dim(`  ${e.unit} moves (${e.from.x},${e.from.y}) → (${e.to.x},${e.to.y})`));
      break;
    case 'act':
      console.log(`  ${e.actor} → ${bold(e.ability)} ${dim(`(${e.dice.join('+')})`)}`);
      break;
    case 'damage': {
      const tag =
        e.matchup === 'STRONG' ? ' ' + yellow('STRONG') : e.matchup ? ' ' + dim(e.matchup) : '';
      console.log(`      ${red(`-${e.amount}`)} ${e.target} ${dim(`(${e.hpAfter} hp)`)}${tag}`);
      break;
    }
    case 'heal':
      console.log(`      ${green(`+${e.amount}`)} ${e.target} ${dim(`(${e.hpAfter} hp)`)}`);
      break;
    case 'buff':
      console.log(`      ${cyan(`+${e.amount} atk`)} ${e.target}`);
      break;
    case 'ko':
      console.log(`      ${red(bold(`✖ ${e.unit} is down`))}`);
      break;
    case 'end': {
      const label =
        e.outcome === 'victory' ? green('  VICTORY') : e.outcome === 'defeat' ? red('  DEFEAT') : yellow('  DRAW');
      console.log(
        `\n${bold(label)}` +
          dim(`  ·  ${e.turns} turns  ·  ${result.playerSurvivors}/5 survived\n`),
      );
      break;
    }
  }
}
