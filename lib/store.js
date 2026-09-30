'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_DB_PATH = path.join(os.homedir(), '.copilot', 'session-store.db');

const USAGE_SELECT = `SELECT id, session_id, turn_index, agent_id, model, initiator,
    input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens,
    total_nano_aiu, duration_ms, time_to_first_token_ms, finish_reason, reasoning_effort,
    token_details_json, created_at
  FROM assistant_usage_events`;

class StoreNotFoundError extends Error {
  constructor(dbPath) {
    super(`Copilot session store not found at ${dbPath}`);
    this.name = 'StoreNotFoundError';
    this.dbPath = dbPath;
  }
}

let sqliteModule;
let sqliteLoadError;

function loadSqlite() {
  if (sqliteModule === undefined) {
    try {
      sqliteModule = require('node:sqlite');
    } catch (err) {
      sqliteModule = null;
      sqliteLoadError = err;
    }
  }
  if (!sqliteModule) {
    const reason = sqliteLoadError ? sqliteLoadError.message : 'unknown error';
    throw new Error(`The built-in node:sqlite module is not available in this VS Code runtime (Node ${process.versions.node}): ${reason}`);
  }
  return sqliteModule;
}

function resolveDbPath(configured) {
  const value = typeof configured === 'string' ? configured.trim() : '';
  if (!value) {
    return DEFAULT_DB_PATH;
  }
  if (value === '~') {
    return os.homedir();
  }
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    return path.join(os.homedir(), value.slice(2));
  }
  return path.resolve(value);
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

// SQLite's datetime('now') default has no zone designator but is UTC.
function parseTimestamp(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return 0;
  }
  let text = value.trim();
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(text)) {
    text = `${text.replace(' ', 'T')}Z`;
  }
  const ts = Date.parse(text);
  return Number.isFinite(ts) ? ts : 0;
}

// token_details_json is the per-call billing breakdown. It is more reliable than the flat
// columns: compaction calls, for example, bill cache writes but leave cache_write_tokens at 0.
function parseTokenDetails(json) {
  if (typeof json !== 'string' || json.length === 0) {
    return null;
  }
  let entries;
  try {
    entries = JSON.parse(json);
  } catch {
    return null;
  }
  if (!Array.isArray(entries)) {
    return null;
  }
  const totals = Object.create(null);
  for (const entry of entries) {
    if (entry && typeof entry.tokenType === 'string') {
      totals[entry.tokenType] = (totals[entry.tokenType] || 0) + toNumber(entry.tokenCount);
    }
  }
  return totals;
}

function normaliseUsageRow(raw) {
  const details = parseTokenDetails(raw.token_details_json) || Object.create(null);
  const cacheRead = 'cache_read' in details ? details.cache_read : toNumber(raw.cache_read_tokens);
  const cacheWrite = 'cache_write' in details ? details.cache_write : toNumber(raw.cache_write_tokens);
  const fresh = 'input' in details
    ? details.input
    : Math.max(0, toNumber(raw.input_tokens) - cacheRead - cacheWrite);
  const output = 'output' in details ? details.output : toNumber(raw.output_tokens);
  return {
    id: toNumber(raw.id),
    sessionId: String(raw.session_id),
    turnIndex: raw.turn_index === null || raw.turn_index === undefined ? null : toNumber(raw.turn_index),
    agentId: raw.agent_id || null,
    model: raw.model || 'unknown',
    initiator: raw.initiator || null,
    fresh,
    cacheRead,
    cacheWrite,
    input: fresh + cacheRead + cacheWrite,
    output,
    reasoning: toNumber(raw.reasoning_tokens),
    nanoAiu: toNumber(raw.total_nano_aiu),
    durationMs: toNumber(raw.duration_ms),
    ttftMs: toNumber(raw.time_to_first_token_ms),
    finishReason: raw.finish_reason || null,
    reasoningEffort: raw.reasoning_effort || null,
    ts: parseTimestamp(raw.created_at),
  };
}

function normaliseSession(raw) {
  return {
    id: String(raw.id),
    cwd: raw.cwd || null,
    repository: raw.repository || null,
    branch: raw.branch || null,
    summary: raw.summary || null,
    createdAt: parseTimestamp(raw.created_at),
  };
}

function friendlyError(err) {
  const message = err && err.message ? err.message : String(err);
  if (/no such table: assistant_usage_events/i.test(message)) {
    return new Error('This Copilot session store has no usage table yet. Update the Copilot CLI / agent host and run a session.');
  }
  return err instanceof Error ? err : new Error(message);
}

class UsageStore {
  constructor(dbPath = DEFAULT_DB_PATH) {
    this.dbPath = dbPath;
    this.rows = [];
    this.sessions = new Map();
    this.maxId = 0;
    this.error = null;
  }

  setPath(dbPath) {
    if (dbPath !== this.dbPath) {
      this.dbPath = dbPath;
      this.reset();
    }
  }

  reset() {
    this.rows = [];
    this.sessions = new Map();
    this.maxId = 0;
  }

  /** Reads new model calls from the store. Returns true when the data or error state changed. */
  sync() {
    const previousError = this.error ? this.error.message : null;
    let changed = false;
    try {
      changed = this._sync();
      this.error = null;
    } catch (err) {
      this.error = friendlyError(err);
      if (this.rows.length > 0 || this.sessions.size > 0) {
        this.reset();
        changed = true;
      }
    }
    const currentError = this.error ? this.error.message : null;
    return changed || previousError !== currentError;
  }

  _sync() {
    if (!fs.existsSync(this.dbPath)) {
      throw new StoreNotFoundError(this.dbPath);
    }
    const { DatabaseSync } = loadSqlite();
    const db = new DatabaseSync(this.dbPath, { readOnly: true, timeout: 1000 });
    try {
      const head = db.prepare('SELECT COUNT(*) AS n, MAX(id) AS maxId FROM assistant_usage_events').get();
      const count = toNumber(head.n);
      const maxId = toNumber(head.maxId);
      if (count === this.rows.length && maxId === this.maxId) {
        return false;
      }

      let rows = this.rows;
      if (maxId > this.maxId) {
        const added = db.prepare(`${USAGE_SELECT} WHERE id > ? ORDER BY id`).all(this.maxId);
        rows = rows.concat(added.map(normaliseUsageRow));
      }
      if (rows.length !== count) {
        // Rows were removed (e.g. a deleted session), so incremental loading is no longer valid.
        rows = db.prepare(`${USAGE_SELECT} ORDER BY id`).all().map(normaliseUsageRow);
      }

      this.rows = rows;
      this.maxId = maxId;
      this.sessions = readSessions(db);
      return true;
    } finally {
      db.close();
    }
  }
}

function readSessions(db) {
  const sessions = new Map();
  try {
    for (const raw of db.prepare('SELECT id, cwd, repository, branch, summary, created_at FROM sessions').all()) {
      const session = normaliseSession(raw);
      sessions.set(session.id, session);
    }
  } catch {
    // Session metadata is optional; usage rows are still meaningful without titles.
  }
  return sessions;
}

module.exports = {
  DEFAULT_DB_PATH,
  StoreNotFoundError,
  UsageStore,
  normaliseUsageRow,
  parseTimestamp,
  parseTokenDetails,
  resolveDbPath,
};
