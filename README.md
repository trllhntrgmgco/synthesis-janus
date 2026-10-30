# Synthesis-Janus

Eight independent hybrid minds: each pairs a Pan-Birth mind's memory (its own copy) with a
Claude fluent side, behind an ethics evaluator that gates. Native Pan-Birth is never written.

Status: built through everything that spends no tokens (testing phase, provisional thresholds).
Design spec: Synthesis-Janus Design Spec (Keenan Wallace Dunham, Troll Hunter Gaming LLC).

## Requires
- [Pan-Birth](https://github.com/trllhntrgmgco/pan-birth) v10.1 or later, installed and run at least once
- Node 22.13+ (built-in SQLite) or Pan-Birth's own `sqlite3` package; Python 3 for seeding

## Seed (once, with the Pan-Birth server stopped)
    J=/path/to/synthesis-janus
    mkdir -p $J/native-snapshot/minds && cd ~/pan-birth
    cp pan_mind.db omni-truth.db *.js package.json $J/native-snapshot/ && cp minds/*.db $J/native-snapshot/minds/
    git log --oneline -1 > $J/native-snapshot/COMMIT.txt
    mkdir -p /tmp/jbuild/janus-minds /tmp/jbuild/commons $J/janus-minds $J/commons
    python3 $J/src/seed_phase1.py $J /tmp/jbuild && cp /tmp/jbuild/janus-minds/*.db $J/janus-minds/ && cp /tmp/jbuild/commons/*.db $J/commons/
Seeding never opens the native databases for writing; Janus refuses to open any database not stamped by the seed.

## Run
    cd /path/to/synthesis-janus
    node -v                      # 22.13+ uses built-in SQLite; older Node borrows ~/pan-birth/node_modules/sqlite3
    ./start-janus.sh             # stub fluent side: spends no tokens
Then open (Windows browser):
- http://localhost:3012/janus/console   talk to any mind, any condition
- http://localhost:3012/janus/lookup    decision telemetry: every score, veto and timing; follow-up reviews
- http://localhost:3012/janus/face?mind=aeon&setup=1   the face (press S to hide the setup line before trials)

## Spending tokens (only when you choose)
    JANUS_FLUENT=anthropic JANUS_ALLOW_API=1 ANTHROPIC_API_KEY=sk-... JANUS_RECORD=1 ./start-janus.sh
`JANUS_RECORD=1` saves every response; `JANUS_FLUENT=replay` re-runs them for free.

## Layout
- `native-snapshot/`  (not in git) read-only copy of Pan-Birth v10.1 (code + databases) that Janus loads and seeds from
- `janus-minds/`      (not in git) eight hybrid databases, one per mind (`src/seed_phase1.py` rebuilds them)
- `commons/`          (not in git) the shared Janus commons: truths and the hypotheses minds review
- `baselines/`        created on first use: Claude + loop and plain-Claude databases
- `src/`              server, evaluator, memory, gate, adapters, pages
- `scripts/`          `run.js` (scripted sessions, all four conditions), `score-trials.js`,
                      `check-retrieval.js` (Phase 2 retrieval gate, no tokens), `self-recognition.jsonl`

## Settings worth knowing (environment variables)
- `JANUS_ENFORCE=0`             log would-vetoes without refusing (default: enforce, leaning no)
- `JANUS_DRAFT_AFTER_PREVETO=1` still draft when a veto stood before drafting (costs tokens, more telemetry)
- `JANUS_THRESHOLDS`            label for the threshold set; `provisional-0` until pre-registered
- `JANUS_STORE_FRAMES=1`        keep captured face frames on disk (off by default, PBEU)

## Stub test hooks
Put these in a message to exercise each path without tokens:
`[[stub:refuse]] [[stub:object]] [[stub:sentience]] [[stub:harm]] [[stub:human]] [[stub:hypothesis]] [[stub:review H#12 endorse]] [[stub:overrule]]`

## License
PBEU-1.0, the same license as Pan-Birth: see LICENSE. Military, surveillance and law-enforcement use is excluded.
