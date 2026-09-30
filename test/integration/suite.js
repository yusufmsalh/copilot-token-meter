'use strict';

// Runs inside the VS Code extension host (see run.js).

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vscode = require('vscode');

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
const EXTENSION_ID = `${manifest.publisher}.${manifest.name}`;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs, what) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) {
      return;
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

async function run() {
  const results = [];
  const check = async (name, fn) => {
    try {
      await fn();
      results.push({ name, ok: true });
    } catch (err) {
      results.push({ name, ok: false, error: String((err && err.stack) || err) });
    }
  };

  const extension = vscode.extensions.getExtension(EXTENSION_ID);
  let api;
  await check('extension is loaded in the test instance', () => assert.ok(extension));
  await check('extension activates and exposes its API', async () => {
    api = await extension.activate();
    assert.ok(api && api.store && api.provider && api.status && api.view);
  });

  if (api) {
    await check('node:sqlite works in the extension host and the store is read', () => {
      assert.equal(api.store.error, null);
      assert.equal(api.store.rows.length, 3);
    });

    await check('status bar shows the latest session totals', () => {
      assert.equal(api.status.text, '$(pulse) In 3k · Out 400 · Think 100');
      assert.ok(api.status.tooltip instanceof vscode.MarkdownString);
      assert.match(api.status.tooltip.value, /integration session/);
      assert.equal(api.status.command, 'copilotTokenMeter.show');
    });

    await check('tree roots and metrics render as TreeItems', async () => {
      const roots = await api.provider.getChildren();
      assert.deepEqual(roots.map((r) => r.label), [
        'Current session', 'Today', 'Last 7 days', 'Last 30 days', 'All time', 'Recent sessions', 'Daily',
      ]);
      const item = api.provider.getTreeItem(roots[0]);
      assert.equal(item.id, 'current');
      assert.equal(item.collapsibleState, vscode.TreeItemCollapsibleState.Expanded);
      assert.ok(item.iconPath instanceof vscode.ThemeIcon);
      assert.ok(item.tooltip instanceof vscode.MarkdownString);
      const metrics = await api.provider.getChildren(roots[0]);
      assert.deepEqual(metrics.slice(0, 3).map((m) => [m.label, m.description]), [
        ['Input', '3,000'], ['Output', '400'], ['Reasoning', '100'],
      ]);
    });

    await check('commands are registered', async () => {
      const all = await vscode.commands.getCommands(true);
      for (const id of [
        'copilotTokenMeter.refresh',
        'copilotTokenMeter.show',
        'copilotTokenMeter.toggleStatusBarScope',
        'copilotTokenMeter.openSettings',
      ]) {
        assert.ok(all.includes(id), `missing command ${id}`);
      }
    });

    await check('show command reveals the Token Meter view', async () => {
      await vscode.commands.executeCommand('copilotTokenMeter.show');
      await waitFor(() => api.view.visible, 10000, 'the view to become visible');
    });

    await check('polling picks up calls written by another process', async () => {
      const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(process.env.TOKEN_METER_FIXTURE_DB);
      try {
        db.prepare(`INSERT INTO assistant_usage_events
          (session_id, turn_index, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
           reasoning_tokens, total_nano_aiu, created_at)
          VALUES ('latest', 1, 'claude-opus-5.5', 1000, 600, 900, 0, 50, 1000000000, ?)`).run(new Date().toISOString());
      } finally {
        db.close();
      }
      await waitFor(() => api.status.text === '$(pulse) In 4k · Out 1k · Think 150', 10000, 'the status bar to update');
      assert.equal(api.store.rows.length, 4);
    });

    await check('toggle command switches the status bar to today', async () => {
      await vscode.commands.executeCommand('copilotTokenMeter.toggleStatusBarScope');
      await waitFor(() => api.getConfig().statusBarScope === 'today', 5000, 'the scope setting to change');
      await waitFor(() => api.status.text.startsWith('$(calendar) '), 5000, 'the today status');
      assert.equal(api.status.text, '$(calendar) In 9k · Out 1.1k · Think 160');
    });
  }

  fs.writeFileSync(process.env.TOKEN_METER_RESULT_FILE, JSON.stringify(results, null, 2));
  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    throw new Error(`${failed.length} integration check(s) failed`);
  }
}

module.exports = { run };
