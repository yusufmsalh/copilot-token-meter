'use strict';

// Launches an isolated VS Code instance (temporary profile and extensions folder) with this
// extension in development mode, pointed at a fixture store, and runs suite.js inside it.

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createFixtureDb } = require('../fixture');

const root = path.resolve(__dirname, '..', '..');
const codeExe = process.env.VSCODE_EXECUTABLE
  || path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Microsoft VS Code', 'Code.exe');

function createFixture() {
  const fx = createFixtureDb();
  const now = Date.now();
  const minutesAgo = (m) => new Date(now - m * 60000).toISOString();
  fx.addSession('older', { summary: 'older session', cwd: 'C:\\repos\\a', createdAt: minutesAgo(7) });
  fx.addSession('latest', { summary: 'integration session', cwd: 'C:\\repos\\b', createdAt: minutesAgo(4) });
  fx.addUsage({ sessionId: 'older', input: 5000, cacheRead: 4000, output: 100, reasoning: 10, createdAt: minutesAgo(6) });
  fx.addUsage({ sessionId: 'latest', initiator: 'user', input: 1200, cacheRead: 800, cacheWrite: 300, output: 150, reasoning: 40, createdAt: minutesAgo(3) });
  fx.addUsage({ sessionId: 'latest', input: 1800, cacheRead: 1500, cacheWrite: 200, output: 250, reasoning: 60, createdAt: minutesAgo(2) });
  // The suite appends a row itself, as the Copilot agent host would.
  fx.close();
  return fx;
}

function main() {
  if (!fs.existsSync(codeExe)) {
    console.error(`VS Code executable not found at ${codeExe}. Set VSCODE_EXECUTABLE.`);
    process.exit(2);
  }

  const fx = createFixture();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'token-meter-it-'));
  const userDataDir = path.join(tmp, 'user-data');
  const resultFile = path.join(tmp, 'result.json');
  fs.mkdirSync(path.join(userDataDir, 'User'), { recursive: true });
  fs.writeFileSync(path.join(userDataDir, 'User', 'settings.json'), JSON.stringify({
    'copilotTokenMeter.databasePath': fx.dbPath,
    'copilotTokenMeter.refreshIntervalSeconds': 1,
    'workbench.startupEditor': 'none',
    'telemetry.telemetryLevel': 'off',
    'update.mode': 'none',
    'extensions.autoCheckUpdates': false,
    'extensions.autoUpdate': false,
    'security.workspace.trust.enabled': false,
    'window.restoreWindows': 'none',
  }, null, 2));

  const env = { ...process.env, TOKEN_METER_RESULT_FILE: resultFile, TOKEN_METER_FIXTURE_DB: fx.dbPath };
  for (const key of Object.keys(env)) {
    // Variables inherited from a parent VS Code / Electron process would hijack the new instance.
    if (/^(ELECTRON_|VSCODE_|CHROME_CRASHPAD)/i.test(key)) {
      delete env[key];
    }
  }

  const args = [
    '--no-sandbox',
    '--disable-gpu-sandbox',
    '--disable-updates',
    '--skip-welcome',
    '--skip-release-notes',
    '--disable-workspace-trust',
    `--user-data-dir=${userDataDir}`,
    `--extensions-dir=${path.join(tmp, 'extensions')}`,
    `--extensionDevelopmentPath=${root}`,
    `--extensionTestsPath=${path.join(__dirname, 'suite.js')}`,
  ];

  const output = [];
  const child = spawn(codeExe, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (d) => output.push(String(d)));
  child.stderr.on('data', (d) => output.push(String(d)));
  const timeout = setTimeout(() => {
    output.push('\n[runner] timed out after 180 s\n');
    child.kill();
  }, 180000);

  child.on('exit', (code) => {
    clearTimeout(timeout);
    let results = [];
    try {
      results = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
    } catch {
      console.error('No result file was written by the suite.');
    }
    for (const r of results) {
      console.log(`${r.ok ? '✔' : '✖'} ${r.name}${r.ok ? '' : `\n    ${r.error.split('\n').slice(0, 4).join('\n    ')}`}`);
    }
    const passed = results.filter((r) => r.ok).length;
    const ok = code === 0 && results.length > 0 && passed === results.length;
    console.log(`VS Code exited with code ${code}; ${passed}/${results.length} checks passed`);
    if (!ok) {
      console.log('--- VS Code output (tail) ---');
      console.log(output.join('').split('\n').slice(-60).join('\n'));
    }
    try {
      fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    } catch (err) {
      console.warn(`Could not remove ${tmp}: ${err.message}`);
    }
    fx.cleanup();
    process.exit(ok ? 0 : 1);
  });
}

main();
