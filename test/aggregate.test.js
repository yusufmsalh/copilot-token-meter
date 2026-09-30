'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const agg = require('../lib/aggregate');
const { NOW, at, mk, sampleStore } = require('./rows');

test('summarise adds up tokens, credits, durations and the time range', () => {
  const t1 = at('2026-09-29', 0);
  const t2 = at('2026-09-29', 1);
  const totals = agg.summarise([
    mk({ fresh: 4, cacheRead: 13060, cacheWrite: 11914, output: 370, reasoning: 115, nanoAiu: 6959800000, durationMs: 5998, ttftMs: 4965, ts: t2 }),
    mk({ fresh: 4, cacheRead: 24974, cacheWrite: 826, output: 1852, reasoning: 1268, nanoAiu: 4618080000, durationMs: 17726, ttftMs: 0, ts: t1 }),
  ]);
  assert.deepEqual(totals, {
    calls: 2,
    input: 50782,
    fresh: 8,
    cacheRead: 38034,
    cacheWrite: 12740,
    output: 2222,
    reasoning: 1383,
    nanoAiu: 11577880000,
    durationMs: 23724,
    ttftMs: 4965,
    ttftCalls: 1,
    firstTs: t1,
    lastTs: t2,
  });
});

test('summarise of no rows is all zeros', () => {
  assert.deepEqual(agg.summarise([]), agg.emptyTotals());
});

test('latestSessionId picks the session with the newest call and breaks ties by id', () => {
  const t = at('2026-09-29');
  assert.equal(agg.latestSessionId([]), null);
  assert.equal(agg.latestSessionId([
    mk({ id: 100, sessionId: 'a', ts: t }),
    mk({ id: 101, sessionId: 'b', ts: t - 1000 }),
    mk({ id: 102, sessionId: 'c', ts: t }),
  ]), 'c');
});

test('periodStart covers today plus the previous local calendar days', () => {
  assert.equal(agg.periodStart(0, NOW), 0);
  assert.equal(agg.periodStart(1, NOW), agg.startOfLocalDay(NOW));
  assert.equal(agg.localDayKey(agg.periodStart(1, NOW)), '2026-09-29');
  assert.equal(agg.localDayKey(agg.periodStart(7, NOW)), '2026-09-23');
  assert.equal(agg.localDayKey(agg.periodStart(30, NOW)), '2026-08-31');
  assert.equal(new Date(agg.periodStart(30, NOW)).getHours(), 0);
});

test('rowsSince filters by timestamp and returns a copy for "all time"', () => {
  const { rows } = sampleStore();
  assert.equal(agg.rowsSince(rows, agg.periodStart(1, NOW)).length, 7);
  const all = agg.rowsSince(rows, 0);
  assert.equal(all.length, rows.length);
  assert.notEqual(all, rows);
});

test('dayBreakdown groups calls by local day, newest first', () => {
  const days = agg.dayBreakdown(sampleStore().rows);
  assert.deepEqual(days.map((d) => d.day), ['2026-09-29', '2026-09-28', '2026-09-27']);
  assert.deepEqual(days.map((d) => d.totals.calls), [7, 1, 2]);
});

test('modelBreakdown orders models by input tokens', () => {
  const cur = sampleStore().rows.filter((r) => r.sessionId === 'cur');
  const models = agg.modelBreakdown(cur);
  assert.deepEqual(models.map((m) => [m.model, m.totals.input, m.totals.calls]), [
    ['claude-opus-5.5', 283113, 5],
    ['claude-haiku-4.5', 10410, 2],
  ]);
});

test('sessionBreakdown orders sessions by their latest call', () => {
  const sessions = agg.sessionBreakdown(sampleStore().rows);
  assert.deepEqual(sessions.map((s) => s.sessionId), ['cur', 'mid', 'old']);
});

test('turnBreakdown orders turns newest first and groups sub-agent calls per agent', () => {
  const cur = sampleStore().rows.filter((r) => r.sessionId === 'cur');
  const turns = agg.turnBreakdown(cur);
  assert.deepEqual(turns.map((t) => t.turnIndex), [1, 0]);
  const [latest] = turns;
  assert.deepEqual(latest.mainRows.map((r) => r.initiator), ['user', 'agent', 'compaction']);
  assert.equal(latest.subAgents.length, 1);
  assert.equal(latest.subAgents[0].agentId, 'toolu_A');
  assert.equal(latest.subAgents[0].totals.calls, 2);
  assert.equal(latest.totals.calls, 5);
});

test('turnBreakdown keeps calls without a turn index together', () => {
  const turns = agg.turnBreakdown([mk({ turnIndex: null }), mk({ turnIndex: null })]);
  assert.equal(turns.length, 1);
  assert.equal(turns[0].turnIndex, null);
  assert.equal(turns[0].key, 'none');
});
