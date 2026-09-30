'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { statusBarContent } = require('../lib/status');
const { NOW, sampleStore } = require('./rows');

test('latest-session scope shows that session and today in the tooltip', () => {
  const content = statusBarContent(sampleStore(), 'latestSession', NOW);
  assert.equal(content.text, '$(pulse) In 294k · Out 6.8k · Think 2.03k');
  assert.match(content.markdown, /^\*\*Copilot tokens: latest session\*\*/);
  assert.match(content.markdown, /\nhi {2}\n/);
  assert.match(content.markdown, /Models: claude\\-opus\\-5\\\.5, claude\\-haiku\\-4\\\.5/);
  assert.match(content.markdown, /\| \*\*Output\*\* \| 6,803 \|/);
  assert.match(content.markdown, /Today: In 294k · Out 6\\\.8k · Think 2\\\.03k · 7\\\.00 AI credits/);
  assert.match(content.markdown, /Click to open the Token Meter view/);
});

test('today scope totals every session since local midnight', () => {
  const store = sampleStore();
  const content = statusBarContent(store, 'today', NOW);
  assert.equal(content.text, '$(calendar) In 294k · Out 6.8k · Think 2.03k');
  assert.match(content.markdown, /^\*\*Copilot tokens: today\*\*/);
  assert.match(content.markdown, /Sessions: 1/);

  const tomorrow = NOW + 86400000;
  assert.equal(statusBarContent(store, 'today', tomorrow).text, '$(calendar) Today: no calls');
});

test('error and empty stores are explained', () => {
  const error = statusBarContent({ rows: [], sessions: new Map(), error: new Error('Store [x] missing'), dbPath: 'x' }, 'latestSession', NOW);
  assert.equal(error.text, '$(warning) Token Meter');
  assert.match(error.markdown, /Store \\\[x\\\] missing/);
  const empty = statusBarContent({ rows: [], sessions: new Map(), error: null, dbPath: 'C:\\x.db' }, 'latestSession', NOW);
  assert.equal(empty.text, '$(pulse) No Copilot usage yet');
  assert.match(empty.markdown, /Watching C:\\\\x\\\.db/);
});
