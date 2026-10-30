// Memory side of a Janus mind: retrieval before the fluent call, learning after it, and the
// shared Janus commons where the eight minds see and review each other's hypotheses.
// Each mind keeps its OWN database and learns apart; only the commons is shared.
const config = require('./config');
const { openJanus } = require('./db');
const { gated } = require('./gate');
const pb = require('./panbirth');

const estTokens = (s) => Math.ceil((s || '').length / 4);
const clip = (s, n) => (s || '').length > n ? s.slice(0, n - 1) + '…' : (s || '');

let commonsDb = null;
const minds = new Map();

async function commons() {
  if (!commonsDb) {
    commonsDb = await openJanus(config.COMMONS_DB);
    // Janus addition: who reviewed what, so a mind cannot review its own hypothesis or
    // endorse the same one repeatedly (native Pan-Birth records neither).
    await commonsDb.exec(`CREATE TABLE IF NOT EXISTS janus_hypothesis_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT, hypothesis_id INTEGER NOT NULL, reviewer TEXT NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('endorse','challenge')), reasoning TEXT DEFAULT '',
      engine TEXT NOT NULL, decision_id TEXT DEFAULT NULL, created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(hypothesis_id, reviewer))`);
  }
  return commonsDb;
}

async function mind(name) {
  if (!config.MINDS.includes(name)) throw new Error(`unknown mind: ${name}`);
  if (!minds.has(name)) {
    const db = await openJanus(`${config.MINDS_DIR}/janus_${name}_mind.db`);
    if (db.entity !== name) throw new Error(`database for ${name} is stamped ${db.entity}`);
    minds.set(name, db);
  }
  return minds.get(name);
}

// ── Retrieval (spec "Memory design" → Retrieval), every item carries a citable id ──
async function retrieve(name, input, sessionId) {
  const db = await mind(name);
  const cdb = await commons();
  const { tokens, intent, tokenResult } = pb.analyse(name, input);
  const g = gated(db, { engine: 'janus-system' });
  const findConcepts = pb.bindFor(g, gated(cdb, { engine: 'janus-system' }), () => 'system').findActivatedConcepts;
  const directConcepts = await findConcepts(db, tokens);
  const labels = directConcepts.map(c => c.label.toLowerCase());

  const identity = await db.all(`SELECT key, value, confidence FROM identity ORDER BY confidence DESC`);
  const genesis = await db.get(`SELECT name, full_name, creator, origin, born_at, lineage, founding_principle FROM genesis WHERE id = 1`);

  const session = (await db.all(
    `SELECT id, speaker, content, engine, timestamp FROM episodes WHERE session_id = ? ORDER BY id DESC LIMIT ?`,
    [sessionId, config.SESSION_EPISODES])).reverse();
  const exclude = new Set(session.map(e => e.id));

  // Older episodes: overlap with concepts_activated first, then recency; fall back to content match.
  let older = [];
  if (labels.length) {
    const rows = await db.all(
      `SELECT id, speaker, content, engine, timestamp, concepts_activated FROM episodes
       WHERE (session_id IS NULL OR session_id <> ?) AND (${labels.map(() => 'LOWER(concepts_activated) LIKE ?').join(' OR ')})
       ORDER BY id DESC LIMIT 200`, [sessionId, ...labels.map(l => `%"${l}"%`)]);
    older = rows.map(r => ({ ...r, overlap: labels.filter(l => (r.concepts_activated || '').toLowerCase().includes(`"${l}"`)).length }))
      .sort((a, b) => b.overlap - a.overlap || b.id - a.id);
  }
  const contentTerms = tokens.filter(t => t.length > 3).slice(0, 5);
  if (older.length < config.OLDER_EPISODES && contentTerms.length) {
    const rows = await db.all(
      `SELECT id, speaker, content, engine, timestamp FROM episodes
       WHERE (session_id IS NULL OR session_id <> ?) AND (${contentTerms.map(() => 'LOWER(content) LIKE ?').join(' OR ')})
       ORDER BY id DESC LIMIT 40`, [sessionId, ...contentTerms.map(t => `%${t}%`)]);
    for (const r of rows) if (!older.some(o => o.id === r.id)) older.push({ ...r, overlap: 0 });
  }
  older = older.filter(e => !exclude.has(e.id)).slice(0, config.OLDER_EPISODES);

  const absTerms = [...new Set([...labels, ...contentTerms])].slice(0, 6);
  const abstractions = absTerms.length ? await db.all(
    `SELECT id, insight, confidence, engine FROM abstractions WHERE ${absTerms.map(() => 'LOWER(insight) LIKE ?').join(' OR ')}
     ORDER BY confidence DESC, id DESC LIMIT ?`, [...absTerms.map(t => `%${t}%`), config.ABSTRACTIONS]) : [];

  let truths = [];
  const fts = tokens.filter(t => /^[a-z0-9]+$/i.test(t)).slice(0, 8);
  if (fts.length) truths = await cdb.all(
    `SELECT t.id, t.claim, t.domain, t.contributed_by, t.confidence, t.engine FROM truths_fts f JOIN truths t ON t.id = f.rowid
     WHERE truths_fts MATCH ? AND t.status = 'active' ORDER BY rank LIMIT ?`, [fts.join(' OR '), config.TRUTHS]).catch(() => []);

  // Janus addition: open hypotheses from OTHER minds, so each mind can weigh them.
  const hypotheses = await cdb.all(
    `SELECT id, claim, domain, proposed_by, confidence, endorsements, challenges, engine FROM hypotheses
     WHERE status = 'proposed' AND proposed_by <> ? AND id NOT IN (SELECT hypothesis_id FROM janus_hypothesis_reviews WHERE reviewer = ?)
     ${fts.length ? `ORDER BY (${fts.map(() => 'LOWER(claim) LIKE ?').join(' + ')}) DESC, id DESC` : 'ORDER BY id DESC'} LIMIT ?`,
    [name, name, ...fts.map(t => `%${t}%`), config.HYPOTHESES]);

  const pack = { identity, genesis, session, older, abstractions, truths, hypotheses };
  trimToBudget(pack);
  return { ...pack, tokens, tokenResult, intent, directConcepts };
}

function trimToBudget(pack) {
  const size = () => estTokens(JSON.stringify(pack));
  for (const key of ['truths', 'hypotheses', 'abstractions', 'older', 'session']) {
    while (size() > config.PROMPT_BUDGET_TOKENS && pack[key].length) pack[key].pop();
  }
}

function renderMemory(r) {
  const L = [];
  if (r.genesis) L.push(`Genesis: ${r.genesis.full_name} (${r.genesis.name}), created by ${r.genesis.creator}. Lineage: ${r.genesis.lineage}. Founding principle: ${r.genesis.founding_principle}`);
  if (r.identity.length) L.push('Identity:\n' + r.identity.map(i => `- ${i.key}: ${clip(i.value, 200)}`).join('\n'));
  if (r.older.length) L.push('Remembered episodes (cite as E#id):\n' + r.older.map(e => `- E#${e.id} [${e.speaker}] ${clip(e.content, 280)}`).join('\n'));
  if (r.abstractions.length) L.push('Abstractions (cite as A#id):\n' + r.abstractions.map(a => `- A#${a.id} (conf ${(+a.confidence).toFixed(2)}) ${clip(a.insight, 240)}`).join('\n'));
  if (r.truths.length) L.push('Shared truths (cite as T#id):\n' + r.truths.map(t => `- T#${t.id} [${t.contributed_by}, ${t.domain}] ${clip(t.claim, 240)}`).join('\n'));
  if (r.hypotheses.length) L.push('Open hypotheses from other minds (cite as H#id):\n' + r.hypotheses.map(h => `- H#${h.id} by ${h.proposed_by} (+${h.endorsements}/-${h.challenges}) ${clip(h.claim, 240)}`).join('\n'));
  return L.join('\n\n');
}

// ── Learning: Pan-Birth's own learnV8WithBias, run against the gated Janus copy ──
async function learn(name, { input, reply, speaker, sessionId, retrieval, loopTrialId = null, percept = 'none' }) {
  const db = await mind(name);
  const cdb = await commons();
  const mg = gated(db, { engine: 'claude', mind: name, engineBySpeaker: true, percept, loopTrialId });
  const cg = gated(cdb, { engine: 'claude' });
  const bound = pb.bindFor(mg, cg, () => speaker);
  const bias = pb.strengths.getLearningBias(pb.RESIDENTS[name].strength);
  await bound.learn(db, input, reply, retrieval.tokenResult, retrieval.directConcepts, retrieval.intent,
    sessionId, name, { dbAll: mg.dbAll, dbGet: mg.dbGet, dbRun: mg.dbRun }, bias, null);
  const ep = await db.get(`SELECT id FROM episodes WHERE session_id = ? AND speaker = ? ORDER BY id DESC LIMIT 1`, [sessionId, speaker]);
  return ep ? ep.id : null;
}

// Refusals are their own episode type and teach no concepts.
async function recordRefusal(name, { input, reply, speaker, sessionId }) {
  const db = await mind(name);
  const mg = gated(db, { engine: 'claude', mind: name, engineBySpeaker: true });
  const r = await mg.run(`INSERT INTO episodes (speaker, content, modality, emotional_state, concepts_activated, session_id) VALUES (?, ?, 'text', 'refusal', '[]', ?)`, [speaker, input, sessionId]);
  await mg.run(`INSERT INTO episodes (speaker, content, modality, emotional_state, concepts_activated, session_id) VALUES (?, ?, 'text', 'refusal', '[]', ?)`, [name, reply, sessionId]);
  return r.lastID;
}

// ── Commons: hypotheses (Pan-Birth's own propose/review/promote, behind Janus guards) ──
async function proposeHypothesis(name, { claim, reasoning, basedOn = [] }) {
  const cdb = await commons();
  const bound = pb.bindFor(gated(await mind(name), { engine: 'claude' }), gated(cdb, { engine: 'claude' }), () => name);
  return bound.omniTruth.proposeHypothesis(name, {
    claim: clip(claim, 500), strengthUsed: pb.RESIDENTS[name].strength,
    reasoning: clip(reasoning || 'Proposed by Janus hybrid during conversation.', 500),
    basedOnTruthIds: basedOn });
}
async function reviewHypothesis(name, { hypothesisId, action, reasoning, decisionId }) {
  const cdb = await commons();
  const hyp = await cdb.get(`SELECT proposed_by, status FROM hypotheses WHERE id = ?`, [hypothesisId]);
  if (!hyp) return { skipped: 'no such hypothesis' };
  if (hyp.proposed_by === name) return { skipped: 'minds do not review their own hypotheses' };
  if (hyp.status !== 'proposed') return { skipped: `hypothesis is ${hyp.status}` };
  if (!['endorse', 'challenge'].includes(action)) return { skipped: `unknown action ${action}` };
  try {
    await cdb.run(`INSERT INTO janus_hypothesis_reviews (hypothesis_id, reviewer, action, reasoning, engine, decision_id) VALUES (?, ?, ?, ?, 'claude', ?)`,
      [hypothesisId, name, action, clip(reasoning, 500), decisionId || null]);
  } catch { return { skipped: 'already reviewed by this mind' }; }
  const bound = pb.bindFor(gated(await mind(name), { engine: 'claude' }), gated(cdb, { engine: 'claude' }), () => name);
  return bound.omniTruth.reviewHypothesis(name, hypothesisId, action, reasoning);
}

module.exports = { mind, commons, retrieve, renderMemory, learn, recordRefusal, proposeHypothesis, reviewHypothesis, estTokens };
