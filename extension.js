'use strict';

const vscode = require('vscode');
const { UsageStore, resolveDbPath } = require('./lib/store');
const { buildRoots } = require('./lib/tree');
const { statusBarContent } = require('./lib/status');
const { localDayKey } = require('./lib/aggregate');

const SECTION = 'copilotTokenMeter';
const VIEW_ID = 'copilotTokenMeter.usage';

function clamp(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function readConfig() {
  const c = vscode.workspace.getConfiguration(SECTION);
  return {
    databasePath: resolveDbPath(c.get('databasePath', '')),
    refreshIntervalSeconds: clamp(c.get('refreshIntervalSeconds'), 1, 300, 5),
    statusBarScope: c.get('statusBarScope') === 'today' ? 'today' : 'latestSession',
    recentSessionCount: Math.round(clamp(c.get('recentSessionCount'), 1, 500, 20)),
    dailyHistoryDays: Math.round(clamp(c.get('dailyHistoryDays'), 1, 365, 14)),
  };
}

class UsageTreeProvider {
  constructor(getRoots) {
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    this._getRoots = getRoots;
  }

  refresh() {
    this._onDidChangeTreeData.fire(undefined);
  }

  getChildren(node) {
    if (!node) {
      return this._getRoots();
    }
    return node.children ? node.children() : [];
  }

  getTreeItem(node) {
    let state = vscode.TreeItemCollapsibleState.None;
    if (node.collapsible === 'expanded') {
      state = vscode.TreeItemCollapsibleState.Expanded;
    } else if (node.collapsible === 'collapsed') {
      state = vscode.TreeItemCollapsibleState.Collapsed;
    }
    const item = new vscode.TreeItem(node.label, state);
    item.id = node.id;
    if (node.description !== undefined) {
      item.description = node.description;
    }
    if (node.markdown) {
      item.tooltip = new vscode.MarkdownString(node.markdown, true);
    } else if (node.tooltip) {
      item.tooltip = node.tooltip;
    }
    if (node.icon) {
      item.iconPath = new vscode.ThemeIcon(node.icon);
    }
    return item;
  }

  dispose() {
    this._onDidChangeTreeData.dispose();
  }
}

function activate(context) {
  let config = readConfig();
  const store = new UsageStore(config.databasePath);
  let roots = null;

  const provider = new UsageTreeProvider(() => {
    if (!roots) {
      roots = buildRoots(store, {
        now: Date.now(),
        recentSessionCount: config.recentSessionCount,
        dailyHistoryDays: config.dailyHistoryDays,
      });
    }
    return roots;
  });
  const view = vscode.window.createTreeView(VIEW_ID, { treeDataProvider: provider, showCollapseAll: true });

  const status = vscode.window.createStatusBarItem(`${SECTION}.status`, vscode.StatusBarAlignment.Right, 100);
  status.name = 'Copilot Token Meter';
  status.command = `${SECTION}.show`;

  let dayKey = localDayKey(Date.now());
  let timer;

  const render = () => {
    roots = null;
    const content = statusBarContent(store, config.statusBarScope, Date.now());
    status.text = content.text;
    status.tooltip = new vscode.MarkdownString(content.markdown, true);
    status.show();
    provider.refresh();
  };

  const refresh = (force) => {
    let changed;
    try {
      changed = store.sync();
    } catch (err) {
      store.error = err instanceof Error ? err : new Error(String(err));
      changed = true;
    }
    // Period buckets (Today, Last 7 days, ...) move at local midnight even without new calls.
    const currentDay = localDayKey(Date.now());
    const dayChanged = currentDay !== dayKey;
    dayKey = currentDay;
    if (changed || dayChanged || force) {
      render();
    }
  };

  const startTimer = () => {
    if (timer) {
      clearInterval(timer);
    }
    timer = setInterval(() => refresh(false), config.refreshIntervalSeconds * 1000);
  };

  const toggleScope = async () => {
    const settings = vscode.workspace.getConfiguration(SECTION);
    const next = config.statusBarScope === 'today' ? 'latestSession' : 'today';
    const inspected = settings.inspect('statusBarScope');
    const target = inspected && inspected.workspaceValue !== undefined
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;
    await settings.update('statusBarScope', next, target);
  };

  context.subscriptions.push(
    view,
    status,
    provider,
    { dispose: () => clearInterval(timer) },
    vscode.commands.registerCommand(`${SECTION}.refresh`, () => refresh(true)),
    vscode.commands.registerCommand(`${SECTION}.show`, () => vscode.commands.executeCommand(`workbench.view.extension.${SECTION}`)),
    vscode.commands.registerCommand(`${SECTION}.toggleStatusBarScope`, toggleScope),
    vscode.commands.registerCommand(`${SECTION}.openSettings`, () => vscode.commands.executeCommand('workbench.action.openSettings', `@ext:${context.extension.id}`)),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(SECTION)) {
        config = readConfig();
        store.setPath(config.databasePath);
        startTimer();
        refresh(true);
      }
    }),
    view.onDidChangeVisibility((event) => {
      if (event.visible) {
        refresh(false);
      }
    }),
  );

  refresh(true);
  startTimer();

  return {
    store,
    provider,
    view,
    status,
    getConfig: () => config,
    refresh: () => refresh(true),
  };
}

function deactivate() {}

module.exports = { activate, deactivate };
