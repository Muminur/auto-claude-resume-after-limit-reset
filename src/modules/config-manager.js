const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Default configuration for AutoClaudeResume
 */
const DEFAULT_CONFIG = {
  resumePrompt: 'continue',
  menuSelection: '1',
  checkInterval: 5000,
  logLevel: 'info',
  notifications: { enabled: true, sound: false },
  websocket: { enabled: false, port: 3847 },
  api: { enabled: false, port: 3848 },
  analytics: { enabled: true, retentionDays: 30 },
  watchPaths: [],
  plugins: { enabled: false, directory: '~/.claude/auto-resume/plugins' },
  daemon: { transcriptPolling: true, maxLogSizeMB: 1 },
  resume: { postResetDelaySec: 10, maxRetries: 4, verificationWindowSec: 90 }
};

/**
 * Configuration schema for validation
 */
const CONFIG_SCHEMA = {
  resumePrompt: { type: 'string', required: true },
  menuSelection: { type: 'string', required: true },
  checkInterval: { type: 'number', min: 1000, max: 60000, required: true },
  logLevel: { type: 'string', enum: ['debug', 'info', 'warn', 'error'], required: true },
  notifications: {
    type: 'object',
    properties: {
      enabled: { type: 'boolean', required: true },
      sound: { type: 'boolean', required: true }
    }
  },
  websocket: {
    type: 'object',
    properties: {
      enabled: { type: 'boolean', required: true },
      port: { type: 'number', min: 1024, max: 65535, required: true }
    }
  },
  api: {
    type: 'object',
    properties: {
      enabled: { type: 'boolean', required: true },
      port: { type: 'number', min: 1024, max: 65535, required: true }
    }
  },
  analytics: {
    type: 'object',
    properties: {
      enabled: { type: 'boolean', required: true },
      retentionDays: { type: 'number', min: 1, max: 365, required: true }
    }
  },
  watchPaths: { type: 'array', required: true },
  plugins: {
    type: 'object',
    properties: {
      enabled: { type: 'boolean', required: true },
      directory: { type: 'string', required: true }
    }
  },
  daemon: {
    type: 'object',
    properties: {
      transcriptPolling: { type: 'boolean', required: true },
      maxLogSizeMB: { type: 'number', min: 1, max: 100, required: true }
    }
  },
  resume: {
    type: 'object',
    properties: {
      postResetDelaySec: { type: 'number', min: 1, max: 300, required: true },
      maxRetries: { type: 'number', min: 0, max: 10, required: true },
      verificationWindowSec: { type: 'number', min: 10, max: 600, required: true }
    }
  }
};

/**
 * In-memory configuration cache
 */
let cachedConfig = null;

/**
 * Resolves tilde (~) to home directory in paths
 * @param {string} filepath - Path that may contain ~
 * @returns {string} Resolved absolute path
 */
function resolveTildePath(filepath) {
  if (filepath.startsWith('~/') || filepath === '~') {
    return path.join(os.homedir(), filepath.slice(2));
  }
  return filepath;
}

/**
 * Gets the config directory path
 * @returns {string} Absolute path to config directory
 */
function getConfigDir() {
  const configDir = path.join(os.homedir(), '.claude', 'auto-resume');
  return configDir;
}

/**
 * Gets the config file path
 * @returns {string} Absolute path to config.json
 */
function getConfigPath() {
  return path.join(getConfigDir(), 'config.json');
}

/**
 * Ensures config directory exists
 */
function ensureConfigDir() {
  const configDir = getConfigDir();
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
}

/**
 * Validates a value against schema rules
 * @param {any} value - Value to validate
 * @param {object} schema - Schema definition
 * @param {string} fieldName - Name of the field being validated
 * @returns {object} { valid: boolean, error: string|null }
 */
function validateValue(value, schema, fieldName) {
  // Check type
  if (schema.type === 'array') {
    if (!Array.isArray(value)) {
      return { valid: false, error: `${fieldName} must be an array` };
    }
  } else if (schema.type === 'object') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return { valid: false, error: `${fieldName} must be an object` };
    }
    // Validate nested properties
    if (schema.properties) {
      for (const [propName, propSchema] of Object.entries(schema.properties)) {
        if (propSchema.required && !(propName in value)) {
          return { valid: false, error: `${fieldName}.${propName} is required` };
        }
        if (propName in value) {
          const result = validateValue(value[propName], propSchema, `${fieldName}.${propName}`);
          if (!result.valid) {
            return result;
          }
        }
      }
    }
  } else if (typeof value !== schema.type) {
    return { valid: false, error: `${fieldName} must be of type ${schema.type}` };
  }

  // Check enum constraint
  if (schema.enum && !schema.enum.includes(value)) {
    return { valid: false, error: `${fieldName} must be one of: ${schema.enum.join(', ')}` };
  }

  // Check min/max constraints for numbers
  if (schema.type === 'number') {
    if (schema.min !== undefined && value < schema.min) {
      return { valid: false, error: `${fieldName} must be at least ${schema.min}` };
    }
    if (schema.max !== undefined && value > schema.max) {
      return { valid: false, error: `${fieldName} must be at most ${schema.max}` };
    }
  }

  return { valid: true, error: null };
}

/**
 * Validates configuration against schema
 * @param {object} config - Configuration object to validate
 * @returns {object} { valid: boolean, errors: string[] }
 */
function validateConfig(config) {
  const errors = [];

  for (const [key, schema] of Object.entries(CONFIG_SCHEMA)) {
    if (schema.required && !(key in config)) {
      errors.push(`Missing required field: ${key}`);
      continue;
    }

    if (key in config) {
      const result = validateValue(config[key], schema, key);
      if (!result.valid) {
        errors.push(result.error);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Deep merges two objects
 * @param {object} target - Target object
 * @param {object} source - Source object
 * @returns {object} Merged object
 */
function deepMerge(target, source) {
  const result = { ...target };

  for (const key in source) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(result[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }

  return result;
}

/**
 * Loads configuration from file, merging with defaults
 * @returns {object} Configuration object
 * @throws {Error} If config is invalid
 */
function loadConfig() {
  try {
    const configPath = getConfigPath();

    // If config file doesn't exist, return defaults
    if (!fs.existsSync(configPath)) {
      cachedConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
      return cachedConfig;
    }

    // Read and parse config file
    const configData = fs.readFileSync(configPath, 'utf8');
    let userConfig;

    try {
      userConfig = JSON.parse(configData);
    } catch (parseError) {
      throw new Error(`Invalid JSON in config file: ${parseError.message}`);
    }

    // Merge with defaults
    const config = deepMerge(DEFAULT_CONFIG, userConfig);

    // Validate merged config
    const validation = validateConfig(config);
    if (!validation.valid) {
      throw new Error(`Invalid configuration:\n${validation.errors.join('\n')}`);
    }

    // Resolve tilde paths
    if (config.plugins && config.plugins.directory) {
      config.plugins.directory = resolveTildePath(config.plugins.directory);
    }
    if (config.watchPaths && Array.isArray(config.watchPaths)) {
      config.watchPaths = config.watchPaths.map(p => resolveTildePath(p));
    }

    cachedConfig = config;
    return config;
  } catch (error) {
    if (error.code === 'ENOENT') {
      // Config file doesn't exist, return defaults
      cachedConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
      return cachedConfig;
    }
    throw error;
  }
}

/**
 * Saves configuration to file
 * @param {object} config - Configuration object to save
 * @throws {Error} If config is invalid or save fails
 */
function saveConfig(config) {
  // Validate before saving
  const validation = validateConfig(config);
  if (!validation.valid) {
    throw new Error(`Invalid configuration:\n${validation.errors.join('\n')}`);
  }

  // Ensure config directory exists
  ensureConfigDir();

  // Write config file
  const configPath = getConfigPath();
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');

  // Update cache
  cachedConfig = config;
}

/**
 * Gets current configuration (loads if not cached)
 * @returns {object} Current configuration
 */
function getConfig() {
  if (!cachedConfig) {
    return loadConfig();
  }
  return cachedConfig;
}

/**
 * Sets a configuration value using dot notation
 * @param {string} key - Configuration key (supports dot notation, e.g., 'notifications.enabled')
 * @param {any} value - Value to set
 * @throws {Error} If key is invalid or value doesn't match schema
 */
function setConfigValue(key, value) {
  // Deep clone to avoid cache corruption on validation failure
  const config = JSON.parse(JSON.stringify(getConfig()));
  const keys = key.split('.');

  // Navigate to the parent object
  let current = config;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!(keys[i] in current)) {
      throw new Error(`Invalid configuration key: ${key}`);
    }
    current = current[keys[i]];
  }

  // Set the value
  const finalKey = keys[keys.length - 1];
  if (!(finalKey in current)) {
    throw new Error(`Invalid configuration key: ${key}`);
  }

  current[finalKey] = value;

  // Validate the entire config
  const validation = validateConfig(config);
  if (!validation.valid) {
    throw new Error(`Invalid configuration value:\n${validation.errors.join('\n')}`);
  }

  // Save the updated config
  saveConfig(config);
}

/**
 * Resets configuration to defaults
 */
function resetConfig() {
  const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  saveConfig(config);
  return config;
}

module.exports = {
  loadConfig,
  saveConfig,
  getConfig,
  setConfigValue,
  resetConfig,
  getConfigPath,
  getConfigDir,
  DEFAULT_CONFIG
};
