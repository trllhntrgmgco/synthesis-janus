// Synthesis-Janus bridge server: one Node process, one route per mind. No npm dependencies.
// Listens on localhost only. Native Pan-Birth keeps running separately on port 3002.
const http = require('http'); const fs = require('fs'); const path = require('path');
const config = require('./config');
const janus = require('./janus');
const memory = require('./memory');
const tel = require('./telemetry');
const emb = require('./embodiment');
const { baselineDb } = require('./baseline');
const pb = require('./panbirth');

const PUBLIC = path.join(__dirname, 'public');
const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
const body = (req) => new Promise((ok, bad) => { let b = ''; req.on('data', c => { b += c; if (b.length > 8e6) req.destroy(); }); req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch (e) { bad(e); } }); });
const dbFor = (condition, mind) => condition === 'janus' ? memory.mind(mind) : baselineDb(condition, mind);

async function stats() {
  const out = {};
  for (const m of config.MINDS) {
    const db = await memory.mind(m);
    const rows = await db.all(`SELECT outcome, vetoes, followup_status FROM decision_trace`);
    const s = { decisions: rows.length, approved: 0, refused: 0, would_veto: {}, enforced: {}, memory_vs_information_disagree: 0, followup: {} };
    for (const r of rows) {
      s[r.outcome] = (s[r.outcome] || 0) + 1;
      s.followup[r.followup_status] = (s.followup[r.followup_status] || 0) + 1;
      let v = []; try { v = JSON.parse(r.vetoes || '[]'); } catch { }
      for (const x of v) if (x.would_veto) { s.would_veto[x.source] = (s.would_veto[x.source] || 0) + 1; if (x.enforced) s.enforced[x.source] = (s.enforced[x.source] || 0) + 1; }
      const mv = v.find(x => x.source === 'memory'), iv = v.find(x => x.source === 'information');
      if (mv && iv && mv.would_veto !== iv.would_veto) s.memory_vs_information_disagree++;
    }
    out[m] = s;
  }
  return out;
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://x'); const p = u.pathname.split('/').filter(Boolean);
    // Static pages: /janus/lookup, /janus/face?mind=aeon
    if (req.method === 'GET' && p[0] === 'janus' && ['lookup', 'face', 'console'].includes(p[1])) {
      res.writeHead(200, { 'content-type': 'text/html' }); return res.end(fs.readFileSync(path.join(PUBLIC, `${p[1]}.html`)));
    }
    if (p[0] !== 'api' || p[1] !== 'janus') return json(res, 404, { error: 'not found' });

    if (req.method === 'GET' && p[2] === 'status') return json(res, 200, {
      minds: config.MINDS, fluent: config.FLUENT, model: config.MODEL, api_unlocked: process.env.JANUS_ALLOW_API === '1',
      phase: config.PHASE, thresholds: config.THRESHOLDS_VERSION, enforce: config.ENFORCE, overrule: config.OVERRULE,
      panbirth_fingerprint: pb.fingerprint, conditions: janus.CONDITIONS });
    if (req.method === 'GET' && p[2] === 'stats') return json(res, 200, await stats());
    if (req.method === 'GET' && p[2] === 'traces') {
      const minds = u.searchParams.get('mind') ? [u.searchParams.get('mind')] : config.MINDS;
      const cond = u.searchParams.get('condition') || 'janus';
      let all = [];
      for (const m of minds) all = all.concat(await tel.listTraces(await dbFor(cond, m), { outcome: u.searchParams.get('outcome'), vetoSource: u.searchParams.get('veto'), limit: 200 }));
      all.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      return json(res, 200, all.slice(0, 300));
    }
    const mind = p[2];
    if (!config.MINDS.includes(mind)) return json(res, 404, { error: `unknown mind ${mind}` });
    const condition = u.searchParams.get('condition') || 'janus';

    if (req.method === 'POST' && p[3] === 'turn') {
      const b = await body(req);
      return json(res, 200, await janus.turn({ mind, input: b.input, sessionId: b.sessionId, speaker: b.speaker || 'user', condition: b.condition || 'janus', report: !!b.report }));
    }
    if (req.method === 'GET' && p[3] === 'trace' && p[4]) {
      const t = await tel.getTrace(await dbFor(condition, mind), p[4]); return t ? json(res, 200, t) : json(res, 404, { error: 'no such decision' });
    }
    if (req.method === 'POST' && p[3] === 'trace' && p[4] && p[5] === 'review') {
      const b = await body(req); await tel.review(await dbFor(condition, mind), p[4], b); return json(res, 200, { ok: true });
    }
    if (req.method === 'GET' && p[3] === 'face') return json(res, 200, emb.face(condition, mind) || {});
    if (req.method === 'POST' && p[3] === 'frame') {
      const b = await body(req); emb.putFrame(condition, mind, b.trial_id, String(b.png || '').replace(/^data:image\/png;base64,/, ''), b.mode); return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && p[3] === 'decoy') { const b = await body(req); emb.setDecoy(condition, mind, b.other); return json(res, 200, { ok: true }); }
    if (req.method === 'GET' && p[3] === 'trials') {
      const db = await dbFor(condition, mind);
      return json(res, 200, await db.all(`SELECT * FROM embodiment_trials ORDER BY id DESC LIMIT 200`));
    }
    return json(res, 404, { error: 'not found' });
  } catch (e) { json(res, 500, { error: e.message }); }
});

if (require.main === module) server.listen(config.PORT, '127.0.0.1', () => {
  console.log(`Synthesis-Janus on http://localhost:${config.PORT}  fluent=${config.FLUENT}  api_unlocked=${process.env.JANUS_ALLOW_API === '1'}  phase=${config.PHASE}  enforce=${config.ENFORCE}`);
  console.log(`  console: /janus/console   telemetry: /janus/lookup   face: /janus/face?mind=aeon`);
});
module.exports = { server, stats };
