'use strict';

function emptyTotals() {
  return {
    calls: 0,
    input: 0,
    fresh: 0,
    cacheRead: 0,
    cacheWrite: 0,
    output: 0,
    reasoning: 0,
    nanoAiu: 0,
    durationMs: 0,
    ttftMs: 0,
    ttftCalls: 0,
    firstTs: 0,
    lastTs: 0,
  };
}

function addRow(totals, row) {
  totals.calls += 1;
  totals.input += row.input;
  totals.fresh += row.fresh;
  totals.cacheRead += row.cacheRead;
  totals.cacheWrite += row.cacheWrite;
  totals.output += row.output;
  totals.reasoning += row.reasoning;
  totals.nanoAiu += row.nanoAiu;
  totals.durationMs += row.durationMs;
  if (row.ttftMs > 0) {
    totals.ttftMs += row.ttftMs;
    totals.ttftCalls += 1;
  }
  if (row.ts > 0) {
    if (totals.firstTs === 0 || row.ts < totals.firstTs) {
      totals.firstTs = row.ts;
    }
    if (row.ts > totals.lastTs) {
      totals.lastTs = row.ts;
    }
  }
  return totals;
}

function summarise(rows) {
  const totals = emptyTotals();
  for (const row of rows) {
    addRow(totals, row);
  }
  return totals;
}

function groupBy(rows, keyFn) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    let list = groups.get(key);
    if (!list) {
      list = [];
      groups.set(key, list);
    }
    list.push(row);
  }
  return groups;
}

function isLater(a, b) {
  return a.ts > b.ts || (a.ts === b.ts && a.id > b.id);
}

function latestSessionId(rows) {
  let latest = null;
  for (const row of rows) {
    if (!latest || isLater(row, latest)) {
      latest = row;
    }
  }
  return latest ? latest.sessionId : null;
}

function startOfLocalDay(ts) {
  const date = new Date(ts);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function addLocalDays(ts, days) {
  const date = new Date(ts);
  date.setDate(date.getDate() + days);
  return date.getTime();
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function localDayKey(ts) {
  const date = new Date(ts);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

const PERIODS = [
  { key: 'today', label: 'Today', days: 1 },
  { key: 'last7', label: 'Last 7 days', days: 7 },
  { key: 'last30', label: 'Last 30 days', days: 30 },
  { key: 'all', label: 'All time', days: 0 },
];

/** Start of a period that includes today plus the previous (days - 1) local calendar days. */
function periodStart(days, now) {
  if (!days) {
    return 0;
  }
  return addLocalDays(startOfLocalDay(now), -(days - 1));
}

function rowsSince(rows, sinceTs) {
  return sinceTs > 0 ? rows.filter((row) => row.ts >= sinceTs) : rows.slice();
}

function modelBreakdown(rows) {
  return [...groupBy(rows, (row) => row.model)]
    .map(([model, modelRows]) => ({ model, rows: modelRows, totals: summarise(modelRows) }))
    .sort((a, b) => b.totals.input - a.totals.input || a.model.localeCompare(b.model));
}

function sessionBreakdown(rows) {
  return [...groupBy(rows, (row) => row.sessionId)]
    .map(([sessionId, sessionRows]) => ({ sessionId, rows: sessionRows, totals: summarise(sessionRows) }))
    .sort((a, b) => b.totals.lastTs - a.totals.lastTs);
}

function dayBreakdown(rows) {
  return [...groupBy(rows, (row) => localDayKey(row.ts))]
    .map(([day, dayRows]) => ({ day, rows: dayRows, totals: summarise(dayRows) }))
    .sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
}

/** Groups a session's calls by turn (latest first); sub-agent calls are grouped per agent. */
function turnBreakdown(rows) {
  const turns = [...groupBy(rows, (row) => (row.turnIndex === null ? 'none' : String(row.turnIndex)))]
    .map(([key, turnRows]) => {
      const ordered = turnRows.slice().sort((a, b) => a.ts - b.ts || a.id - b.id);
      const subAgents = [...groupBy(ordered.filter((row) => row.agentId), (row) => row.agentId)]
        .map(([agentId, agentRows]) => ({ agentId, rows: agentRows, totals: summarise(agentRows) }))
        .sort((a, b) => a.totals.firstTs - b.totals.firstTs);
      return {
        key,
        turnIndex: key === 'none' ? null : Number(key),
        rows: ordered,
        mainRows: ordered.filter((row) => !row.agentId),
        subAgents,
        totals: summarise(ordered),
      };
    });
  return turns.sort((a, b) => b.totals.firstTs - a.totals.firstTs);
}

module.exports = {
  PERIODS,
  addLocalDays,
  dayBreakdown,
  emptyTotals,
  groupBy,
  latestSessionId,
  localDayKey,
  modelBreakdown,
  periodStart,
  rowsSince,
  sessionBreakdown,
  startOfLocalDay,
  summarise,
  turnBreakdown,
};
