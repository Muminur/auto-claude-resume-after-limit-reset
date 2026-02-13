/**
 * Installation Script Tests
 *
 * TDD tests for verifying that installation scripts properly install npm dependencies.
 * These tests verify:
 * 1. package.json has node-notifier as a dependency
 * 2. Installation scripts include npm install commands
 * 3. Cross-platform installation script exists and works
 */

const fs = require('fs');
const path = require('path');

describe('Installation Scripts', () => {
  const projectRoot = path.resolve(__dirname, '..');

  describe('package.json dependencies', () => {
    let packageJson;

    beforeAll(() => {
      const packagePath = path.join(projectRoot, 'package.json');
      packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    });

    test('should have node-notifier as a dependency', () => {
      expect(packageJson.dependencies).toBeDefined();
      expect(packageJson.dependencies['node-notifier']).toBeDefined();
    });

    test('should have ws (WebSocket) as a dependency', () => {
      expect(packageJson.dependencies['ws']).toBeDefined();
    });

    test('should have chokidar as a dependency', () => {
      expect(packageJson.dependencies['chokidar']).toBeDefined();
    });
  });

  describe('install.sh (Linux/macOS)', () => {
    let installScript;

    beforeAll(() => {
      const scriptPath = path.join(projectRoot, 'install.sh');
      installScript = fs.readFileSync(scriptPath, 'utf8');
    });

    test('should contain install_dependencies function', () => {
      expect(installScript).toMatch(/install_dependencies\s*\(\)/);
    });

    test('should run npm install command', () => {
      expect(installScript).toMatch(/npm install/);
    });

    test('should call install_dependencies during installation', () => {
      // The install function should call install_dependencies
      expect(installScript).toMatch(/install_dependencies/);
    });
  });

  describe('install.ps1 (Windows)', () => {
    let installScript;

    beforeAll(() => {
      const scriptPath = path.join(projectRoot, 'install.ps1');
      installScript = fs.readFileSync(scriptPath, 'utf8');
    });

    test('should contain Install-Dependencies function', () => {
      // This test will FAIL initially - Windows script doesn't have this
      expect(installScript).toMatch(/function\s+Install-Dependencies/i);
    });

    test('should run npm install command', () => {
      // This test will FAIL initially - Windows script doesn't run npm install
      expect(installScript).toMatch(/npm install/i);
    });

    test('should call Install-Dependencies during installation', () => {
      // This test will FAIL initially
      expect(installScript).toMatch(/Install-Dependencies/);
    });
  });

  describe('Cross-platform installation script (scripts/install.js)', () => {
    const scriptPath = path.join(projectRoot, 'scripts', 'install.js');

    test('should exist', () => {
      // This test will FAIL initially - script doesn't exist yet
      expect(fs.existsSync(scriptPath)).toBe(true);
    });

    test('should be a valid Node.js module', () => {
      // Skip if file doesn't exist
      if (!fs.existsSync(scriptPath)) {
        return; // Will be caught by the existence test
      }

      // Should not throw when required
      expect(() => {
        require(scriptPath);
      }).not.toThrow();
    });

    test('should export installDependencies function', () => {
      if (!fs.existsSync(scriptPath)) {
        return;
      }

      const installer = require(scriptPath);
      expect(typeof installer.installDependencies).toBe('function');
    });

    test('should export getInstallDir function', () => {
      if (!fs.existsSync(scriptPath)) {
        return;
      }

      const installer = require(scriptPath);
      expect(typeof installer.getInstallDir).toBe('function');
    });
  });

  describe('Node-notifier availability after install', () => {
    test('node-notifier should be installed and require-able', () => {
      // This verifies node-notifier is actually installed
      expect(() => {
        require('node-notifier');
      }).not.toThrow();
    });

    test('node-notifier should have notify method', () => {
      const notifier = require('node-notifier');
      expect(typeof notifier.notify).toBe('function');
    });
  });
});
