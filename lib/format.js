'use strict';

const LOCALE = 'en-GB';
const UNITS = ['k', 'M', 'B', 'T'];

const REASONING_NOTE = 'Reasoning (thinking) tokens are reported by the model. Most models count them within Output; Gemini reports them separately.';

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Three significant figures with a k/M/B/T suffix, e.g. 7851 -> "7.85k", 488398 -> "488k". */
function compact(value) {
  const n = toNumber(value);
  const sign = n < 0 ? '-' : '';
  let v = Math.abs(n);
  if (v < 1000) {
    return sign + String(Math.round(v));
  }
  let unit = -1;
  while (v >= 1000 && unit < UNITS.length - 1) {
    v /= 1000;
    unit += 1;
  }
  let rounded = Number(v.toPrecision(3));
  if (rounded >= 1000 && unit < UNITS.length - 1) {
    rounded = Number((rounded / 1000).toPrecision(3));
    unit += 1;
  }
  return `${sign}${rounded}${UNITS[unit]}`;
}

function full(value) {
  return Math.round(toNumber(value)).toLocaleString(LOCALE);
}

function credits(nanoAiu) {
  return (toNumber(nanoAiu) / 1e9).toLocaleString(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function percent(part, whole) {
  const w = toNumber(whole);
  return w > 0 ? `${Math.round((toNumber(part) / w) * 100)}%` : '0%';
}

function duration(ms) {
  const value = toNumber(ms);
  if (value <= 0) {
    return '–';
  }
  if (value < 1000) {
    return `${Math.round(value)} ms`;
  }
  const seconds = value / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)} s`;
  }
  const totalSeconds = Math.round(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) {
    return `${minutes} min ${totalSeconds % 60} s`;
  }
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

function summaryLine(totals) {
  return `In ${compact(totals.input)} · Out ${compact(totals.output)} · Think ${compact(totals.reasoning)}`;
}

function escapeMarkdown(text) {
  return String(text).replace(/[\\`*_{}[\]()#+\-.!|<>~]/g, '\\$&');
}

function oneLine(text, max) {
  const flat = String(text || '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, Math.max(1, max - 1)).trimEnd()}…` : flat;
}

const formatters = new Map();

function formatter(key, options) {
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(LOCALE, options);
    formatters.set(key, f);
  }
  return f;
}

function dateTime(ts) {
  return ts ? formatter('dateTime', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(ts) : '–';
}

function time(ts) {
  return ts ? formatter('time', { hour: '2-digit', minute: '2-digit' }).format(ts) : '–';
}

function timeWithSeconds(ts) {
  return ts ? formatter('timeSeconds', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(ts) : '–';
}

function dayLabel(ts) {
  return ts ? formatter('day', { weekday: 'short', day: 'numeric', month: 'short' }).format(ts) : '–';
}

/** Time only when ts falls on the same local day as now, otherwise day and time. */
function when(ts, now = Date.now()) {
  if (!ts) {
    return '–';
  }
  const a = new Date(ts);
  const b = new Date(now);
  const sameDay = a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  return sameDay ? time(ts) : `${dayLabel(ts)} ${time(ts)}`;
}

function totalsTable(totals, { showCalls = true } = {}) {
  const rows = [
    '| | Tokens |',
    '|:--|--:|',
    `| **Input** | ${full(totals.input)} |`,
    `| ↳ fresh | ${full(totals.fresh)} |`,
    `| ↳ cache read | ${full(totals.cacheRead)} (${percent(totals.cacheRead, totals.input)}) |`,
    `| ↳ cache write | ${full(totals.cacheWrite)} |`,
    `| **Output** | ${full(totals.output)} |`,
    `| **Reasoning** | ${full(totals.reasoning)} |`,
    `| AI credits | ${credits(totals.nanoAiu)} |`,
  ];
  if (showCalls) {
    rows.push(`| Model calls | ${full(totals.calls)} |`);
  }
  return rows.join('\n');
}

/** Markdown tooltip: bold heading, plain-text detail lines (escaped), totals table, optional note. */
function totalsTooltip(heading, lines, totals, { note, showCalls } = {}) {
  const parts = [`**${escapeMarkdown(heading)}**`];
  const details = (lines || []).filter(Boolean).map(escapeMarkdown);
  if (details.length > 0) {
    parts.push(details.join('  \n'));
  }
  parts.push(totalsTable(totals, { showCalls }));
  if (note) {
    parts.push(`_${escapeMarkdown(note)}_`);
  }
  return parts.join('\n\n');
}

module.exports = {
  REASONING_NOTE,
  compact,
  credits,
  dateTime,
  dayLabel,
  duration,
  escapeMarkdown,
  full,
  oneLine,
  percent,
  summaryLine,
  time,
  timeWithSeconds,
  totalsTable,
  totalsTooltip,
  when,
};
