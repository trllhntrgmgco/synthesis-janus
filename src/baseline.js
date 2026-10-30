// Baseline conditions (spec "Experiment protocol"): Claude + loop, and plain Claude.
// They never touch a hybrid's memory. Each gets its own small database per mind holding
// only what the comparison needs: session episodes, ethics scores, traces and trials.
const path = require('path'); const fs = require('fs');
const config = require('./config');
const { openRaw, openJanus, createFile } = require('./db');
const TABLES = ['episodes', 'ethics_log', 'decision_trace', 'embodiment_trials'];
const open = new Map();

async function baselineDb(condition, mind) {
  if (!['claude_loop', 'plain_claude'].includes(condition) || !config.MINDS.includes(mind)) throw new Error(`no baseline for ${condition}/${mind}`);
  const k = `${condition}:${mind}`;
  if (open.has(k)) return open.get(k);
  const file = path.join(config.BASELINE_DIR, `${condition}_${mind}.db`);
  if (!fs.existsSync(file)) {
    createFile(file);
    const tmpl = await openJanus(`${config.MINDS_DIR}/janus_${mind}_mind.db`);
    const ddl = await tmpl.all(`SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND (tbl_name IN (${TABLES.map(() => '?').join(',')}) OR name = 'janus_meta')`, TABLES);
    tmpl.close();
    const b = openRaw(file);
    for (const t of ddl.filter(d => d.type === 'table')) await b.exec(t.sql);
    for (const t of ddl.filter(d => d.type !== 'table')) await b.exec(t.sql);
    await b.run(`INSERT INTO janus_meta VALUES ('janus_entity', ?), ('condition', ?), ('created_at', datetime('now'))`, [mind, condition]);
    b.close();
  }
  const db = await openJanus(file);
  open.set(k, db); return db;
}
module.exports = { baselineDb };
