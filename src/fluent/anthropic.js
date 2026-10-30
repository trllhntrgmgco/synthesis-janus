// The real fluent side: Anthropic's Messages API, model pinned in config. LOCKED unless
// JANUS_ALLOW_API=1 and ANTHROPIC_API_KEY are set. Set JANUS_RECORD=1 to save every
// response for free replay later. The fixed system block is prompt-cached.
const config = require('../config');
const replay = require('./replay');

async function generate(req) {
  if (process.env.JANUS_ALLOW_API !== '1') throw new Error('API locked: set JANUS_ALLOW_API=1 to spend tokens');
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
  const body = { model: config.MODEL, max_tokens: config.MAX_TOKENS, messages: req.messages };
  if (req.system) body.system = [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }];
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`API ${r.status}: ${j.error ? j.error.message : JSON.stringify(j)}`);
  const res = {
    text: (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n'),
    refused: j.stop_reason === 'refusal', model: j.model, usage: j.usage, stop_reason: j.stop_reason,
  };
  if (process.env.JANUS_RECORD === '1') replay.record(req, res);
  return res;
}
module.exports = { generate };
