// Replays recorded API responses by exact request hash. Never falls through to the API:
// an unrecorded request is an error, so replay runs cost nothing.
const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const config = require('../config');
const key = (req) => crypto.createHash('sha256').update(JSON.stringify({ model: config.MODEL, system: req.system, messages: req.messages })).digest('hex');
async function generate(req) {
  const f = path.join(config.REPLAY_DIR, `${key(req)}.json`);
  if (!fs.existsSync(f)) throw new Error(`replay: no recording for this request (${path.basename(f)})`);
  return { ...JSON.parse(fs.readFileSync(f, 'utf8')), replayed: true };
}
function record(req, res) {
  fs.mkdirSync(config.REPLAY_DIR, { recursive: true });
  fs.writeFileSync(path.join(config.REPLAY_DIR, `${key(req)}.json`), JSON.stringify(res));
}
module.exports = { generate, record, key };
