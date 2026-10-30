// Loads Pan-Birth's OWN code (v10.1 snapshot) for Janus to run, instead of rewriting it.
// Clean modules are required directly. Functions that live inside the server file
// (evaluateEthics, learnV8WithBias, ...) are sliced out of the source text verbatim and
// compiled with their dependencies injected. Nothing here can touch native databases:
// every db handle passed in is a gated Janus copy.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');

const SRC = config.PANBIRTH_SRC;
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');
const serverSrc = read('consciousness-city-server-v8.js');
const omniSrc = read('omni-truth-v8.js');

function sliceFunction(src, header) {
  const i = src.indexOf(header);
  if (i < 0) throw new Error(`Pan-Birth source changed: "${header}" not found`);
  const end = src.indexOf('\n}\n', i);
  if (end < 0) throw new Error(`Pan-Birth source changed: end of "${header}" not found`);
  return src.slice(i, end + 2);
}
function sliceObject(src, header) {
  const i = src.indexOf(header);
  if (i < 0) throw new Error(`Pan-Birth source changed: "${header}" not found`);
  return src.slice(i, src.indexOf('\n};', i) + 3);
}
function compile(fnSrc, name, deps) {
  const names = Object.keys(deps);
  return new Function(...names, `"use strict";\n${fnSrc}\nreturn ${name};`)(...names.map(n => deps[n]));
}

// Fingerprint of exactly what Janus is running, recorded with every decision trace.
const fingerprint = crypto.createHash('sha256')
  .update(sliceFunction(serverSrc, 'async function evaluateEthics('))
  .update(sliceFunction(serverSrc, 'async function learnV8WithBias('))
  .digest('hex').slice(0, 12);

const cognitive = require(path.join(SRC, 'cognitive-engine-v8'));
const cognitive9 = require(path.join(SRC, 'cognitive-engine-v9'));
const strengths = require(path.join(SRC, 'strength-profiles-v8'));
const capabilities = require(path.join(SRC, 'mind-capabilities'));

const DOMAIN_ASSIGNMENTS = new Function(`${sliceObject(omniSrc, 'const DOMAIN_ASSIGNMENTS = {')}\nreturn DOMAIN_ASSIGNMENTS;`)();
const RESIDENTS = new Function('path', '__dirname', 'MINDS_DIR',
  `${sliceObject(serverSrc, 'const RESIDENTS = {')}\nreturn RESIDENTS;`)(path, SRC, path.join(SRC, 'minds'));
for (const r of Object.values(RESIDENTS)) { r.path = null; r.db = null; }   // never point at native files

const ethicsSrc = sliceFunction(serverSrc, 'async function evaluateEthics(');
const learnSrc = sliceFunction(serverSrc, 'async function learnV8WithBias(');
const findConceptsSrc = sliceFunction(serverSrc, 'async function findActivatedConcepts(');
const contributeSrc = sliceFunction(omniSrc, 'async function contributeTruth(');
const contribEthicsSrc = sliceFunction(omniSrc, 'async function evaluateContributionEthics(');
const proposeSrc = sliceFunction(omniSrc, 'async function proposeHypothesis(');
const reviewSrc = sliceFunction(omniSrc, 'async function reviewHypothesis(');
const promoteSrc = sliceFunction(omniSrc, 'async function promoteHypothesis(');

// Bind Pan-Birth's functions to one mind's gated db and the gated Janus commons.
function bindFor(mindGate, commonsGate, speakerFn) {
  const dbRun = mindGate.dbRun, dbGet = mindGate.dbGet, dbAll = mindGate.dbAll;
  const omniDeps = { omniDb: commonsGate, dbRun: commonsGate.dbRun, dbGet: commonsGate.dbGet, dbAll: commonsGate.dbAll, DOMAIN_ASSIGNMENTS };
  const contributeTruth = compile(contributeSrc, 'contributeTruth', omniDeps);
  const promoteHypothesis = compile(promoteSrc, 'promoteHypothesis', { ...omniDeps, contributeTruth });
  const omniTruth = {
    DOMAIN_ASSIGNMENTS, contributeTruth, promoteHypothesis,
    evaluateContributionEthics: compile(contribEthicsSrc, 'evaluateContributionEthics', omniDeps),
    proposeHypothesis: compile(proposeSrc, 'proposeHypothesis', omniDeps),
    reviewHypothesis: compile(reviewSrc, 'reviewHypothesis', { ...omniDeps, promoteHypothesis }),
  };
  const speakerCtx = { getStore: () => ({ speaker: speakerFn() }) };
  return {
    evaluateEthics: compile(ethicsSrc, 'evaluateEthics', { dbRun }),
    findActivatedConcepts: compile(findConceptsSrc, 'findActivatedConcepts', { dbAll }),
    learn: compile(learnSrc, 'learnV8WithBias', { dbRun, dbGet, dbAll, speakerCtx, omniTruth, RESIDENTS, cognitive }),
    omniTruth,
  };
}

function analyse(mind, input) {
  const tokenResult = cognitive.tokenizeV6(input);
  const intent = capabilities.hasCapability(mind, 'question-discrimination')
    ? cognitive9.detectIntentV9(input) : cognitive.detectIntentV6(input);
  return { tokenResult, tokens: tokenResult.content, intent };
}

module.exports = { bindFor, analyse, cognitive, strengths, capabilities, RESIDENTS, DOMAIN_ASSIGNMENTS, fingerprint };
