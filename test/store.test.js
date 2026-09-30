'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const {
  DEFAULT_DB_PATH,
  UsageStore,
  normaliseUsageRow,
  parseTimestamp,
  resolveDbPath,
} = require('../lib/store');
const { createFixtureDb } = require('./fixture');

const details = (input, cacheRead, cacheWrite, output) => JSON.stringify([
  { tokenType: 'input', tokenCount: input },
  { tokenType: 'cache_read', tokenCount: cacheRead },
  { tokenType: 'cache_write', tokenCount: cacheWrite },
  { tokenType: 'output', tokenCount: output },
]);

test('normaliseUsageRow prefers the billed breakdown over the flat columns', () => {
  // Compaction calls bill cache writes but leave cache_write_tokens at 0.
  const row = normaliseUsageRow({
    id: 7,
    session_id: 's1',
    turn_index: 8,
    agent_id: null,
    model: 'claude-sonnet-5',
    initiator: 'compaction',
    input_tokens: 168092,
    output_tokens: 2852,
    cache_read_tokens: 21155,
    cache_write_tokens: 0,
    reasoning_tokens: null,
    total_nano_aiu: 5000000000,
    token_details_json: details(3, 21155, 146934, 2852),
    created_at: '2026-09-29T13:08:32.171Z',
  });
  assert.equal(row.fresh, 3);
  assert.equal(row.cacheRead, 21155);
  assert.equal(row.cacheWrite, 146934);
  assert.equal(row.input, 168092);
  assert.equal(row.output, 2852);
  assert.equal(row.reasoning, 0);
  assert.equal(row.nanoAiu, 5000000000);
  assert.equal(row.turnIndex, 8);
  assert.equal(row.ts, Date.UTC(2026, 8, 29, 13, 8, 32, 171));
});

test('normaliseUsageRow uses billed tokens when the columns were left at zero', () => {
  const row = normaliseUsageRow({
    id: 9719,
    session_id: 's1',
    model: 'mai-code-1.1-flash',
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    reasoning_tokens: 0,
    token_details_json: details(4672, 23040, 0, 99749),
    created_at: '2026-09-20T10:00:00.000Z',
  });
  assert.equal(row.input, 27712);
  assert.equal(row.output, 99749);
});

test('normaliseUsageRow falls back to the columns when there is no usable breakdown', () => {
  for (const json of [null, '', '{not json', '{"a":1}']) {
    const row = normaliseUsageRow({
      id: 1,
      session_id: 's1',
      turn_index: null,
      model: 'gpt-5.4-mini',
      input_tokens: 1000,
      output_tokens: 50,
      cache_read_tokens: 800,
      cache_write_tokens: 0,
      reasoning_tokens: 20,
      total_nano_aiu: null,
      token_details_json: json,
      created_at: '2026-09-29T13:08:32.000Z',
    });
    assert.equal(row.fresh, 200, `details=${json}`);
    assert.equal(row.cacheRead, 800);
    assert.equal(row.input, 1000);
    assert.equal(row.output, 50);
    assert.equal(row.reasoning, 20);
    assert.equal(row.nanoAiu, 0);
    assert.equal(row.turnIndex, null);
  }
});

test('parseTimestamp treats SQLite datetime() values as UTC', () => {
  assert.equal(parseTimestamp('2026-09-29 13:08:32'), Date.UTC(2026, 8, 29, 13, 8, 32));
  assert.equal(parseTimestamp('2026-09-29T13:08:32.171Z'), Date.UTC(2026, 8, 29, 13, 8, 32, 171));
  assert.equal(parseTimestamp('2026-09-29T16:08:32+03:00'), Date.UTC(2026, 8, 29, 13, 8, 32));
  assert.equal(parseTimestamp(null), 0);
  assert.equal(parseTimestamp('garbage'), 0);
});

test('resolveDbPath defaults to ~/.copilot/session-store.db and expands ~', () => {
  assert.equal(DEFAULT_DB_PATH, path.join(os.homedir(), '.copilot', 'session-store.db'));
  assert.equal(resolveDbPath(''), DEFAULT_DB_PATH);
  assert.equal(resolveDbPath('   '), DEFAULT_DB_PATH);
  assert.equal(resolveDbPath(undefined), DEFAULT_DB_PATH);
  assert.equal(resolveDbPath('~/custom/store.db'), path.join(os.homedir(), 'custom', 'store.db'));
  assert.equal(resolveDbPath('~\\custom\\store.db'), path.join(os.homedir(), 'custom', 'store.db'));
});

test('UsageStore reports a missing store once and stays quiet while nothing changes', () => {
  const store = new UsageStore(path.join(os.tmpdir(), 'token-meter-missing', 'session-store.db'));
  assert.equal(store.sync(), true);
  assert.match(store.error.message, /not found/);
  assert.equal(store.sync(), false);
  assert.equal(store.rows.length, 0);
});

test('UsageStore explains a store that has no usage table', (t) => {
  const fx = createFixtureDb({ withUsageTable: false });
  t.after(() => fx.cleanup());
  const store = new UsageStore(fx.dbPath);
  assert.equal(store.sync(), true);
  assert.match(store.error.message, /no usage table/);
});

test('UsageStore reads a live WAL store incrementally and reloads after deletions', (t) => {
  const fx = createFixtureDb();
  t.after(() => fx.cleanup());
  fx.addSession('s1', { summary: 'hi', cwd: 'C:\\repo' });
  fx.addUsage({ sessionId: 's1', input: 1000, cacheRead: 600, cacheWrite: 300, output: 50, reasoning: 20 });
  fx.addUsage({ sessionId: 's1', input: 2000, cacheRead: 1500, cacheWrite: 400, output: 70, reasoning: 30 });

  // The writer connection stays open, as it does while the Copilot agent host is running.
  const store = new UsageStore(fx.dbPath);
  assert.equal(store.sync(), true);
  assert.equal(store.error, null);
  assert.deepEqual(store.rows.map((r) => r.id), [1, 2]);
  assert.equal(store.rows[0].fresh, 100);
  assert.equal(store.sessions.get('s1').summary, 'hi');
  assert.equal(store.sync(), false, 'no change without new rows');

  const firstRows = store.rows;
  const id3 = fx.addUsage({ sessionId: 's1', output: 5 });
  assert.equal(store.sync(), true);
  assert.deepEqual(store.rows.map((r) => r.id), [1, 2, id3]);
  assert.equal(store.rows[0], firstRows[0], 'existing rows are kept, only new rows are read');

  fx.db.prepare('DELETE FROM assistant_usage_events WHERE id = 1').run();
  assert.equal(store.sync(), true);
  assert.deepEqual(store.rows.map((r) => r.id), [2, id3]);
});

test('UsageStore clears its data when the store disappears and recovers when the path changes', (t) => {
  const fx = createFixtureDb();
  t.after(() => fx.cleanup());
  fx.addSession('s1');
  fx.addUsage({ sessionId: 's1' });
  const store = new UsageStore(fx.dbPath);
  assert.equal(store.sync(), true);
  assert.equal(store.rows.length, 1);

  store.setPath(path.join(fx.dir, 'missing.db'));
  assert.equal(store.rows.length, 0);
  assert.equal(store.sync(), true);
  assert.match(store.error.message, /not found/);

  store.setPath(fx.dbPath);
  assert.equal(store.sync(), true);
  assert.equal(store.error, null);
  assert.equal(store.rows.length, 1);
});
