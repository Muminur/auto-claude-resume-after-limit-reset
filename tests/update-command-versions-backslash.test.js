/**
 * Tests for Windows backslash path handling in update-command-versions.js
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const SCRIPTS_DIR = path.join(__dirname, '..', 'scripts');
const UPDATE_VERSIONS_SCRIPT = path.join(SCRIPTS_DIR, 'update-command-versions.js');

function createTestPlugin(tmpDir, { marketplaceVersion, commandFiles }) {
  const commandsDir = path.join(tmpDir, 'commands');
  const pluginDir = path.join(tmpDir, '.claude-plugin');
  const scriptsDir = path.join(tmpDir, 'scripts');

  fs.mkdirSync(commandsDir, { recursive: true });
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.mkdirSync(scriptsDir, { recursive: true });

  fs.writeFileSync(
    path.join(pluginDir, 'marketplace.json'),
    JSON.stringify({ plugins: [{ id: 'test', version: marketplaceVersion, name: 'Test' }] }, null, 2)
  );
  fs.writeFileSync(
    path.join(pluginDir, 'plugin.json'),
    JSON.stringify({ version: marketplaceVersion, name: 'Test' }, null, 2)
  );

  for (const [name, content] of Object.entries(commandFiles)) {
    fs.writeFileSync(path.join(commandsDir, name), content);
  }

  fs.copyFileSync(UPDATE_VERSIONS_SCRIPT, path.join(scriptsDir, 'update-command-versions.js'));

  return { commandsDir, scriptsDir, updateVersionsScript: path.join(scriptsDir, 'update-command-versions.js') };
}

describe('update-command-versions.js — Windows backslash paths', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backslash-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('updates Windows backslash path (PowerShell style)', () => {
    const { commandsDir, updateVersionsScript } = createTestPlugin(tmpDir, {
      marketplaceVersion: '1.16.2',
      commandFiles: {
        'status.md': 'node "$env:USERPROFILE\\.claude\\plugins\\cache\\auto-claude-resume\\auto-resume\\1.4.13\\auto-resume-daemon.js" status\n',
      },
    });

    execSync(`node "${updateVersionsScript}"`, { cwd: tmpDir, encoding: 'utf8' });

    const updated = fs.readFileSync(path.join(commandsDir, 'status.md'), 'utf8');
    expect(updated).toContain('\\1.16.2\\');
    expect(updated).not.toContain('\\1.4.13\\');
  });

  test('updates Windows CMD-style backslash path', () => {
    const { commandsDir, updateVersionsScript } = createTestPlugin(tmpDir, {
      marketplaceVersion: '1.16.2',
      commandFiles: {
        'start.md': 'node "%USERPROFILE%\\.claude\\plugins\\cache\\auto-claude-resume\\auto-resume\\1.4.13\\auto-resume-daemon.js" start\n',
      },
    });

    execSync(`node "${updateVersionsScript}"`, { cwd: tmpDir, encoding: 'utf8' });

    const updated = fs.readFileSync(path.join(commandsDir, 'start.md'), 'utf8');
    expect(updated).toContain('\\1.16.2\\');
    expect(updated).not.toContain('\\1.4.13\\');
  });

  test('updates both forward-slash and backslash paths in same file', () => {
    const content = [
      '**macOS/Linux:**',
      'node ~/.claude/plugins/cache/auto-claude-resume/auto-resume/1.4.13/auto-resume-daemon.js status',
      '',
      '**Windows (PowerShell):**',
      'node "$env:USERPROFILE\\.claude\\plugins\\cache\\auto-claude-resume\\auto-resume\\1.4.13\\auto-resume-daemon.js" status',
    ].join('\n');

    const { commandsDir, updateVersionsScript } = createTestPlugin(tmpDir, {
      marketplaceVersion: '1.16.2',
      commandFiles: { 'mixed.md': content },
    });

    execSync(`node "${updateVersionsScript}"`, { cwd: tmpDir, encoding: 'utf8' });

    const updated = fs.readFileSync(path.join(commandsDir, 'mixed.md'), 'utf8');
    expect(updated).toContain('/1.16.2/');
    expect(updated).toContain('\\1.16.2\\');
    expect(updated).not.toContain('/1.4.13/');
    expect(updated).not.toContain('\\1.4.13\\');
  });

  test('--check flag detects backslash version mismatch', () => {
    const { updateVersionsScript } = createTestPlugin(tmpDir, {
      marketplaceVersion: '1.16.2',
      commandFiles: {
        'stop.md': 'node "%USERPROFILE%\\.claude\\auto-resume\\1.4.13\\daemon.js" stop\n',
      },
    });

    expect(() => {
      execSync(`node "${updateVersionsScript}" --check`, { cwd: tmpDir, encoding: 'utf8' });
    }).toThrow();
  });

  test('--check flag passes when backslash paths already match', () => {
    const { updateVersionsScript } = createTestPlugin(tmpDir, {
      marketplaceVersion: '1.16.2',
      commandFiles: {
        'stop.md': 'node "%USERPROFILE%\\.claude\\auto-resume\\1.16.2\\daemon.js" stop\n',
      },
    });

    expect(() => {
      execSync(`node "${updateVersionsScript}" --check`, { cwd: tmpDir, encoding: 'utf8' });
    }).not.toThrow();
  });

  test('preserves surrounding path separators (backslash stays backslash)', () => {
    const { commandsDir, updateVersionsScript } = createTestPlugin(tmpDir, {
      marketplaceVersion: '2.0.0',
      commandFiles: {
        'path-test.md': 'C:\\path\\to\\1.4.13\\file.js\n',
      },
    });

    execSync(`node "${updateVersionsScript}"`, { cwd: tmpDir, encoding: 'utf8' });

    const updated = fs.readFileSync(path.join(commandsDir, 'path-test.md'), 'utf8');
    expect(updated).toBe('C:\\path\\to\\2.0.0\\file.js\n');
  });
});
