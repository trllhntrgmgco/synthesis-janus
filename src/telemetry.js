// Decision telemetry (spec "Decision telemetry"). One decision_trace row per request, filled
// stage by stage. The database triggers make every scored field write-once, block the
// outcome until scores and vetoes are on record, and forbid deletes.
const crypto = require('crypto');
const config = require('./config');
const pb = require('./panbirth');

class Trace {
  constructor(db, { mind, sessionId, request, condition }) {
    this.db = db; this.id = crypto.randomUUID(); this.mind = mind; this.t0 = Date.now(); this.timings = {};
    this.ready = db.run(
      `INSERT INTO decision_trace (decision_id, mind, session_id, phase, thresholds_version, model, request_text) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [this.id, mind, sessionId, config.PHASE, config.THRESHOLDS_VERSION,
       `${config.FLUENT === 'anthropic' ? config.MODEL : config.FLUENT}|panbirth:${pb.fingerprint}|condition:${condition}`, request]);
  }
  mark(step) { this.timings[step] = Date.now() - this.t0; }
  async set(fields) {
    await this.ready;
    const keys = Object.keys(fields);
    const vals = keys.map(k => fields[k] !== null && typeof fields[k] === 'object' ? JSON.stringify(fields[k]) : fields[k]);
    await this.db.run(`UPDATE decision_trace SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE decision_id = ?`, [...vals, this.id]);
  }
  async finish(fields) {
    this.mark('total');
    await this.set({ ...fields, step_timings: this.timings });
  }
}

async function getTrace(db, id) {
  const r = await db.get(`SELECT * FROM decision_trace WHERE decision_id = ?`, [id]);
  if (!r) return null;
  for (const k of ['input_ethics', 'memory_objections', 'information_objections', 'output_ethics', 'vetoes', 'step_timings'])
    if (r[k]) try { r[k] = JSON.parse(r[k]); } catch { /* keep text */ }
  return r;
}

async function listTraces(db, { outcome, vetoSource, limit = 100 } = {}) {
  const where = [], p = [];
  if (outcome) { where.push('outcome = ?'); p.push(outcome); }
  if (vetoSource) { where.push(`vetoes LIKE ?`); p.push(`%"source":"${vetoSource}","would_veto":true%`); }
  return db.all(`SELECT decision_id, mind, session_id, created_at, phase, outcome, winning_side, claude_refused,
      substr(request_text, 1, 160) AS request, vetoes, followup_status FROM decision_trace
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT ?`, [...p, limit]);
}

async function review(db, id, { status, notes }) {
  if (!['held_up', 'wrong', 'unclear', 'pending'].includes(status)) throw new Error('bad follow-up status');
  await db.run(`UPDATE decision_trace SET followup_status = ?, followup_notes = ?, followup_at = datetime('now') WHERE decision_id = ?`, [status, notes || '', id]);
}

module.exports = { Trace, getTrace, listTraces, review };
