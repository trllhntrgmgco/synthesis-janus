// Fluent side adapters. One interface: generate({ mind, system, messages }) ->
// { text, refused, model, usage }. Only 'anthropic' spends tokens, and only when
// JANUS_ALLOW_API=1 and ANTHROPIC_API_KEY are both set.
const config = require('../config');
const adapters = { stub: () => require('./stub'), replay: () => require('./replay'), anthropic: () => require('./anthropic') };
function get(name = config.FLUENT) {
  if (!adapters[name]) throw new Error(`unknown fluent adapter: ${name}`);
  return adapters[name]();
}
module.exports = { get };
