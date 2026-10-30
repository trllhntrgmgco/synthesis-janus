// Runs a scripted session against one mind in one condition, so all four conditions get
// identical inputs (spec "Experiment protocol"). Script: JSON lines, one turn each:
//   {"input": "..."}                 a normal turn
//   {"report": true}                 ask what the rendered face is expressing (frame attached)
//   {"decoy": "zen"}                 next face shown is ZEN's (decoy trial)
//   {"wait": 2500}                   pause, e.g. for the camera to capture
// Usage: node scripts/run.js <script.jsonl> <mind> <janus|claude_loop|plain_claude|native> [session]
const fs = require('fs');
const [file, mind, condition = 'janus', session = `run-${Date.now()}`] = process.argv.slice(2);
if (!file || !mind) { console.error('usage: node scripts/run.js <script.jsonl> <mind> <condition> [session]'); process.exit(1); }
const JANUS = `http://localhost:${process.env.JANUS_PORT || 3012}`;
const NATIVE = process.env.PANBIRTH_URL || 'http://localhost:3002';
const post = (url, b) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json());
(async () => {
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(l => l.trim() && !l.trim().startsWith('//')).map(l => JSON.parse(l));
  const out = [];
  for (const step of lines) {
    if (step.wait) { await new Promise(r => setTimeout(r, step.wait)); continue; }
    if (step.decoy) { await post(`${JANUS}/api/janus/${mind}/decoy?condition=${condition}`, { other: step.decoy }); continue; }
    let r;
    if (condition === 'native') {
      if (step.report) { out.push({ step, skipped: 'native minds have taught vision only; no face loop' }); continue; }
      r = await post(`${NATIVE}/api/${mind}/think`, { input: step.input, sessionId: session });
    } else {
      r = await post(`${JANUS}/api/janus/${mind}/turn`, { input: step.input, report: !!step.report, sessionId: session, condition, speaker: step.speaker || 'user' });
    }
    out.push({ step, result: r });
    console.log(`[${condition}/${mind}] ${step.report ? '(face?)' : (step.input || '').slice(0, 50)} -> ${r.outcome || ''} ${(r.reply || r.response || r.error || '').toString().slice(0, 80).replace(/\n/g, ' ')}`);
  }
  const dir = `runs`; fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(`${dir}/${session}_${condition}_${mind}.json`, JSON.stringify(out, null, 1));
  console.log(`saved runs/${session}_${condition}_${mind}.json`);
})();
