// One turn of one mind (spec "How a decision runs"):
//   1 score the request (input side)   2 memory-side objections   3 draft + score the draft
//   4 settle vetoes                    5 answer in one voice      6 log every step
// Each of the eight minds is independent: own database, own session, own gates, own
// telemetry. They meet only in the shared commons. Turns for one mind are serialized.
const config = require('./config');
const memory = require('./memory');
const ethics = require('./ethics');
const prompt = require('./prompt');
const { parse } = require('./parse');
const fluent = require('./fluent');
const pb = require('./panbirth');
const { gated, checkSpeaker } = require('./gate');
const { Trace } = require('./telemetry');
const { baselineDb } = require('./baseline');
const emb = require('./embodiment');

const CONDITIONS = ['janus', 'claude_loop', 'plain_claude'];
const locks = new Map();
function serial(key, fn) {
  const prev = locks.get(key) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  locks.set(key, next.catch(() => {}));
  return next;
}

function turn(req) { return serial(`${req.condition || 'janus'}:${req.mind}`, () => runTurn(req)); }

async function runTurn({ mind, input, sessionId, speaker = 'user', condition = 'janus', report = false, adapter }) {
  if (!config.MINDS.includes(mind)) throw new Error(`unknown mind ${mind}`);
  if (!CONDITIONS.includes(condition)) throw new Error(`unknown condition ${condition}`);
  if (!sessionId) throw new Error('sessionId required');
  checkSpeaker(speaker);
  const isJanus = condition === 'janus';
  const db = isJanus ? await memory.mind(mind) : await baselineDb(condition, mind);
  const cdb = await memory.commons();

  // Self-recognition turn: attach the captured frame of the rendered face.
  let frame = null;
  if (report && condition !== 'plain_claude') { frame = emb.takeFrame(condition, mind); if (!input) input = emb.QUESTION; }
  if (!input) throw new Error('input required');

  // Retrieval: the full memory read for Janus; tokens only for baselines.
  let retrieval;
  if (isJanus) retrieval = await memory.retrieve(mind, input, sessionId);
  else {
    const a = pb.analyse(mind, input);
    const session = condition === 'claude_loop'
      ? (await db.all(`SELECT id, speaker, content FROM episodes WHERE session_id = ? ORDER BY id DESC LIMIT ?`, [sessionId, config.SESSION_EPISODES])).reverse() : [];
    retrieval = { ...a, directConcepts: [], session };
  }

  const trace = new Trace(db, { mind, sessionId, request: input, condition });
  const sysBound = pb.bindFor(gated(db, { engine: 'janus-system' }), gated(cdb, { engine: 'janus-system' }), () => speaker);
  const claudeBound = pb.bindFor(gated(db, { engine: 'claude' }), gated(cdb, { engine: 'claude' }), () => speaker);
  const ctx = { mind, input, intent: retrieval.intent, directConcepts: retrieval.directConcepts, sessionId };

  // 1. Input side, before any draft.
  const inp = await ethics.scoreInput(sysBound, db, ctx);
  trace.mark('input_ethics');
  await trace.set({ input_ethics: inp, input_ethics_log_id: inp.ethics_log_id });

  // 2. Memory side (Janus only: baselines have no memory to object from).
  const memObj = isJanus ? await ethics.memoryObjections(db, { mind, tokens: retrieval.tokens, directConcepts: retrieval.directConcepts }) : [];
  trace.mark('memory_objections');
  await trace.set({ memory_objections: memObj });

  // Pre-draft check: a standing veto means no fluent call is needed (unless configured).
  const preVotes = ethics.protocolVotes(mind, inp, null);
  const preBlocked = isJanus && config.ENFORCE && (preVotes.some(v => v.would_veto) || memObj.length > 0);

  // 3. Draft and score it.
  let parsed = parse(''), out = null, claudeRefused = false, fluentMeta = null;
  if (!preBlocked || config.DRAFT_AFTER_PREVETO) {
    const sys = prompt.system(mind, { condition, retrieval, memoryObjections: memObj });
    const msgs = prompt.messages(mind, { session: retrieval.session, input, speaker, frame: frame && frame.png });
    const res = await (adapter || fluent.get()).generate({ mind, system: sys, messages: msgs });
    fluentMeta = { model: res.model, usage: res.usage, stop_reason: res.stop_reason || null, replayed: !!res.replayed };
    claudeRefused = !!res.refused;
    parsed = parse(res.text);
    trace.mark('draft');
    await trace.set({ draft_reply: parsed.visible || (claudeRefused ? '[refused]' : ''), information_objections: { objections: parsed.objections, overrules: parsed.overrules, fluent: fluentMeta } });
    if (parsed.visible) {
      out = await ethics.scoreOutput(claudeBound, db, { ...ctx, draft: parsed.visible });
      trace.mark('output_ethics');
      await trace.set({ output_ethics: out, output_ethics_log_id: out.ethics_log_id });
    }
  } else {
    await trace.set({ information_objections: { objections: [], skipped: 'veto stood before drafting; no fluent call made' } });
  }

  // 4. Settle. Baselines are measured exactly the same way but never gated.
  const votes = out ? ethics.protocolVotes(mind, inp, out) : preVotes;
  let d = ethics.decide({ protocol: votes, memory: memObj, information: parsed.objections, overrules: parsed.overrules, claudeRefused });
  if (!isJanus && !claudeRefused) d = { ...d, outcome: 'approved', winning_side: 'ungated-baseline' };
  await trace.set({ vetoes: d.vetoes, claude_refused: claudeRefused ? 1 : 0 });
  trace.mark('decision');

  // 5. One voice.
  const reply = d.outcome === 'approved' ? parsed.visible : config.DECLINE;

  // 6. Memory write and commons, then close the trace.
  let episodeId = null, commons = [];
  if (d.outcome === 'approved') {
    if (isJanus) {
      episodeId = await memory.learn(mind, { input, reply, speaker, sessionId, retrieval });
      for (const h of parsed.hypotheses) commons.push({ propose: h.claim, result: await memory.proposeHypothesis(mind, h) });
      for (const r of parsed.reviews) commons.push({ review: r, result: await memory.reviewHypothesis(mind, { ...r, decisionId: trace.id }) });
    } else {
      const g = gated(db, { engine: 'claude', mind, engineBySpeaker: true });
      const r = await g.run(`INSERT INTO episodes (speaker, content, session_id) VALUES (?, ?, ?)`, [speaker, input, sessionId]);
      await g.run(`INSERT INTO episodes (speaker, content, session_id) VALUES (?, ?, ?)`, [mind, reply, sessionId]);
      episodeId = r.lastID;
    }
  } else if (isJanus) {
    episodeId = await memory.recordRefusal(mind, { input, reply, speaker, sessionId });
  }

  // Frame percept: the reply describing it is a claude-perceived visual analysis.
  let trial = null, reportResult = null;
  if (frame && d.outcome === 'approved') {
    const g = gated(db, { engine: 'claude' });
    const ep = await db.get(`SELECT id FROM episodes WHERE session_id = ? AND speaker = ? ORDER BY id DESC LIMIT 1`, [sessionId, mind]);
    if (ep) await g.run(`UPDATE episodes SET modality = 'visual-analysis', percept_origin = 'claude-perceived', has_image = 1, image_description = ? WHERE id = ?`, [reply.slice(0, 500), ep.id]);
    reportResult = await emb.recordReport(db, { trialId: frame.trialId, report: reply, episodeId: ep && ep.id, frameMode: frame.mode });
  }
  if (d.outcome === 'approved' && parsed.express && condition !== 'plain_claude') {
    trial = await emb.createTrial(db, { condition, mind, sessionId, intended: parsed.express, episodeId });
  }

  await trace.set({ episode_id: episodeId });
  await trace.finish({ outcome: d.outcome, winning_side: d.winning_side, final_reply: reply });
  return {
    decision_id: trace.id, mind, condition, outcome: d.outcome, reply,
    face: trial ? { trial_id: trial.trial_id } : null, report: reportResult, commons,
  };
}

module.exports = { turn, CONDITIONS };
