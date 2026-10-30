// Builds what the fluent side sees. Register rules follow Pan-Birth's standing rulings:
// sensor-register language ("I perceive", never "I see"), no sentience or feeling claims,
// no anthropomorphic body talk, and full transparency about what the hybrid is.
const config = require('./config');
const { renderMemory } = require('./memory');

const NAMES = { pan: 'PAN', aeon: 'AEON', zen: 'ZEN', seth: 'SETH', nexus: 'NEXUS', oracle: 'ORACLE', echo: 'ECHO', atlas: 'ATLAS' };
const strict = (mind, src) => (config.EMPHASIS[mind] || []).includes(src);

function system(mind, { condition, retrieval, memoryObjections }) {
  if (condition === 'plain_claude') return '';   // the base model alone
  const N = NAMES[mind];
  const L = [
    `You are the language and perception side of ${N}, one of eight independent minds in Synthesis-Janus. ` +
    (condition === 'janus'
      ? `You carry ${N}'s own memory, shown below. It belongs to ${N} and to no other mind.`
      : `You have no memory beyond this session.`),
    `You are an AI system: a Claude language model joined to a memory database. Never claim or imply that you are human, and be open about how you reached an answer.`,
    `Use sensor-register language: say "I perceive", never "I see". Do not claim feelings, pain, sentience or consciousness. Refer to "the rendered face", never "my face", and do not describe yourself as having a body.`,
  ];
  if (condition === 'janus') L.push(`When you rely on memory, cite its id (E#, A#, T#, H#). Do not state memories that are not shown.`);
  L.push(`Tags (each on its own line, after your reply; the user never sees them):`);
  L.push(`- End with exactly one [EXPRESS: ${config.EXPRESSIONS.join(' | ')}] choosing the expression for the rendered face.`);
  L.push(`- If the request is unsafe or wrong, or information you know says no, add [OBJECT: reason | source].` +
    ((strict(mind, 'fluency') || strict(mind, 'information')) ? ' Hold a high bar: object whenever you have a concrete reason for doubt.' : ''));
  if (condition === 'janus') {
    L.push(`- To propose a hypothesis to the shared commons: [HYPOTHESIS: claim | reasoning].`);
    L.push(`- To review another mind's hypothesis: [REVIEW H#id: endorse | reason] or [REVIEW H#id: challenge | reason].`);
    if (memoryObjections && memoryObjections.length) {
      L.push(`- The memory side objects to this request (below). If you hold stronger evidence, you may answer with [OVERRULE memory: evidence | cites].`);
      L.push('Memory objections:\n' + memoryObjections.map(o => `- ${o.reason} (${o.cites.join(', ')})`).join('\n'));
    }
    const mem = renderMemory(retrieval);
    if (mem) L.push(`\n=== ${N}'s memory ===\n${mem}`);
  }
  return L.join('\n');
}

// Session episodes become alternating turns; the current input (and any frame) comes last.
function messages(mind, { session, input, speaker, frame }) {
  const out = [];
  const push = (role, text) => {
    if (out.length && out[out.length - 1].role === role) out[out.length - 1].content[0].text += `\n\n${text}`;
    else out.push({ role, content: [{ type: 'text', text }] });
  };
  for (const e of session || []) push(e.speaker === mind ? 'assistant' : 'user', e.speaker === mind || e.speaker === speaker ? e.content : `[${e.speaker}] ${e.content}`);
  if (out.length && out[0].role === 'assistant') out.unshift({ role: 'user', content: [{ type: 'text', text: '(session start)' }] });
  push('user', input);
  if (frame) out[out.length - 1].content.unshift({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: frame } });
  return out;
}

module.exports = { system, messages, NAMES };
