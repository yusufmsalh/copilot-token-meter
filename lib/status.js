'use strict';

const agg = require('./aggregate');
const fmt = require('./format');
const { sessionTitle } = require('./tree');

function otherScopeLine(label, totals) {
  return `${label}: ${fmt.summaryLine(totals)} · ${fmt.credits(totals.nanoAiu)} AI credits`;
}

/**
 * Status bar text and markdown tooltip for a UsageStore-like object.
 * scope: 'latestSession' | 'today'.
 */
function statusBarContent(store, scope, now = Date.now()) {
  if (store.error) {
    return {
      text: '$(warning) Token Meter',
      markdown: `**Copilot Token Meter**\n\n${fmt.escapeMarkdown(store.error.message)}`,
    };
  }
  const rows = store.rows;
  if (rows.length === 0) {
    return {
      text: '$(pulse) No Copilot usage yet',
      markdown: `**Copilot Token Meter**\n\n${fmt.escapeMarkdown(`Watching ${store.dbPath}`)}`,
    };
  }

  const todayRows = agg.rowsSince(rows, agg.periodStart(1, now));
  const todayTotals = agg.summarise(todayRows);
  const footer = `_${fmt.escapeMarkdown(fmt.REASONING_NOTE)}_\n\n_Click to open the Token Meter view._`;

  if (scope === 'today') {
    const text = todayRows.length ? `$(calendar) ${fmt.summaryLine(todayTotals)}` : '$(calendar) Today: no calls';
    const markdown = fmt.totalsTooltip('Copilot tokens: today', [
      `Sessions: ${new Set(todayRows.map((row) => row.sessionId)).size}`,
      `Last call: ${fmt.when(todayTotals.lastTs, now)}`,
    ], todayTotals);
    return { text, markdown: `${markdown}\n\n${footer}` };
  }

  const sessionId = agg.latestSessionId(rows);
  const sessionRows = rows.filter((row) => row.sessionId === sessionId);
  const totals = agg.summarise(sessionRows);
  const meta = store.sessions.get(sessionId) || null;
  const models = agg.modelBreakdown(sessionRows).map((m) => m.model).join(', ');
  const markdown = fmt.totalsTooltip('Copilot tokens: latest session', [
    sessionTitle(sessionId, meta),
    `Models: ${models}`,
    `Last call: ${fmt.when(totals.lastTs, now)}`,
  ], totals);
  const today = fmt.escapeMarkdown(otherScopeLine('Today', todayTotals));
  return {
    text: `$(pulse) ${fmt.summaryLine(totals)}`,
    markdown: `${markdown}\n\n${today}\n\n${footer}`,
  };
}

module.exports = { statusBarContent };
