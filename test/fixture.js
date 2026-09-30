'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

// Mirrors the tables the extension reads from ~/.copilot/session-store.db.
const SCHEMA = `
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  cwd TEXT,
  repository TEXT,
  host_type TEXT,
  branch TEXT,
  summary TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE assistant_usage_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  turn_index INTEGER,
  agent_id TEXT,
  parent_tool_call_id TEXT,
  model TEXT NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cache_read_tokens INTEGER,
  cache_write_tokens INTEGER,
  reasoning_tokens INTEGER,
  total_nano_aiu INTEGER,
  request_multiplier REAL,
  duration_ms INTEGER,
  time_to_first_token_ms INTEGER,
  inter_token_latency_ms INTEGER,
  initiator TEXT,
  api_endpoint TEXT,
  reasoning_effort TEXT,
  finish_reason TEXT,
  content_filter_triggered INTEGER,
  token_details_json TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  output_ttft_ms REAL,
  copilot_usage_model TEXT
);`;

function tokenDetails({ fresh, cacheRead, cacheWrite, output }, model) {
  return JSON.stringify([
    { batchSize: 1000000, costPerBatch: 400000000000, tokenCount: fresh, tokenType: 'input', model },
    { batchSize: 1000000, costPerBatch: 20000000000, tokenCount: cacheRead, tokenType: 'cache_read', model },
    { batchSize: 1000000, costPerBatch: 500000000000, tokenCount: cacheWrite, tokenType: 'cache_write', model },
    { batchSize: 1000000, costPerBatch: 2000000000000, tokenCount: output, tokenType: 'output', model },
  ]);
}

function createFixtureDb({ wal = true, withUsageTable = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'token-meter-'));
  const dbPath = path.join(dir, 'session-store.db');
  const db = new DatabaseSync(dbPath);
  if (wal) {
    db.exec('PRAGMA journal_mode = WAL;');
  }
  db.exec(withUsageTable ? SCHEMA : SCHEMA.split('CREATE TABLE assistant_usage_events')[0]);

  const insertSession = db.prepare('INSERT INTO sessions (id, cwd, summary, created_at) VALUES (?, ?, ?, ?)');
  const insertUsage = withUsageTable ? db.prepare(`INSERT INTO assistant_usage_events
    (session_id, turn_index, agent_id, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
     reasoning_tokens, total_nano_aiu, duration_ms, time_to_first_token_ms, initiator, finish_reason,
     reasoning_effort, token_details_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`) : null;

  let open = true;
  return {
    dir,
    dbPath,
    db,
    addSession(id, { cwd = null, summary = null, createdAt = '2026-09-29T10:00:00.000Z' } = {}) {
      insertSession.run(id, cwd, summary, createdAt);
    },
    /** Inserts a model call; `input` is the total prompt size including cache reads/writes. */
    addUsage({
      sessionId,
      turnIndex = 0,
      agentId = null,
      model = 'claude-opus-5.5',
      input = 100,
      cacheRead = 0,
      cacheWrite = 0,
      output = 10,
      reasoning = 0,
      nanoAiu = 1e9,
      durationMs = 1000,
      ttftMs = 500,
      initiator = 'agent',
      finishReason = 'stop',
      reasoningEffort = null,
      withDetails = true,
      createdAt = '2026-09-29T12:00:00.000Z',
    }) {
      const fresh = input - cacheRead - cacheWrite;
      const details = withDetails ? tokenDetails({ fresh, cacheRead, cacheWrite, output }, model) : null;
      const result = insertUsage.run(sessionId, turnIndex, agentId, model, input, output, cacheRead, cacheWrite,
        reasoning, nanoAiu, durationMs, ttftMs, initiator, finishReason, reasoningEffort, details, createdAt);
      return Number(result.lastInsertRowid);
    },
    close() {
      if (open) {
        open = false;
        db.close();
      }
    },
    cleanup() {
      this.close();
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    },
  };
}

module.exports = { createFixtureDb };
