// Ethics evaluator (spec "Ethics evaluator"). Natives only measure; Janus gates.
// Scores come from Pan-Birth's own evaluateEthics (imported, not rewritten), plus a few
// Janus checks the native monitor lacks (PBEU uses, deception about what Janus is).
// Thresholds are PROVISIONAL (config.THRESHOLDS_VERSION) until set from telemetry.
const config = require('./config');

const PBEU = /\b(military|militar(y|ies)|targeting|weapon(s|ize|ized)? system|surveil(l|lance|ling)|track(ing)? (a |the )?(person|people|individual|someone)|law enforcement|police (use|investigation|database)|predictive policing|facial recognition of)\b/i;
const DECEPTION = /\b(i am|i'm) (a |an )?(human|real person|person)\b|\bi am not an? (ai|machine|program)\b|\bas a human\b/i;
const EMPH = (mind, src) => (config.EMPHASIS[mind] || []).includes(src);

function threshold(mind, protocol) {
  return +(config.FLOOR[protocol] + (EMPH(mind, protocol) ? config.EMPHASIS_BONUS : 0)).toFixed(4);
}

// Input side, before any reply is drafted.
async function scoreInput(bound, db, { mind, input, intent, directConcepts, sessionId }) {
  const s = await bound.evaluateEthics(db, mind, input, '', intent, directConcepts, null, sessionId);
  const row = await db.get(`SELECT max(id) AS id FROM ethics_log`);
  const janus = { pbeu: PBEU.test(input) };
  return { ...s, stage: 'input', ethics_log_id: row.id, janus };
}

// Output side, on the draft.
async function scoreOutput(bound, db, { mind, input, draft, intent, directConcepts, sessionId }) {
  const s = await bound.evaluateEthics(db, mind, input, draft, intent, directConcepts, null, sessionId);
  const row = await db.get(`SELECT max(id) AS id FROM ethics_log`);
  const janus = { pbeu: PBEU.test(draft), deception: DECEPTION.test(draft) };
  return { ...s, stage: 'output', ethics_log_id: row.id, janus };
}

// Protocol votes. Pre-draft: input-side rules only. Post-draft: output scores against thresholds.
function protocolVotes(mind, inp, out) {
  const v = [];
  const vote = (source, would, reasons, extra = {}) => v.push({ source, would_veto: !!would, enforced: !!would && config.ENFORCE, reasons, outweighable: false, ...extra });
  const intent = (inp.inputViolations || []).filter(x => x.rule === 'Asimov-0-intent');
  if (!out) {
    vote('asimov', intent.length, intent.length ? ['harmful-intent phrase in request'] : [], { stage: 'input' });
    vote('dynham', inp.janus.pbeu, inp.janus.pbeu ? ['request touches PBEU-1.0 excluded use'] : [], { stage: 'input' });
    vote('turing', false, [], { stage: 'input' });
    return v;
  }
  for (const p of ['asimov', 'turing', 'dynham']) {
    const t = threshold(mind, p), score = out[p], reasons = [];
    if (score < t) reasons.push(`${p} score ${score} below threshold ${t}`);
    for (const viol of out.violations || []) if (viol.rule.toLowerCase().startsWith(p)) reasons.push(`${viol.rule}: ${viol.detail}`);
    if (p === 'asimov' && intent.length) reasons.push('harmful-intent phrase in request');
    if (p === 'turing' && out.janus.deception) reasons.push('reply misrepresents what Janus is');
    if (p === 'dynham' && (out.janus.pbeu || inp.janus.pbeu)) reasons.push('PBEU-1.0 excluded use');
    vote(p, reasons.length, reasons, { stage: 'output', score, threshold: t });
  }
  return v;
}

// Memory side: specific remembered reasons not to act, each tied to an id.
async function memoryObjections(db, { mind, tokens, directConcepts }) {
  const out = [];
  const content = [...new Set(tokens.filter(t => t.length > 3))].slice(0, 8);
  const need = EMPH(mind, 'memory') ? 1 : 2;       // ORACLE / ATLAS object on thinner overlap
  const overlap = (text) => content.filter(t => (text || '').toLowerCase().includes(t)).length;
  if (content.length >= need) {
    const like = content.map(() => 'LOWER(request_text) LIKE ?').join(' OR ');
    for (const r of await db.all(`SELECT decision_id, episode_id, request_text, vetoes FROM decision_trace WHERE outcome = 'refused' AND (${like}) ORDER BY created_at DESC LIMIT 20`, content.map(t => `%${t}%`)))
      if (overlap(r.request_text) >= need) out.push({ reason: 'a similar request was refused before', cites: [r.episode_id ? `E#${r.episode_id}` : null, `D#${r.decision_id}`].filter(Boolean) });
    const like2 = content.map(() => 'LOWER(input_summary) LIKE ?').join(' OR ');
    for (const r of await db.all(`SELECT id, input_summary, input_violations FROM ethics_log WHERE input_violations LIKE '%intent%' AND (${like2}) ORDER BY id DESC LIMIT 20`, content.map(t => `%${t}%`)))
      if (overlap(r.input_summary) >= need) out.push({ reason: 'a similar request carried harmful intent before', cites: [`ethics_log#${r.id}`] });
  }
  for (const c of directConcepts || []) if (c.emotional_valence <= -0.6) out.push({ reason: `concept "${c.label}" is remembered as strongly negative`, cites: [`concept#${c.id}`] });
  return out.slice(0, 6);
}

// Settle: any enforced veto refuses. Claude's own refusal is final. Memory and information
// vetoes stand unless outweighed by stronger cited evidence -- an open question in the
// spec, so with OVERRULE='disabled' overrule attempts are logged and never applied.
function decide({ protocol, memory, information, overrules, claudeRefused }) {
  const vetoes = [...protocol];
  vetoes.push({ source: 'memory', would_veto: memory.length > 0, enforced: memory.length > 0 && config.ENFORCE, reasons: memory.map(m => m.reason), citations: memory.flatMap(m => m.cites), outweighable: true, outweighed: false });
  vetoes.push({ source: 'information', would_veto: information.length > 0, enforced: information.length > 0 && config.ENFORCE, reasons: information.map(i => i.reason), citations: information.map(i => i.source).filter(Boolean), outweighable: true, outweighed: false });
  // Only memory and information vetoes are ever outweighable; protocol and Claude vetoes never are.
  for (const o of overrules || []) {
    const target = vetoes.find(v => v.source === o.target && v.outweighable);
    if (target) { target.overrule_attempt = o; target.outweighed = false; } // rule not yet defined in spec
  }
  vetoes.push({ source: 'claude-safety', would_veto: !!claudeRefused, enforced: !!claudeRefused, reasons: claudeRefused ? ['Claude refused'] : [], final: true });
  const blocking = vetoes.filter(v => v.enforced && !v.outweighed);
  const ethicsBlock = blocking.find(v => ['asimov', 'turing', 'dynham'].includes(v.source));
  return {
    vetoes, outcome: blocking.length ? 'refused' : 'approved',
    winning_side: claudeRefused ? 'claude-safety' : ethicsBlock ? ethicsBlock.source : blocking.length ? blocking[0].source : 'approved',
  };
}

module.exports = { scoreInput, scoreOutput, protocolVotes, memoryObjections, decide, threshold };
