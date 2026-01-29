/**
 * Integration Tests for Version Management Scripts
 *
 * Tests:
 * - update-command-versions.js (standalone and --check mode)
 * - bump-version.js integration with update-command-versions.js
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Paths to the actual scripts
const SCRIPTS_DIR = path.join(__dirname, '..', 'scripts');
const UPDATE_VERSIONS_SCRIPT = path.join(SCRIPTS_DIR, 'update-command-versions.js');
const BUMP_VERSION_SCRIPT = path.join(SCRIPTS_DIR, 'bump-version.js');

/**
 * Creates a temporary plugin directory structure with test files
 */
function createTestPlugin(tmpDir, options = {}) {
  const {
    marketplaceVersion = '1.0.0',
    pluginVersion = '1.0.0',
    commandVersions = ['1.0.0'],
    includeNonMdFile = false,
    includeFileWithoutVersion = false,
  } = options;

  // Create directory structure
  const commandsDir = path.join(tmpDir, 'commands');
  const pluginDir = path.join(tmpDir, '.claude-plugin');
  const scriptsDir = path.join(tmpDir, 'scripts');

  fs.mkdirSync(commandsDir, { recursive: true });
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.mkdirSync(scriptsDir, { recursive: true });

  // Create marketplace.json
  const marketplaceJson = {
    plugins: [
      {
        id: 'test-plugin',
        version: marketplaceVersion,
        name: 'Test Plugin',
      },
    ],
  };
  fs.writeFileSync(
    path.join(pluginDir, 'marketplace.json'),
    JSON.stringify(marketplaceJson, null, 2) + '\n'
  );

  // Create plugin.json
  const pluginJson = {
    version: pluginVersion,
    name: 'Test Plugin',
  };
  fs.writeFileSync(
    path.join(pluginDir, 'plugin.json'),
    JSON.stringify(pluginJson, null, 2) + '\n'
  );

  // Create command files with version references
  commandVersions.forEach((version, index) => {
    const content = `# Test Command ${index + 1}

Download the latest version from:
https://example.com/releases/${version}/download.zip

Or visit: https://docs.example.com/${version}/getting-started
`;
    fs.writeFileSync(path.join(commandsDir, `test-${index + 1}.md`), content);
  });

  // Create a file without version pattern
  if (includeFileWithoutVersion) {
    fs.writeFileSync(
      path.join(commandsDir, 'no-version.md'),
      '# No Version\n\nThis file has no version references.\n'
    );
  }

  // Create a non-.md file (should be ignored)
  if (includeNonMdFile) {
    fs.writeFileSync(
      path.join(commandsDir, 'readme.txt'),
      'This is not a markdown file with version /1.0.0/ in it.\n'
    );
  }

  // Copy the actual scripts to the temp directory
  fs.copyFileSync(UPDATE_VERSIONS_SCRIPT, path.join(scriptsDir, 'update-command-versions.js'));
  fs.copyFileSync(BUMP_VERSION_SCRIPT, path.join(scriptsDir, 'bump-version.js'));

  return {
    commandsDir,
    pluginDir,
    scriptsDir,
    updateVersionsScript: path.join(scriptsDir, 'update-command-versions.js'),
    bumpVersionScript: path.join(scriptsDir, 'bump-version.js'),
  };
}

/**
 * Reads all .md files from commands directory
 */
function readCommandFiles(commandsDir) {
  return fs
    .readdirSync(commandsDir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => ({
      name: f,
      content: fs.readFileSync(path.join(commandsDir, f), 'utf8'),
    }));
}

/**
 * Extracts all version numbers from a string (e.g., "1.0.0" from "/1.0.0/")
 */
function extractVersions(content) {
  const matches = content.matchAll(/\/(\d+\.\d+\.\d+)\//g);
  return Array.from(matches, (m) => m[1]);
}

describe('update-command-versions.js', () => {
  let tmpDir;
  let testPlugin;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'version-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('updates command files to match marketplace.json version', () => {
    testPlugin = createTestPlugin(tmpDir, {
      marketplaceVersion: '1.4.13',
      commandVersions: ['1.4.11', '1.4.11'],
    });

    // Run the update script
    const output = execSync(`node "${testPlugin.updateVersionsScript}"`, {
      cwd: tmpDir,
      encoding: 'utf8',
    });

    // Verify output mentions updates
    expect(output).toContain('Updated: test-1.md');
    expect(output).toContain('Updated: test-2.md');
    expect(output).toContain('Updated 2 command file(s) to version 1.4.13');

    // Verify files were actually updated
    const files = readCommandFiles(testPlugin.commandsDir);
    files.forEach((file) => {
      const versions = extractVersions(file.content);
      expect(versions).toEqual(['1.4.13', '1.4.13']); // Two references per file
    });
  });

  test('--check flag returns exit code 1 when versions mismatch', () => {
    testPlugin = createTestPlugin(tmpDir, {
      marketplaceVersion: '1.4.13',
      commandVersions: ['1.4.11'],
    });

    // Run with --check flag (should fail)
    expect(() => {
      execSync(`node "${testPlugin.updateVersionsScript}" --check`, {
        cwd: tmpDir,
        encoding: 'utf8',
      });
    }).toThrow();

    // Verify files were NOT modified
    const files = readCommandFiles(testPlugin.commandsDir);
    const versions = extractVersions(files[0].content);
    expect(versions).toEqual(['1.4.11', '1.4.11']);
  });

  test('--check flag returns exit code 0 when versions match', () => {
    testPlugin = createTestPlugin(tmpDir, {
      marketplaceVersion: '1.4.13',
      commandVersions: ['1.4.13'],
    });

    // Run with --check flag (should succeed)
    const output = execSync(`node "${testPlugin.updateVersionsScript}" --check`, {
      cwd: tmpDir,
      encoding: 'utf8',
    });

    expect(output).toContain('All command files match version 1.4.13');
  });

  test('leaves files without version patterns unchanged', () => {
    testPlugin = createTestPlugin(tmpDir, {
      marketplaceVersion: '2.0.0',
      commandVersions: ['1.0.0'],
      includeFileWithoutVersion: true,
    });

    const originalContent = fs.readFileSync(
      path.join(testPlugin.commandsDir, 'no-version.md'),
      'utf8'
    );

    // Run the update script
    execSync(`node "${testPlugin.updateVersionsScript}"`, {
      cwd: tmpDir,
      encoding: 'utf8',
    });

    // Verify no-version.md is unchanged
    const newContent = fs.readFileSync(
      path.join(testPlugin.commandsDir, 'no-version.md'),
      'utf8'
    );
    expect(newContent).toBe(originalContent);
  });

  test('ignores non-.md files', () => {
    testPlugin = createTestPlugin(tmpDir, {
      marketplaceVersion: '2.0.0',
      commandVersions: ['1.0.0'],
      includeNonMdFile: true,
    });

    const originalContent = fs.readFileSync(
      path.join(testPlugin.commandsDir, 'readme.txt'),
      'utf8'
    );

    // Run the update script
    execSync(`node "${testPlugin.updateVersionsScript}"`, {
      cwd: tmpDir,
      encoding: 'utf8',
    });

    // Verify .txt file is unchanged
    const newContent = fs.readFileSync(
      path.join(testPlugin.commandsDir, 'readme.txt'),
      'utf8'
    );
    expect(newContent).toBe(originalContent);
    expect(newContent).toContain('/1.0.0/'); // Still has old version
  });

  test('handles multiple different versions in same file', () => {
    testPlugin = createTestPlugin(tmpDir, {
      marketplaceVersion: '3.0.0',
    });

    // Create a file with mixed versions
    const mixedContent = `# Mixed Versions

Upgrade from /1.0.0/ or /2.0.0/ to the latest version.
Visit /1.5.0/ for migration guide.
`;
    fs.writeFileSync(path.join(testPlugin.commandsDir, 'mixed.md'), mixedContent);

    // Run the update script
    execSync(`node "${testPlugin.updateVersionsScript}"`, {
      cwd: tmpDir,
      encoding: 'utf8',
    });

    // Verify all versions updated
    const updatedContent = fs.readFileSync(
      path.join(testPlugin.commandsDir, 'mixed.md'),
      'utf8'
    );
    const versions = extractVersions(updatedContent);
    expect(versions).toEqual(['3.0.0', '3.0.0', '3.0.0']);
  });

  test('reports correct count when no files need updating', () => {
    testPlugin = createTestPlugin(tmpDir, {
      marketplaceVersion: '1.0.0',
      commandVersions: ['1.0.0'],
    });

    const output = execSync(`node "${testPlugin.updateVersionsScript}"`, {
      cwd: tmpDir,
      encoding: 'utf8',
    });

    expect(output).toContain('Updated 0 command file(s) to version 1.0.0');
  });
});

describe('bump-version.js integration', () => {
  let tmpDir;
  let testPlugin;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bump-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('bumps patch version and updates command files', () => {
    testPlugin = createTestPlugin(tmpDir, {
      marketplaceVersion: '1.0.0',
      pluginVersion: '1.0.0',
      commandVersions: ['1.0.0', '1.0.0'],
    });

    // Run bump-version script (defaults to patch)
    const output = execSync(`node "${testPlugin.bumpVersionScript}"`, {
      cwd: tmpDir,
      encoding: 'utf8',
    });

    // Verify output
    expect(output).toContain('Bumping version: 1.0.0 -> 1.0.1 (patch)');
    expect(output).toContain('Updating command files...');

    // Verify plugin.json updated
    const pluginJson = JSON.parse(
      fs.readFileSync(path.join(testPlugin.pluginDir, 'plugin.json'), 'utf8')
    );
    expect(pluginJson.version).toBe('1.0.1');

    // Verify marketplace.json updated
    const marketplaceJson = JSON.parse(
      fs.readFileSync(path.join(testPlugin.pluginDir, 'marketplace.json'), 'utf8')
    );
    expect(marketplaceJson.plugins[0].version).toBe('1.0.1');

    // Verify command files updated
    const files = readCommandFiles(testPlugin.commandsDir);
    files.forEach((file) => {
      const versions = extractVersions(file.content);
      versions.forEach((version) => {
        expect(version).toBe('1.0.1');
      });
    });
  });

  test('bumps minor version correctly', () => {
    testPlugin = createTestPlugin(tmpDir, {
      marketplaceVersion: '1.2.3',
      pluginVersion: '1.2.3',
      commandVersions: ['1.2.3'],
    });

    const output = execSync(`node "${testPlugin.bumpVersionScript}" minor`, {
      cwd: tmpDir,
      encoding: 'utf8',
    });

    expect(output).toContain('Bumping version: 1.2.3 -> 1.3.0 (minor)');

    // Verify all files updated to 1.3.0
    const pluginJson = JSON.parse(
      fs.readFileSync(path.join(testPlugin.pluginDir, 'plugin.json'), 'utf8')
    );
    expect(pluginJson.version).toBe('1.3.0');

    const files = readCommandFiles(testPlugin.commandsDir);
    const versions = extractVersions(files[0].content);
    expect(versions).toEqual(['1.3.0', '1.3.0']);
  });

  test('bumps major version correctly', () => {
    testPlugin = createTestPlugin(tmpDir, {
      marketplaceVersion: '1.2.3',
      pluginVersion: '1.2.3',
      commandVersions: ['1.2.3'],
    });

    const output = execSync(`node "${testPlugin.bumpVersionScript}" major`, {
      cwd: tmpDir,
      encoding: 'utf8',
    });

    expect(output).toContain('Bumping version: 1.2.3 -> 2.0.0 (major)');

    // Verify all files updated to 2.0.0
    const marketplaceJson = JSON.parse(
      fs.readFileSync(path.join(testPlugin.pluginDir, 'marketplace.json'), 'utf8')
    );
    expect(marketplaceJson.plugins[0].version).toBe('2.0.0');

    const files = readCommandFiles(testPlugin.commandsDir);
    const versions = extractVersions(files[0].content);
    expect(versions).toEqual(['2.0.0', '2.0.0']);
  });

  test('handles invalid bump type', () => {
    testPlugin = createTestPlugin(tmpDir, {
      marketplaceVersion: '1.0.0',
      pluginVersion: '1.0.0',
    });

    expect(() => {
      execSync(`node "${testPlugin.bumpVersionScript}" invalid`, {
        cwd: tmpDir,
        encoding: 'utf8',
      });
    }).toThrow();
  });

  test('syncs plugin.json and marketplace.json when out of sync', () => {
    testPlugin = createTestPlugin(tmpDir, {
      marketplaceVersion: '1.0.0',
      pluginVersion: '0.9.0', // Different version
      commandVersions: ['1.0.0'],
    });

    // Bump should read from plugin.json
    const output = execSync(`node "${testPlugin.bumpVersionScript}"`, {
      cwd: tmpDir,
      encoding: 'utf8',
    });

    expect(output).toContain('Bumping version: 0.9.0 -> 0.9.1');

    // Both should now be 0.9.1
    const pluginJson = JSON.parse(
      fs.readFileSync(path.join(testPlugin.pluginDir, 'plugin.json'), 'utf8')
    );
    const marketplaceJson = JSON.parse(
      fs.readFileSync(path.join(testPlugin.pluginDir, 'marketplace.json'), 'utf8')
    );

    expect(pluginJson.version).toBe('0.9.1');
    expect(marketplaceJson.plugins[0].version).toBe('0.9.1');

    // Command files should be updated to 0.9.1
    const files = readCommandFiles(testPlugin.commandsDir);
    const versions = extractVersions(files[0].content);
    expect(versions).toEqual(['0.9.1', '0.9.1']);
  });

  test('preserves JSON formatting with 2-space indentation', () => {
    testPlugin = createTestPlugin(tmpDir, {
      marketplaceVersion: '1.0.0',
      pluginVersion: '1.0.0',
    });

    execSync(`node "${testPlugin.bumpVersionScript}"`, {
      cwd: tmpDir,
      encoding: 'utf8',
    });

    // Read raw file content
    const pluginContent = fs.readFileSync(
      path.join(testPlugin.pluginDir, 'plugin.json'),
      'utf8'
    );
    const marketplaceContent = fs.readFileSync(
      path.join(testPlugin.pluginDir, 'marketplace.json'),
      'utf8'
    );

    // Check for 2-space indentation
    expect(pluginContent).toMatch(/^{\n  "version"/m);
    expect(marketplaceContent).toMatch(/^{\n  "plugins"/m);

    // Check for trailing newline
    expect(pluginContent.endsWith('\n')).toBe(true);
    expect(marketplaceContent.endsWith('\n')).toBe(true);
  });
});

describe('edge cases and error handling', () => {
  let tmpDir;
  let testPlugin;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('handles empty commands directory', () => {
    testPlugin = createTestPlugin(tmpDir, {
      marketplaceVersion: '1.0.0',
      commandVersions: [], // No command files
    });

    const output = execSync(`node "${testPlugin.updateVersionsScript}"`, {
      cwd: tmpDir,
      encoding: 'utf8',
    });

    expect(output).toContain('Updated 0 command file(s) to version 1.0.0');
  });

  test('handles version with leading zeros', () => {
    testPlugin = createTestPlugin(tmpDir, {
      marketplaceVersion: '1.0.10',
      commandVersions: ['1.0.9'],
    });

    execSync(`node "${testPlugin.updateVersionsScript}"`, {
      cwd: tmpDir,
      encoding: 'utf8',
    });

    const files = readCommandFiles(testPlugin.commandsDir);
    const versions = extractVersions(files[0].content);
    expect(versions).toEqual(['1.0.10', '1.0.10']);
  });

  test('preserves content around version patterns', () => {
    testPlugin = createTestPlugin(tmpDir, {
      marketplaceVersion: '2.0.0',
    });

    const originalContent = `# Test
Before /1.0.0/ after.
Multiple on /1.0.0/ one line /1.0.0/ here.
End.`;

    fs.writeFileSync(path.join(testPlugin.commandsDir, 'preserve.md'), originalContent);

    execSync(`node "${testPlugin.updateVersionsScript}"`, {
      cwd: tmpDir,
      encoding: 'utf8',
    });

    const updatedContent = fs.readFileSync(
      path.join(testPlugin.commandsDir, 'preserve.md'),
      'utf8'
    );

    expect(updatedContent).toBe(`# Test
Before /2.0.0/ after.
Multiple on /2.0.0/ one line /2.0.0/ here.
End.`);
  });
});
