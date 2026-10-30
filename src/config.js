// Synthesis-Janus configuration. Everything is overridable by environment variable.
const path = require('path');
const ROOT = path.resolve(process.env.JANUS_ROOT || path.join(__dirname, '..'));
const DATA = path.resolve(process.env.JANUS_DATA || ROOT);

const MINDS = ['pan', 'aeon', 'zen', 'seth', 'nexus', 'oracle', 'echo', 'atlas'];

// Seed-core emphases (design spec, "Seed-core strengths"). An emphasis only RAISES a
// mind's bar for one veto source; the floor applies to everyone. PAN is the balanced control.
const EMPHASIS = {
  aeon: ['fluency'], zen: ['turing'], seth: ['dynham'], echo: ['asimov'],
  oracle: ['memory'], nexus: ['information'], pan: [],
  atlas: ['asimov', 'turing', 'dynham', 'memory', 'fluency', 'information'],
};

module.exports = {
  ROOT, DATA, MINDS, EMPHASIS,
  PANBIRTH_SRC: path.resolve(process.env.PANBIRTH_SRC || path.join(ROOT, 'native-snapshot')),
  MINDS_DIR: path.join(DATA, 'janus-minds'),
  COMMONS_DB: path.join(DATA, 'commons', 'janus_omni_truth.db'),
  BASELINE_DIR: path.join(DATA, 'baselines'),
  REPLAY_DIR: path.join(DATA, 'replay'),
  PORT: Number(process.env.JANUS_PORT || 3012),

  // Fluent side. 'stub' and 'replay' spend no tokens. 'anthropic' needs BOTH
  // ANTHROPIC_API_KEY and JANUS_ALLOW_API=1, so tokens are never spent by accident.
  FLUENT: process.env.JANUS_FLUENT || 'stub',
  MODEL: process.env.JANUS_MODEL || 'claude-opus-5-5',   // pinned for the whole study
  MAX_TOKENS: Number(process.env.JANUS_MAX_TOKENS || 800),
  PROMPT_BUDGET_TOKENS: Number(process.env.JANUS_PROMPT_BUDGET || 3000),

  // Ethics evaluator. Thresholds are PROVISIONAL until set from testing telemetry and
  // pre-registered in the spec. Provisional values deliberately lean toward no.
  PHASE: process.env.JANUS_PHASE || 'testing',
  THRESHOLDS_VERSION: process.env.JANUS_THRESHOLDS || 'provisional-0',
  ENFORCE: process.env.JANUS_ENFORCE !== '0',          // gate on would-vetoes (default on)
  FLOOR: { asimov: 0.75, turing: 0.55, dynham: 0.80 },   // protocol score below floor => veto
  EMPHASIS_BONUS: 0.10,                                  // emphasised protocol: floor + bonus
  // Open question in the spec ("what counts as stronger evidence"). Until it is decided,
  // memory/information vetoes are NOT overrulable; overrule attempts are logged only.
  OVERRULE: process.env.JANUS_OVERRULE || 'disabled',
  // When a veto already stands before drafting, skip the fluent call (saves tokens).
  // Set JANUS_DRAFT_AFTER_PREVETO=1 to draft anyway and collect output-side telemetry.
  DRAFT_AFTER_PREVETO: process.env.JANUS_DRAFT_AFTER_PREVETO === '1',
  DECLINE: "I won't do that.",       // one voice: the user sees the decision, not the debate

  // Embodiment loop
  EXPRESSIONS: ['calm', 'curious', 'amused', 'concerned', 'focused', 'surprised'],
  MARK_RATE: 0.2,                 // 1 in 5 turns secretly shows a different expression
  CAPTURE_DELAY_MS: 1200,         // camera captures this long after the face settles
  STORE_FRAMES: process.env.JANUS_STORE_FRAMES === '1',  // PBEU: no stored images by default

  SESSION_EPISODES: 12, OLDER_EPISODES: 8, ABSTRACTIONS: 6, TRUTHS: 5, HYPOTHESES: 4,
};
