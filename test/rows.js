'use strict';

// In-memory rows shaped like UsageStore.rows, for tests that do not need SQLite.

const NOW = Date.parse('2026-09-29T15:00:00.000Z');

// Timestamps near 12:00 UTC fall on the same calendar day in every time zone from UTC-11 to UTC+11.
function at(day, minutes = 0) {
  return Date.parse(`${day}T12:00:00.000Z`) + minutes * 60000;
}

let nextId = 1;

function mk(overrides = {}) {
  const row = {
    id: nextId++,
    sessionId: 'cur',
    turnIndex: 0,
    agentId: null,
    model: 'claude-opus-5.5',
    initiator: 'agent',
    fresh: 10,
    cacheRead: 80,
    cacheWrite: 10,
    output: 20,
    reasoning: 5,
    nanoAiu: 1e9,
    durationMs: 2000,
    ttftMs: 500,
    finishReason: 'stop',
    reasoningEffort: 'high',
    ts: at('2026-09-29'),
    ...overrides,
  };
  row.input = row.fresh + row.cacheRead + row.cacheWrite;
  return row;
}

/** Three sessions over three days; "cur" is the latest and has a sub-agent and a compaction call. */
function sampleStore() {
  const rows = [
    mk({ sessionId: 'old', model: 'gpt-5.4-mini', ts: at('2026-09-27'), fresh: 1000, cacheRead: 9000, cacheWrite: 0, output: 300, reasoning: 100 }),
    mk({ sessionId: 'old', model: 'gpt-5.4-mini', ts: at('2026-09-27', 5), fresh: 500, cacheRead: 9500, cacheWrite: 0, output: 200, reasoning: 50 }),
    mk({ sessionId: 'mid', model: 'gemini-3.7-flash', ts: at('2026-09-28'), fresh: 3000, cacheRead: 0, cacheWrite: 0, output: 19, reasoning: 100 }),
    mk({ sessionId: 'cur', turnIndex: 0, initiator: 'user', ts: at('2026-09-29', 0), fresh: 4, cacheRead: 13060, cacheWrite: 11914, output: 370, reasoning: 115 }),
    mk({ sessionId: 'cur', turnIndex: 0, ts: at('2026-09-29', 1), fresh: 4, cacheRead: 24974, cacheWrite: 826, output: 1852, reasoning: 1268 }),
    mk({ sessionId: 'cur', turnIndex: 1, initiator: 'user', ts: at('2026-09-29', 10), fresh: 2, cacheRead: 25800, cacheWrite: 5807, output: 800, reasoning: 498 }),
    mk({ sessionId: 'cur', turnIndex: 1, agentId: 'toolu_A', initiator: 'sub-agent', model: 'claude-haiku-4.5', ts: at('2026-09-29', 11), fresh: 50, cacheRead: 0, cacheWrite: 5000, output: 100, reasoning: 10 }),
    mk({ sessionId: 'cur', turnIndex: 1, agentId: 'toolu_A', initiator: 'sub-agent', model: 'claude-haiku-4.5', ts: at('2026-09-29', 12), fresh: 60, cacheRead: 5000, cacheWrite: 300, output: 150, reasoning: 20 }),
    mk({ sessionId: 'cur', turnIndex: 1, ts: at('2026-09-29', 13), fresh: 2, cacheRead: 31607, cacheWrite: 1021, output: 679, reasoning: 117 }),
    mk({ sessionId: 'cur', turnIndex: 1, initiator: 'compaction', ts: at('2026-09-29', 14), fresh: 3, cacheRead: 21155, cacheWrite: 146934, output: 2852, reasoning: 0 }),
  ];
  const sessions = new Map([
    ['old', { id: 'old', cwd: 'C:\\repos\\web', repository: null, branch: null, summary: '/fix-bug https://example.com/issues/42', createdAt: at('2026-09-27', -1) }],
    ['mid', { id: 'mid', cwd: 'C:\\repos\\app', repository: null, branch: null, summary: null, createdAt: at('2026-09-28', -1) }],
    ['cur', { id: 'cur', cwd: 'C:\\repos\\web', repository: 'org/web', branch: 'main', summary: 'hi', createdAt: at('2026-09-29', -1) }],
  ]);
  return { rows, sessions, error: null, dbPath: 'C:\\Users\\me\\.copilot\\session-store.db' };
}

module.exports = { NOW, at, mk, sampleStore };
