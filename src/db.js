// Thin async SQLite layer with the same dbRun/dbGet/dbAll shape Pan-Birth's code expects.
// Uses Node's built-in node:sqlite (Node >= 22.13); falls back to the sqlite3 package
// from Pan-Birth's own node_modules.
const path = require('path');
const fs = require('fs');
const config = require('./config');

let DatabaseSync = null;
try { ({ DatabaseSync } = require('node:sqlite')); } catch { /* fall back */ }

const clean = (params = []) => params.map(v => v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);

function openRaw(file) {
  if (!fs.existsSync(file)) throw new Error(`database not found: ${file}`);
  if (DatabaseSync) {
    const d = new DatabaseSync(file);
    d.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = OFF;');
    return {
      file,
      run: async (sql, p) => { const r = d.prepare(sql).run(...clean(p)); return { lastID: Number(r.lastInsertRowid), changes: Number(r.changes) }; },
      get: async (sql, p) => d.prepare(sql).get(...clean(p)),
      all: async (sql, p) => d.prepare(sql).all(...clean(p)),
      exec: async (sql) => d.exec(sql),
      close: () => d.close(),
    };
  }
  // Older Node: borrow the sqlite3 package Pan-Birth already installed.
  const candidates = [process.env.PANBIRTH_MODULES, path.join(config.PANBIRTH_SRC, 'node_modules'),
    path.join(require('os').homedir(), 'pan-birth', 'node_modules')].filter(Boolean);
  const dir = candidates.find(d => fs.existsSync(path.join(d, 'sqlite3')));
  if (!dir) throw new Error('Need Node >= 22.13 (built-in node:sqlite) or Pan-Birth\'s sqlite3 package (set PANBIRTH_MODULES)');
  const sqlite3 = require(path.join(dir, 'sqlite3'));
  const d = new sqlite3.Database(file);
  const P = (fn) => new Promise((res, rej) => fn(res, rej));
  return {
    file,
    run: (sql, p) => P((res, rej) => d.run(sql, clean(p), function (e) { e ? rej(e) : res({ lastID: this.lastID, changes: this.changes }); })),
    get: (sql, p) => P((res, rej) => d.get(sql, clean(p), (e, r) => e ? rej(e) : res(r))),
    all: (sql, p) => P((res, rej) => d.all(sql, clean(p), (e, r) => e ? rej(e) : res(r || []))),
    exec: (sql) => P((res, rej) => d.exec(sql, e => e ? rej(e) : res())),
    close: () => d.close(),
  };
}

// Refuses anything that is not a Janus copy, so a native Pan-Birth database can never be opened here.
async function openJanus(file) {
  const db = openRaw(file);
  const t = await db.get(`SELECT name FROM sqlite_master WHERE type='table' AND name='janus_meta'`);
  const m = t && await db.get(`SELECT value FROM janus_meta WHERE key='janus_entity'`);
  if (!m) { db.close(); throw new Error(`refusing to open ${file}: not a Synthesis-Janus database (no janus_meta)`); }
  db.entity = m.value;
  return db;
}

// Create an empty database file (an empty file is a valid SQLite database).
function createFile(file) { fs.mkdirSync(path.dirname(file), { recursive: true }); if (!fs.existsSync(file)) fs.writeFileSync(file, ''); }

module.exports = { openRaw, openJanus, createFile, usingBuiltin: !!DatabaseSync };
