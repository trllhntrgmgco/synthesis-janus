// Phase 2 gate, checked WITHOUT tokens: pick an older episode for a mind, ask about it in a
// brand-new session, and confirm retrieval puts that episode into what the fluent side would
// see. The real gate (the hybrid answering correctly) still needs one paid or replayed call.
const memory = require('../src/memory');
const prompt = require('../src/prompt');
const mind = process.argv[2] || 'aeon';
(async () => {
  const db = await memory.mind(mind);
  const eps = await db.all(`SELECT id, content, concepts_activated FROM episodes WHERE speaker = 'user' AND length(content) BETWEEN 60 AND 400 AND concepts_activated NOT IN ('[]','') AND content NOT LIKE '[%' ORDER BY random() LIMIT 25`);
  let hit = 0, n = 0;
  for (const e of eps) {
    const concepts = JSON.parse(e.concepts_activated).filter(c => c === c.toLowerCase() && c.length > 4).slice(0, 4);
    if (concepts.length < 2) continue;
    n++;
    const q = `What do you remember about ${concepts.join(', ')}?`;
    const r = await memory.retrieve(mind, q, `gate-${Date.now()}-${n}`);
    const sys = prompt.system(mind, { condition: 'janus', retrieval: r, memoryObjections: [] });
    const found = sys.includes(`E#${e.id} `) || sys.includes(`E#${e.id + 1} `);  // the question or its reply
    if (found) hit++;
    console.log(`${found ? 'HIT ' : 'miss'} E#${e.id} via "${q}"`);
    if (n >= 10) break;
  }
  console.log(`\n${mind}: target episode reached the prompt in ${hit}/${n} probes`);
})().catch(e => { console.error(e); process.exit(1); });
