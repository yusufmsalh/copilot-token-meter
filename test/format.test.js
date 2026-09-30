'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fmt = require('../lib/format');

test('compact uses three significant figures and k/M/B/T suffixes', () => {
  const cases = [
    [0, '0'],
    [7, '7'],
    [999, '999'],
    [1000, '1k'],
    [1234, '1.23k'],
    [7851, '7.85k'],
    [12959, '13k'],
    [488398, '488k'],
    [999999, '1M'],
    [1234567, '1.23M'],
    [807591498, '808M'],
    [1.5e9, '1.5B'],
    [2.31e13, '23.1T'],
    [null, '0'],
    ['abc', '0'],
  ];
  for (const [value, expected] of cases) {
    assert.equal(fmt.compact(value), expected, `compact(${value})`);
  }
});

test('full, credits and percent format for en-GB', () => {
  assert.equal(fmt.full(488398), '488,398');
  assert.equal(fmt.full(0), '0');
  assert.equal(fmt.credits(6959800000), '6.96');
  assert.equal(fmt.credits(23102207734000), '23,102.21');
  assert.equal(fmt.credits(0), '0.00');
  assert.equal(fmt.percent(1, 3), '33%');
  assert.equal(fmt.percent(5, 0), '0%');
});

test('duration picks a readable unit', () => {
  assert.equal(fmt.duration(0), '–');
  assert.equal(fmt.duration(250), '250 ms');
  assert.equal(fmt.duration(5998), '6.0 s');
  assert.equal(fmt.duration(577107), '9 min 37 s');
  assert.equal(fmt.duration(3.7e6), '1 h 1 min');
});

test('summaryLine shows input, output and reasoning', () => {
  assert.equal(fmt.summaryLine({ input: 488398, output: 12959, reasoning: 7851 }), 'In 488k · Out 13k · Think 7.85k');
});

test('escapeMarkdown neutralises markdown syntax in user text', () => {
  assert.equal(fmt.escapeMarkdown('a|b*c_[x](y)'), 'a\\|b\\*c\\_\\[x\\]\\(y\\)');
  assert.equal(fmt.escapeMarkdown('<img src=x>'), '\\<img src=x\\>');
});

test('oneLine collapses whitespace and truncates with an ellipsis', () => {
  assert.equal(fmt.oneLine('  a \n\t b  ', 10), 'a b');
  assert.equal(fmt.oneLine('abcdefghijkl', 5), 'abcd…');
  assert.equal(fmt.oneLine(null, 5), '');
});

test('totalsTooltip renders an escaped heading, details and the token table', () => {
  const md = fmt.totalsTooltip('Session *x*', ['Folder: C:\\repo', null], {
    calls: 2, input: 1000, fresh: 100, cacheRead: 800, cacheWrite: 100, output: 50, reasoning: 20, nanoAiu: 2e9,
  }, { note: 'Note.' });
  assert.match(md, /^\*\*Session \\\*x\\\*\*\*/);
  assert.match(md, /Folder: C:\\\\repo/);
  assert.match(md, /\| \*\*Input\*\* \| 1,000 \|/);
  assert.match(md, /\| ↳ cache read \| 800 \(80%\) \|/);
  assert.match(md, /\| \*\*Reasoning\*\* \| 20 \|/);
  assert.match(md, /\| AI credits \| 2\.00 \|/);
  assert.match(md, /\| Model calls \| 2 \|/);
  assert.match(md, /_Note\\\._$/);
  assert.doesNotMatch(fmt.totalsTooltip('x', [], { calls: 1 }, { showCalls: false }), /Model calls/);
});

test('when shows only the time for today and the day otherwise', () => {
  const now = Date.parse('2026-09-29T12:00:00.000Z');
  assert.equal(fmt.when(now - 60000, now), fmt.time(now - 60000));
  assert.equal(fmt.when(now - 3 * 86400000, now), `${fmt.dayLabel(now - 3 * 86400000)} ${fmt.time(now - 3 * 86400000)}`);
  assert.equal(fmt.when(0, now), '–');
});
