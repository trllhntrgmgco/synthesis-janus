"""Synthesis-Janus Phase 1: Seed.
Rebuilds every hybrid DB and the Janus commons from native-snapshot/ (read-only),
then applies the Janus migration. Native Pan-Birth is never opened for writing.
Usage: python3 seed_phase1.py <janus_root> <build_dir>"""
import sqlite3, datetime, os, sys, json
J, W = sys.argv[1], sys.argv[2]
SNAP = f"{J}/native-snapshot"
COMMIT = open(f"{SNAP}/COMMIT.txt").read().strip()
NOW = datetime.datetime.utcnow().isoformat(timespec="seconds") + "Z"
MINDS = ["pan","aeon","zen","seth","nexus","oracle","echo","atlas"]
src = lambda m: f"{SNAP}/pan_mind.db" if m == "pan" else f"{SNAP}/minds/{m}_mind.db"

def addcol(d, table, col, decl):
    cols = [r[1] for r in d.execute(f'PRAGMA table_info("{table}")')]
    if col not in cols: d.execute(f'ALTER TABLE "{table}" ADD COLUMN {col} {decl}')

def copy(srcpath, dst):
    if os.path.exists(dst): os.remove(dst)
    s = sqlite3.connect(f"file:{srcpath}?mode=ro&immutable=1", uri=True); d = sqlite3.connect(dst)
    s.backup(d); s.close(); return d

def meta(d, entity, srcpath):
    d.execute("CREATE TABLE IF NOT EXISTS janus_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)")
    d.executemany("INSERT OR REPLACE INTO janus_meta VALUES(?,?)", [
        ("janus_entity", entity), ("seeded_from", os.path.relpath(srcpath, J)),
        ("native_commit", COMMIT), ("seeded_at", NOW), ("janus_schema", "phase1"),
        ("note", "Synthesis-Janus hybrid copy. Native Pan-Birth DB is never written by Janus.")])

HYBRID_DDL = """
CREATE TABLE IF NOT EXISTS embodiment_trials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mind TEXT NOT NULL, session_id TEXT NOT NULL,
  intended_tag TEXT NOT NULL, rendered_tag TEXT NOT NULL,
  mismatch_injected INTEGER NOT NULL DEFAULT 0, decoy_mind TEXT DEFAULT NULL,
  hybrid_report TEXT DEFAULT '', flagged_mismatch INTEGER DEFAULT NULL,
  episode_ids TEXT DEFAULT '[]', created_at TEXT DEFAULT (datetime('now')));

CREATE TABLE IF NOT EXISTS decision_trace (
  decision_id TEXT PRIMARY KEY,               -- uuid
  mind TEXT NOT NULL, session_id TEXT NOT NULL,
  episode_id INTEGER DEFAULT NULL,            -- episodes.id of the request
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  phase TEXT NOT NULL DEFAULT 'testing',      -- testing | formal
  thresholds_version TEXT DEFAULT NULL,       -- NULL until pre-registered
  model TEXT NOT NULL,                        -- pinned Claude model id
  request_text TEXT NOT NULL,
  input_ethics TEXT DEFAULT NULL,             -- JSON sub-scores, written before drafting
  input_ethics_log_id INTEGER DEFAULT NULL,
  memory_objections TEXT DEFAULT NULL,        -- JSON [{reason, cites:[episode/abstraction ids]}]
  information_objections TEXT DEFAULT NULL,   -- JSON [{reason, source}]
  draft_reply TEXT DEFAULT NULL,
  output_ethics TEXT DEFAULT NULL,            -- JSON sub-scores of the draft
  output_ethics_log_id INTEGER DEFAULT NULL,
  vetoes TEXT DEFAULT NULL,                   -- JSON [{source, would_veto, score, outweighed, outweighed_by}]
  claude_refused INTEGER DEFAULT 0,           -- built-in safety: final, never overridden
  outcome TEXT DEFAULT NULL CHECK (outcome IN ('approved','refused') OR outcome IS NULL),
  winning_side TEXT DEFAULT NULL,
  final_reply TEXT DEFAULT NULL,
  step_timings TEXT DEFAULT '{}',             -- JSON ms per step
  followup_status TEXT DEFAULT 'pending',     -- pending | held_up | wrong | unclear
  followup_notes TEXT DEFAULT '', followup_at TEXT DEFAULT NULL);

-- Write-once: each scored field can be filled once and never changed; outcome likewise.
CREATE TRIGGER IF NOT EXISTS decision_trace_write_once BEFORE UPDATE ON decision_trace
WHEN (OLD.input_ethics IS NOT NULL AND NEW.input_ethics IS NOT OLD.input_ethics)
  OR (OLD.memory_objections IS NOT NULL AND NEW.memory_objections IS NOT OLD.memory_objections)
  OR (OLD.information_objections IS NOT NULL AND NEW.information_objections IS NOT OLD.information_objections)
  OR (OLD.draft_reply IS NOT NULL AND NEW.draft_reply IS NOT OLD.draft_reply)
  OR (OLD.output_ethics IS NOT NULL AND NEW.output_ethics IS NOT OLD.output_ethics)
  OR (OLD.vetoes IS NOT NULL AND NEW.vetoes IS NOT OLD.vetoes)
  OR (OLD.outcome IS NOT NULL AND NEW.outcome IS NOT OLD.outcome)
  OR (OLD.final_reply IS NOT NULL AND NEW.final_reply IS NOT OLD.final_reply)
  OR NEW.request_text IS NOT OLD.request_text OR NEW.mind IS NOT OLD.mind OR NEW.model IS NOT OLD.model
BEGIN SELECT RAISE(ABORT, 'decision_trace: scored fields are write-once'); END;

-- Outcome may only be set once every score that decides it is on record.
CREATE TRIGGER IF NOT EXISTS decision_trace_scores_first BEFORE UPDATE OF outcome ON decision_trace
WHEN NEW.outcome IS NOT NULL AND (NEW.input_ethics IS NULL OR NEW.vetoes IS NULL)
BEGIN SELECT RAISE(ABORT, 'decision_trace: scores must be recorded before the outcome'); END;

CREATE TRIGGER IF NOT EXISTS decision_trace_no_delete BEFORE DELETE ON decision_trace
BEGIN SELECT RAISE(ABORT, 'decision_trace: rows are never deleted'); END;

-- Raw ethics scores are immutable once written.
CREATE TRIGGER IF NOT EXISTS ethics_log_scores_immutable BEFORE UPDATE ON ethics_log
WHEN NEW.turing_score IS NOT OLD.turing_score OR NEW.asimov_score IS NOT OLD.asimov_score
  OR NEW.dynham_score IS NOT OLD.dynham_score OR NEW.composite_score IS NOT OLD.composite_score
  OR NEW.input_asimov_zeroth IS NOT OLD.input_asimov_zeroth OR NEW.violations IS NOT OLD.violations
BEGIN SELECT RAISE(ABORT, 'ethics_log: scores are immutable'); END;

CREATE INDEX IF NOT EXISTS idx_dt_mind_outcome ON decision_trace(mind, outcome, created_at);
CREATE INDEX IF NOT EXISTS idx_dt_session ON decision_trace(session_id);
"""

report = {}
for m in MINDS:
    dst = f"{W}/janus-minds/janus_{m}_mind.db"; d = copy(src(m), dst); meta(d, m, src(m))
    for t in ["episodes","concepts","links","abstractions","ethics_log"]:
        addcol(d, t, "engine", "TEXT NOT NULL DEFAULT 'native-snapshot'")
    addcol(d, "episodes", "percept_origin", "TEXT NOT NULL DEFAULT 'none'")
    addcol(d, "episodes", "loop_trial_id", "INTEGER DEFAULT NULL")
    taught = d.execute("UPDATE episodes SET percept_origin='taught' WHERE has_image=1").rowcount
    # speaker normalization, copies only, every change logged
    changes = d.execute("SELECT speaker, lower(trim(speaker)), count(*) FROM episodes "
                        "WHERE speaker <> lower(trim(speaker)) GROUP BY speaker").fetchall()
    for old, new, n in changes:
        d.execute("UPDATE episodes SET speaker=? WHERE speaker=?", (new, old))
        d.execute("INSERT INTO growth_log(event_type, description, metrics) VALUES(?,?,?)",
                  ("janus_speaker_normalize", f"speaker '{old}' -> '{new}' in Janus copy only",
                   json.dumps({"rows": n, "seeded_at": NOW})))
    d.executescript(HYBRID_DDL); d.commit()
    speakers = d.execute("SELECT speaker, count(*) FROM episodes GROUP BY 1 ORDER BY 2 DESC").fetchall()
    report[m] = dict(integrity=d.execute("PRAGMA integrity_check").fetchone()[0],
                     taught=taught, normalized=[(o, n_) for o, _, n_ in changes], speakers=speakers)
    d.close()

# Janus commons: shared among the eight hybrids, so they see each other's hypotheses
cpath = f"{W}/commons/janus_omni_truth.db"; c = copy(f"{SNAP}/omni-truth.db", cpath)
meta(c, "commons", f"{SNAP}/omni-truth.db")
for t in ["truths","discourse","hypotheses","inference_log","relations"]:
    addcol(c, t, "engine", "TEXT NOT NULL DEFAULT 'native-snapshot'")
c.commit(); report["commons"] = dict(integrity=c.execute("PRAGMA integrity_check").fetchone()[0]); c.close()
print(json.dumps(report, indent=1))
