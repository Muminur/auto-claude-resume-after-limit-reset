#!/usr/bin/env node
/**
 * Cross-platform Installation Script
 *
 * This script handles npm dependency installation for the auto-resume plugin.
 * It can be used by both the shell and PowerShell installers, or run standalone.
 *
 * Usage:
 *   node scripts/install.js              Install dependencies
 *   node scripts/install.js --check      Check if dependencies are installed
 *   node scripts/install.js --help       Show help
 *
 * Exports:
 *   installDependencies() - Install npm dependencies
 *   getInstallDir() - Get the installation directory path
 *   checkDependencies() - Check if dependencies are installed
 */

const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Critical dependencies required for dashboard functionality
const DASHBOARD_DEPS = ['ws', 'node-notifier'];

/**
 * Get the installation directory for the auto-resume daemon
 * @returns {string} The absolute path to the installation directory
 */
function getInstallDir() {
  const homeDir = os.homedir();
  return path.join(homeDir, '.claude', 'auto-resume');
}

/**
 * Get the plugin source directory (where this script lives)
 * @returns {string} The absolute path to the plugin source directory
 */
function getPluginSourceDir() {
  return path.resolve(__dirname, '..');
}

/**
 * Check if npm is available
 * @returns {boolean} True if npm is available
 */
function isNpmAvailable() {
  try {
    execSync('npm --version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a specific package is installed in the target directory
 * @param {string} packageName - The package to check
 * @param {string} [dir] - The directory to check (defaults to install dir)
 * @returns {boolean} True if the package is installed
 */
function isPackageInstalled(packageName, dir = null) {
  const targetDir = dir || getInstallDir();
  const nodeModulesPath = path.join(targetDir, 'node_modules', packageName);
  return fs.existsSync(nodeModulesPath);
}

/**
 * Check if all required dependencies are installed
 * @param {string} [dir] - The directory to check (defaults to install dir)
 * @returns {{ installed: boolean, missing: string[] }} Installation status
 */
function checkDependencies(dir = null) {
  const targetDir = dir || getInstallDir();
  const packageJsonPath = path.join(targetDir, 'package.json');

  if (!fs.existsSync(packageJsonPath)) {
    return { installed: false, missing: ['package.json not found'] };
  }

  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const dependencies = Object.keys(packageJson.dependencies || {});

    const missing = dependencies.filter(dep => !isPackageInstalled(dep, targetDir));

    return {
      installed: missing.length === 0,
      missing
    };
  } catch (err) {
    return { installed: false, missing: [`Error reading package.json: ${err.message}`] };
  }
}

/**
 * Install npm dependencies in the specified directory
 * @param {Object} options - Installation options
 * @param {string} [options.dir] - The directory to install in (defaults to install dir)
 * @param {boolean} [options.production] - Use production install (default: true)
 * @param {boolean} [options.silent] - Suppress output (default: false)
 * @returns {Promise<{ success: boolean, error?: string }>} Installation result
 */
async function installDependencies(options = {}) {
  const {
    dir = getInstallDir(),
    production = true,
    silent = false
  } = options;

  // Check if npm is available
  if (!isNpmAvailable()) {
    const error = 'npm is not available. Please install Node.js and npm first.';
    if (!silent) {
      console.error(`[ERROR] ${error}`);
    }
    return { success: false, error };
  }

  // Check if package.json exists
  const packageJsonPath = path.join(dir, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    const error = `package.json not found in ${dir}`;
    if (!silent) {
      console.error(`[ERROR] ${error}`);
    }
    return { success: false, error };
  }

  // Create the directory if it doesn't exist
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!silent) {
    console.log(`[INFO] Installing dependencies in ${dir}...`);
  }

  return new Promise((resolve) => {
    const args = ['install'];
    if (production) {
      args.push('--production');
    }

    const npmProcess = spawn('npm', args, {
      cwd: dir,
      shell: true,
      stdio: silent ? 'pipe' : 'inherit'
    });

    npmProcess.on('close', (code) => {
      if (code === 0) {
        if (!silent) {
          console.log('[SUCCESS] Dependencies installed successfully');
        }
        resolve({ success: true });
      } else {
        const error = `npm install exited with code ${code}`;
        if (!silent) {
          console.error(`[ERROR] ${error}`);
        }
        resolve({ success: false, error });
      }
    });

    npmProcess.on('error', (err) => {
      const error = `Failed to run npm install: ${err.message}`;
      if (!silent) {
        console.error(`[ERROR] ${error}`);
      }
      resolve({ success: false, error });
    });
  });
}

/**
 * Copy package.json from source to destination if it doesn't exist
 * @param {Object} options - Copy options
 * @param {string} [options.source] - Source directory (defaults to plugin source)
 * @param {string} [options.dest] - Destination directory (defaults to install dir)
 * @returns {{ success: boolean, error?: string }} Copy result
 */
function copyPackageJson(options = {}) {
  const {
    source = getPluginSourceDir(),
    dest = getInstallDir()
  } = options;

  const sourcePackageJson = path.join(source, 'package.json');
  const destPackageJson = path.join(dest, 'package.json');

  if (!fs.existsSync(sourcePackageJson)) {
    return { success: false, error: `Source package.json not found: ${sourcePackageJson}` };
  }

  // Create destination directory if it doesn't exist
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  try {
    fs.copyFileSync(sourcePackageJson, destPackageJson);
    return { success: true };
  } catch (err) {
    return { success: false, error: `Failed to copy package.json: ${err.message}` };
  }
}

/**
 * Install dashboard dependencies explicitly
 * @param {Object} options - Installation options
 * @returns {Promise<{ success: boolean, error?: string }>} Installation result
 */
async function installDashboardDeps(options = {}) {
  const {
    dir = getInstallDir(),
    silent = false
  } = options;

  if (!isNpmAvailable()) {
    return { success: false, error: 'npm is not available' };
  }

  if (!silent) {
    console.log(`[INFO] Installing dashboard dependencies (${DASHBOARD_DEPS.join(', ')})...`);
  }

  return new Promise((resolve) => {
    const args = ['install', ...DASHBOARD_DEPS, '--save'];

    const npmProcess = spawn('npm', args, {
      cwd: dir,
      shell: true,
      stdio: silent ? 'pipe' : 'inherit'
    });

    npmProcess.on('close', (code) => {
      if (code === 0) {
        if (!silent) {
          console.log('[SUCCESS] Dashboard dependencies installed');
        }
        resolve({ success: true });
      } else {
        const error = `npm install dashboard deps exited with code ${code}`;
        if (!silent) {
          console.error(`[WARNING] ${error}`);
        }
        // Don't fail completely, dashboard is optional
        resolve({ success: true, warning: error });
      }
    });

    npmProcess.on('error', (err) => {
      const error = `Failed to install dashboard deps: ${err.message}`;
      if (!silent) {
        console.error(`[WARNING] ${error}`);
      }
      // Don't fail completely, dashboard is optional
      resolve({ success: true, warning: error });
    });
  });
}

/**
 * Full installation: copy package.json and install dependencies
 * @param {Object} options - Installation options
 * @returns {Promise<{ success: boolean, error?: string }>} Installation result
 */
async function install(options = {}) {
  const silent = options.silent || false;

  // Copy package.json
  if (!silent) {
    console.log('[INFO] Copying package.json...');
  }
  const copyResult = copyPackageJson(options);
  if (!copyResult.success) {
    return copyResult;
  }

  // Install dependencies
  const installResult = await installDependencies(options);
  if (!installResult.success) {
    return installResult;
  }

  // Install dashboard dependencies explicitly
  await installDashboardDeps(options);

  return { success: true };
}

// CLI interface
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Auto-Resume Plugin Installer

Usage:
  node install.js              Install dependencies in ~/.claude/auto-resume
  node install.js --check      Check if dependencies are installed
  node install.js --source     Install from source (copy package.json first)
  node install.js --help       Show this help message

Options:
  --dir <path>    Specify installation directory
  --silent        Suppress output
  --check         Only check if dependencies are installed
  --source        Copy package.json from source before installing
`);
    process.exit(0);
  }

  const silent = args.includes('--silent');
  const checkOnly = args.includes('--check');
  const fromSource = args.includes('--source');
  const dirIndex = args.indexOf('--dir');
  const dir = dirIndex !== -1 ? args[dirIndex + 1] : getInstallDir();

  if (checkOnly) {
    const result = checkDependencies(dir);
    if (result.installed) {
      if (!silent) {
        console.log('[SUCCESS] All dependencies are installed');
      }
      process.exit(0);
    } else {
      if (!silent) {
        console.log('[WARNING] Missing dependencies:', result.missing.join(', '));
      }
      process.exit(1);
    }
  } else {
    const installFn = fromSource ? install : installDependencies;
    installFn({ dir, silent }).then((result) => {
      process.exit(result.success ? 0 : 1);
    });
  }
}

module.exports = {
  installDependencies,
  installDashboardDeps,
  getInstallDir,
  getPluginSourceDir,
  isNpmAvailable,
  isPackageInstalled,
  checkDependencies,
  copyPackageJson,
  install,
  DASHBOARD_DEPS
};
