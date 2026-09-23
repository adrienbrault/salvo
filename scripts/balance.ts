/**
 * Headless balance report: the scripted bot plays levels for every chassis (god mode, so we
 * measure scoring potential, not survival). Usage: `bun scripts/balance.ts [sectors] [seeds]`.
 */
import { CHASSIS } from '../src/content/chassis';
import { levelSpecFor } from '../src/run/levels';
import { createRun } from '../src/run/run';
import { playLevel } from '../src/test/bot';

const sectors = Number(process.argv[2] ?? 2);
const seeds = Number(process.argv[3] ?? 3);

const rows: string[][] = [['chassis', 'level', 'quota', 'score', '% quota', 'kills', 'time', 'result']];
for (const ch of CHASSIS) {
  for (let s = 0; s < sectors; s++) {
    for (let l = 0; l < 3; l++) {
      let score = 0;
      let kills = 0;
      let time = 0;
      let wins = 0;
      for (let k = 0; k < seeds; k++) {
        const run = createRun(`BAL${k}`, ch.id);
        run.sector = s;
        run.level = l;
        const w = playLevel(run, { godMode: true });
        score += w.score;
        kills += w.tally.kills;
        time += w.time;
        if (w.result === 'won') wins++;
      }
      const spec = levelSpecFor(createRun('X', ch.id), s, l);
      rows.push([
        ch.name,
        `${s + 1}-${l + 1} ${spec.kind}`,
        String(spec.quota),
        String(Math.round(score / seeds)),
        `${Math.round((score / seeds / spec.quota) * 100)}%`,
        String(Math.round(kills / seeds)),
        `${(time / seeds).toFixed(1)}s`,
        `${wins}/${seeds}`,
      ]);
    }
  }
}
const widths = rows[0]!.map((_, i) => Math.max(...rows.map((r) => r[i]!.length)));
for (const r of rows) console.log(r.map((c, i) => c.padEnd(widths[i]!)).join('  '));
