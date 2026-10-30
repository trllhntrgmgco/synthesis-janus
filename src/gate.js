// The provenance gate: the ONE path every Janus write goes through (spec, "Provenance and
// speaker attribution"). It wraps a database so Pan-Birth's own SQL can run unchanged while
// Janus guarantees every tracked row records which engine produced it, and every episode
// carries a valid lowercase speaker and a percept_origin.
const config = require('./config');

const ENGINES = new Set(['native-snapshot', 'claude', 'janus-system']);
const PERCEPTS = new Set(['none', 'claude-perceived', 'taught']);
const TRACKED = new Set(['episodes', 'concepts', 'links', 'abstractions', 'ethics_log',
  'truths', 'discourse', 'hypotheses', 'inference_log', 'relations']);
const BASE_SPEAKERS = ['keenan', 'user', 'system', ...config.MINDS];
const externalAgents = new Set();   // named external agents, e.g. 'claude opus 5.5' (never 'user')

function registerAgent(name) {
  const n = String(name).toLowerCase().trim();
  if (!n || n === 'user') throw new Error('external agents need their own name');
  externalAgents.add(n);
}
function checkSpeaker(s) {
  if (typeof s !== 'string' || s !== s.toLowerCase().trim()) throw new Error(`gate: speaker must be lowercase: ${JSON.stringify(s)}`);
  if (!BASE_SPEAKERS.includes(s) && !externalAgents.has(s)) throw new Error(`gate: speaker not on the closed list: ${s}`);
}

const countQ = (s) => (s.match(/\?/g) || []).length;

// Rewrite one statement for a tracked table so it also writes engine (and, for episodes,
// percept_origin). Returns {sql, params}. Throws on shapes it does not understand, so an
// unhandled write fails loudly instead of slipping through untagged.
function rewrite(sql, params, ctx) {
  const ins = sql.match(/^\s*INSERT\s+(?:OR\s+\w+\s+)?INTO\s+(\w+)\s*\(([^)]*)\)\s*VALUES\s*\(/i);
  const upd = !ins && sql.match(/^\s*UPDATE\s+(\w+)\s+SET\s/i);
  const table = (ins || upd || [])[1];
  if (!table || !TRACKED.has(table.toLowerCase())) return { sql, params };
  const t = table.toLowerCase();
  if (!ENGINES.has(ctx.engine)) throw new Error(`gate: bad engine ${ctx.engine}`);

  if (ins) {
    const cols = ins[2].split(',').map(c => c.trim().toLowerCase());
    if (cols.includes('engine')) throw new Error('gate: callers must not set engine themselves');
    // locate the closing paren of VALUES( ... ) at depth 0
    let i = ins[0].length, depth = 1;
    for (; i < sql.length && depth; i++) { if (sql[i] === '(') depth++; else if (sql[i] === ')') depth--; }
    const valuesEnd = i - 1;
    const nBefore = countQ(sql.slice(0, valuesEnd));
    let engine = ctx.engine;
    const addCols = ['engine'], addVals = [];
    if (t === 'episodes') {
      const si = cols.indexOf('speaker');
      if (si < 0) throw new Error('gate: episode without speaker');
      // speaker is the si-th column; find its param by counting ? among the first si values
      const valueExprs = splitTop(sql.slice(ins[0].length, valuesEnd));
      if (valueExprs[si].trim() !== '?') throw new Error('gate: speaker must be a bound parameter');
      const pIndex = countQ(sql.slice(0, ins[0].length)) + valueExprs.slice(0, si).reduce((n, e) => n + countQ(e), 0);
      const speaker = params[pIndex];
      checkSpeaker(speaker);
      if (ctx.mind && ctx.engineBySpeaker) engine = speaker === ctx.mind ? 'claude' : 'janus-system';
      const percept = ctx.percept || 'none';
      if (!PERCEPTS.has(percept)) throw new Error(`gate: bad percept_origin ${percept}`);
      if (!cols.includes('percept_origin')) { addCols.push('percept_origin'); addVals.push(percept); }
      if (ctx.loopTrialId != null && !cols.includes('loop_trial_id')) { addCols.push('loop_trial_id'); addVals.push(ctx.loopTrialId); }
    }
    const head = sql.slice(0, ins[0].length).replace(/\(([^)]*)\)(\s*VALUES\s*\()$/i, (m, c, v) => `(${c}, ${addCols.join(', ')})${v}`);
    const newSql = head + sql.slice(ins[0].length, valuesEnd) + addCols.map(() => ', ?').join('') + sql.slice(valuesEnd);
    let out = newSql;
    // ON CONFLICT ... DO UPDATE SET: whoever last strengthened the row owns it
    out = out.replace(/(DO\s+UPDATE\s+SET\s+)/i, `$1engine = excluded.engine, `);
    const p = [...params.slice(0, nBefore), engine, ...addVals, ...params.slice(nBefore)];
    return { sql: out, params: p };
  }
  // UPDATE t SET ... [WHERE ...]
  if (/\bengine\s*=/i.test(sql)) throw new Error('gate: callers must not set engine themselves');
  const w = sql.search(/\sWHERE\s/i);
  const setEnd = w < 0 ? sql.length : w;
  const n = countQ(sql.slice(0, setEnd));
  return { sql: sql.slice(0, setEnd) + ', engine = ?' + sql.slice(setEnd), params: [...params.slice(0, n), ctx.engine, ...params.slice(n)] };
}

function splitTop(s) {
  const out = []; let depth = 0, cur = '', q = null;
  for (const ch of s) {
    if (q) { cur += ch; if (ch === q) q = null; continue; }
    if (ch === "'" || ch === '"') { q = ch; cur += ch; continue; }
    if (ch === '(') depth++; if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur); return out;
}

// Wrap a Janus database. ctx: { engine, mind?, engineBySpeaker?, percept?, loopTrialId? }
function gated(db, ctx) {
  const run = async (sql, params = []) => { const r = rewrite(sql, params, ctx); return db.run(r.sql, r.params); };
  return {
    raw: db, ctx,
    dbRun: (_db, sql, params) => run(sql, params || []),
    dbGet: (_db, sql, params) => db.get(sql, params || []),
    dbAll: (_db, sql, params) => db.all(sql, params || []),
    run, get: (s, p) => db.get(s, p || []), all: (s, p) => db.all(s, p || []),
  };
}

module.exports = { gated, rewrite, registerAgent, checkSpeaker, ENGINES };
