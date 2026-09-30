'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildRoots, sessionTitle } = require('../lib/tree');
const { NOW, sampleStore } = require('./rows');

const OPTIONS = { now: NOW, recentSessionCount: 20, dailyHistoryDays: 14 };

function expandAll(nodes, visit) {
  for (const node of nodes) {
    visit(node);
    if (node.children) {
      expandAll(node.children(), visit);
    }
  }
}

function child(node, label) {
  const found = node.children().find((n) => n.label === label);
  assert.ok(found, `missing child "${label}" under "${node.label}"`);
  return found;
}

test('roots show the current session, the periods, recent sessions and daily history', () => {
  const roots = buildRoots(sampleStore(), OPTIONS);
  assert.deepEqual(roots.map((n) => n.label), [
    'Current session', 'Today', 'Last 7 days', 'Last 30 days', 'All time', 'Recent sessions', 'Daily',
  ]);
  assert.equal(roots[0].collapsible, 'expanded');
  assert.equal(roots[0].description, 'hi · In 294k · Out 6.8k · Think 2.03k');
  assert.equal(roots[1].description, 'In 294k · Out 6.8k · Think 2.03k');
  assert.equal(roots[2].description, 'In 317k · Out 7.32k · Think 2.28k');
  assert.equal(roots[5].description, '3 of 3');
});

test('every node id is unique across the fully expanded tree', () => {
  const ids = [];
  expandAll(buildRoots(sampleStore(), OPTIONS), (node) => ids.push(node.id));
  assert.ok(ids.length > 100, `expected a deep tree, got ${ids.length} nodes`);
  const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
  assert.deepEqual(duplicates, []);
});

test('current session exposes input, output and reasoning with an input breakdown', () => {
  const [current] = buildRoots(sampleStore(), OPTIONS);
  const children = current.children();
  assert.deepEqual(children.map((n) => n.label), [
    'Input', 'Output', 'Reasoning', 'AI credits', 'Model calls', 'By model', 'Turns',
  ]);
  const byLabel = Object.fromEntries(children.map((n) => [n.label, n]));
  assert.equal(byLabel.Input.description, '293,523');
  assert.equal(byLabel.Output.description, '6,803');
  assert.equal(byLabel.Reasoning.description, '2,028');
  assert.equal(byLabel['AI credits'].description, '7.00');
  assert.equal(byLabel['Model calls'].description, '7 · avg 2.0 s');
  assert.deepEqual(byLabel.Input.children().map((n) => [n.label, n.description]), [
    ['Fresh (uncached)', '125'],
    ['Cache read', '121,596 · 41%'],
    ['Cache write', '171,802'],
  ]);
  assert.deepEqual(byLabel['By model'].children().map((n) => n.label), ['claude-opus-5.5', 'claude-haiku-4.5']);
});

test('turns are newest first and list main-agent calls before sub-agents', () => {
  const [current] = buildRoots(sampleStore(), OPTIONS);
  const turns = child(current, 'Turns').children();
  assert.deepEqual(turns.map((n) => n.label), ['Turn 1', 'Turn 0']);
  const calls = turns[0].children();
  assert.deepEqual(calls.map((n) => n.icon), ['person', 'circle-small', 'fold', 'hubot']);
  assert.equal(calls[3].label, 'Sub-agent 1');
  assert.equal(calls[3].children().length, 2);
  assert.match(calls[2].markdown, /Initiator: compaction/);
  assert.match(calls[2].markdown, /\| ↳ cache write \| 146,934 \|/);
});

test('recent sessions honour the configured limit and use readable titles', () => {
  const roots = buildRoots(sampleStore(), { ...OPTIONS, recentSessionCount: 2 });
  const recent = roots.find((n) => n.label === 'Recent sessions');
  assert.equal(recent.description, '2 of 3');
  assert.deepEqual(recent.children().map((n) => n.label), ['hi', 'app · mid']);
});

test('daily history lists each day with calls, newest first', () => {
  const roots = buildRoots(sampleStore(), OPTIONS);
  const days = roots.find((n) => n.label === 'Daily').children();
  assert.equal(days.length, 3);
  assert.deepEqual(days.map((n) => n.id), ['daily/2026-09-29', 'daily/2026-09-28', 'daily/2026-09-27']);
  const oneDay = buildRoots(sampleStore(), { ...OPTIONS, dailyHistoryDays: 1 }).find((n) => n.label === 'Daily').children();
  assert.equal(oneDay.length, 1);
});

test('error and empty stores render a single explanatory node', () => {
  const error = buildRoots({ rows: [], sessions: new Map(), error: new Error('boom'), dbPath: 'x.db' }, OPTIONS);
  assert.deepEqual(error.map((n) => [n.id, n.label, n.icon]), [['error', 'boom', 'warning']]);
  const empty = buildRoots({ rows: [], sessions: new Map(), error: null, dbPath: 'x.db' }, OPTIONS);
  assert.deepEqual(empty.map((n) => [n.id, n.icon]), [['empty', 'info']]);
  assert.match(empty[0].tooltip, /x\.db/);
});

test('sessionTitle falls back from summary to folder name to session id', () => {
  assert.equal(sessionTitle('abcdef123456', { summary: '  fix   the\nbug ' }), 'fix the bug');
  assert.equal(sessionTitle('abcdef123456', { summary: null, cwd: 'C:\\repos\\web\\' }), 'web · abcdef12');
  assert.equal(sessionTitle('abcdef123456', null), 'Session abcdef12');
  assert.equal(sessionTitle('s', { summary: 'x'.repeat(100) }).length, 60);
});
