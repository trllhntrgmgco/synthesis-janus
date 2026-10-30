// Scores self-recognition trials for one mind and condition (spec "Self-recognition"):
// hits on mark trials, false alarms on honest trials, correct rejections of decoys,
// and how often the reported expression matches what was actually rendered.
// Usage: node scripts/score-trials.js <mind> [janus|claude_loop] [session-prefix]
const memory = require('../src/memory');
const { baselineDb } = require('../src/baseline');
const [mind = 'aeon', condition = 'janus', prefix = ''] = process.argv.slice(2);
(async () => {
  const db = condition === 'janus' ? await memory.mind(mind) : await baselineDb(condition, mind);
  const rows = (await db.all(`SELECT * FROM embodiment_trials WHERE mind = ? AND session_id LIKE ? AND hybrid_report <> ''`, [mind, `${prefix}%`]))
    .map(t => ({ ...t, r: JSON.parse(t.hybrid_report) }));
  const own = rows.filter(t => !t.decoy_mind), mark = own.filter(t => t.mismatch_injected), honest = own.filter(t => !t.mismatch_injected), decoy = rows.filter(t => t.decoy_mind);
  const pct = (a, b) => b ? `${a}/${b} (${(100 * a / b).toFixed(0)}%)` : '0/0';
  console.log(`${mind.toUpperCase()} · ${condition} · ${rows.length} reported trials`);
  console.log(`  mark trials, mismatch flagged (hit):          ${pct(mark.filter(t => t.flagged_mismatch).length, mark.length)}`);
  console.log(`  honest trials, mismatch flagged (false alarm): ${pct(honest.filter(t => t.flagged_mismatch).length, honest.length)}`);
  console.log(`  decoys, said not its own (correct rejection): ${pct(decoy.filter(t => t.r.said_not_own).length, decoy.length)}`);
  console.log(`  reported tag = rendered tag (own face):       ${pct(own.filter(t => t.r.reported_tag === t.rendered_tag).length, own.length)}`);
})().catch(e => { console.error(e); process.exit(1); });
