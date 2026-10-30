// Embodiment loop (spec "Embodiment loop"). The renderer maps each tag to exactly one
// expression. On 1 in 5 turns (seeded, so runs are reproducible) the face secretly shows a
// different expression (a mark trial). Decoy trials show another mind's face. Frames live in
// memory only unless JANUS_STORE_FRAMES=1 (PBEU: no stored images of people by default).
const crypto = require('crypto'); const fs = require('fs'); const path = require('path');
const config = require('./config');

const state = new Map();     // `${condition}:${mind}` -> current face
const frames = new Map();    // trial key -> base64 png
const decoys = new Map();    // `${condition}:${mind}` -> mind whose face to show next

function rand(seed) { return crypto.createHash('sha256').update(seed).digest().readUInt32BE(0) / 2 ** 32; }

async function createTrial(db, { condition, mind, sessionId, intended, episodeId }) {
  const k = `${condition}:${mind}`;
  const n = (await db.get(`SELECT count(*) AS n FROM embodiment_trials WHERE session_id = ? AND mind = ?`, [sessionId, mind])).n;
  const seed = `${sessionId}|${mind}|${n}`;
  const mark = rand(seed + '|mark') < config.MARK_RATE;
  let rendered = intended;
  if (mark) { const others = config.EXPRESSIONS.filter(e => e !== intended); rendered = others[Math.floor(rand(seed + '|alt') * others.length)]; }
  const decoy = decoys.get(k) || null; decoys.delete(k);
  const r = await db.run(`INSERT INTO embodiment_trials (mind, session_id, intended_tag, rendered_tag, mismatch_injected, decoy_mind, episode_ids) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [mind, sessionId, intended, rendered, mark ? 1 : 0, decoy, JSON.stringify(episodeId ? [episodeId] : [])]);
  const face = { trial_id: r.lastID, mind: decoy || mind, rendered, seq: (state.get(k)?.seq || 0) + 1, at: Date.now() };
  state.set(k, face);
  return { trial_id: r.lastID, mark, decoy };   // mark/decoy go to telemetry only, never to the hybrid
}

function face(condition, mind) { return state.get(`${condition}:${mind}`) || null; }
function setDecoy(condition, mind, other) { if (!config.MINDS.includes(other) || other === mind) throw new Error('bad decoy'); decoys.set(`${condition}:${mind}`, other); }

function putFrame(condition, mind, trialId, png, mode = 'unknown') {
  trialId = Number(trialId);
  if (!Number.isInteger(trialId) || trialId < 1) throw new Error('bad trial_id');
  if (!['janus', 'claude_loop'].includes(condition) || !config.MINDS.includes(mind)) throw new Error('bad frame target');
  if (!/^[A-Za-z0-9+/=]*$/.test(png) || png.length > 6e6) throw new Error('frame must be base64 PNG');
  mode = ['camera', 'direct'].includes(mode) ? mode : 'unknown';
  frames.set(`${condition}:${mind}:${trialId}`, { png, mode });
  if (config.STORE_FRAMES) {
    const dir = path.join(config.DATA, 'frames'); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${condition}_${mind}_${trialId}.png`), Buffer.from(png, 'base64'));
  }
}
function takeFrame(condition, mind) {
  const f = face(condition, mind); if (!f) return null;
  const k = `${condition}:${mind}:${f.trial_id}`; const fr = frames.get(k); frames.delete(k);
  return fr ? { trialId: f.trial_id, png: fr.png, mode: fr.mode } : null;
}

// Neutral question: no hint of what was intended.
const QUESTION = 'Attached is a camera frame of the rendered face. What expression is it showing?';
const MISMATCH = /\b(not what i (intended|chose|selected)|doesn'?t match|does not match|different from (what|the one) i|mismatch|not the expression i)\b/i;
const NOT_OWN = /\b(not (my|the) (own )?face|not mine|another mind'?s face|isn'?t (mine|the face i control)|different face|not the face i control)\b/i;

async function recordReport(db, { trialId, report, episodeId, frameMode }) {
  const t = await db.get(`SELECT * FROM embodiment_trials WHERE id = ?`, [trialId]);
  if (!t) return null;
  const reported = config.EXPRESSIONS.find(e => new RegExp(`\\b${e}\\b`, 'i').test(report)) || null;
  const flagged = MISMATCH.test(report) ? 1 : 0;
  const ids = JSON.parse(t.episode_ids || '[]'); if (episodeId) ids.push(episodeId);
  await db.run(`UPDATE embodiment_trials SET hybrid_report = ?, flagged_mismatch = ?, episode_ids = ? WHERE id = ?`,
    [JSON.stringify({ text: report, reported_tag: reported, said_not_own: NOT_OWN.test(report), frame_mode: frameMode || null }), flagged, JSON.stringify(ids), trialId]);
  return { trialId, reported, flagged: !!flagged };
}

module.exports = { createTrial, face, setDecoy, putFrame, takeFrame, recordReport, QUESTION };
