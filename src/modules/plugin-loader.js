const fs = require('fs');
const path = require('path');

/**
 * Plugin validation schema
 */
const PLUGIN_SCHEMA = {
  name: { type: 'string', required: true },
  version: { type: 'string', required: true },
  description: { type: 'string', required: false },
  hooks: { type: 'object', required: false }
};

/**
 * Valid hook names
 */
const VALID_HOOKS = [
  'onRateLimitDetected',
  'onResumeSent',
  'onStatusChange',
  'onDaemonStart',
  'onDaemonStop'
];

/**
 * Plugin loader for custom action extensions
 * Manages plugin discovery, loading, lifecycle, and hook execution
 */
class PluginLoader {
  /**
   * Creates a new PluginLoader instance
   * @param {object} config - Configuration object with plugins settings
   * @param {object} logger - Logger instance (optional)
   */
  constructor(config, logger = null) {
    this.config = config;
    this.logger = logger || this._createDefaultLogger();
    this.plugins = new Map(); // name -> plugin object
    this.pluginMeta = new Map(); // name -> { path, enabled }
  }

  /**
   * Creates a default console logger if none provided
   * @private
   */
  _createDefaultLogger() {
    return {
      debug: (...args) => console.debug('[PluginLoader]', ...args),
      info: (...args) => console.info('[PluginLoader]', ...args),
      warn: (...args) => console.warn('[PluginLoader]', ...args),
      error: (...args) => console.error('[PluginLoader]', ...args)
    };
  }

  /**
   * Gets the plugins directory path from config
   * @private
   */
  _getPluginsDirectory() {
    if (!this.config.plugins || !this.config.plugins.directory) {
      throw new Error('Plugins directory not configured');
    }
    return this.config.plugins.directory;
  }

  /**
   * Validates plugin structure against schema
   * @param {object} plugin - Plugin object to validate
   * @returns {object} { valid: boolean, errors: string[] }
   * @private
   */
  _validatePlugin(plugin) {
    const errors = [];

    // Check required fields
    for (const [field, schema] of Object.entries(PLUGIN_SCHEMA)) {
      if (schema.required && !(field in plugin)) {
        errors.push(`Missing required field: ${field}`);
        continue;
      }

      if (field in plugin) {
        const value = plugin[field];
        const expectedType = schema.type;

        // Type validation
        if (expectedType === 'object') {
          if (typeof value !== 'object' || value === null || Array.isArray(value)) {
            errors.push(`Field '${field}' must be an object`);
          }
        } else if (typeof value !== expectedType) {
          errors.push(`Field '${field}' must be of type ${expectedType}`);
        }
      }
    }

    // Validate hooks if present
    if (plugin.hooks && typeof plugin.hooks === 'object') {
      for (const hookName of Object.keys(plugin.hooks)) {
        if (!VALID_HOOKS.includes(hookName)) {
          errors.push(`Invalid hook name: ${hookName}. Valid hooks: ${VALID_HOOKS.join(', ')}`);
        }
        if (typeof plugin.hooks[hookName] !== 'function') {
          errors.push(`Hook '${hookName}' must be a function`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Discovers all plugins in the plugins directory
   * @returns {string[]} Array of plugin paths
   */
  discover() {
    const pluginsDir = this._getPluginsDirectory();

    // Check if plugins directory exists
    if (!fs.existsSync(pluginsDir)) {
      this.logger.debug(`Plugins directory does not exist: ${pluginsDir}`);
      return [];
    }

    try {
      const entries = fs.readdirSync(pluginsDir, { withFileTypes: true });
      const pluginPaths = [];

      for (const entry of entries) {
        if (entry.isDirectory()) {
          // Check for index.js in subdirectory
          const indexPath = path.join(pluginsDir, entry.name, 'index.js');
          if (fs.existsSync(indexPath)) {
            pluginPaths.push(indexPath);
          }
        } else if (entry.isFile() && entry.name.endsWith('.js')) {
          // Direct .js file in plugins directory
          pluginPaths.push(path.join(pluginsDir, entry.name));
        }
      }

      this.logger.debug(`Discovered ${pluginPaths.length} plugin(s): ${pluginPaths.map(p => path.basename(p)).join(', ')}`);
      return pluginPaths;
    } catch (error) {
      this.logger.error(`Failed to discover plugins: ${error.message}`);
      return [];
    }
  }

  /**
   * Loads a single plugin from the given path
   * @param {string} pluginPath - Absolute path to plugin file
   * @returns {boolean} True if loaded successfully, false otherwise
   */
  load(pluginPath) {
    try {
      // Clear require cache to allow plugin reloading
      delete require.cache[require.resolve(pluginPath)];

      // Load plugin module
      const plugin = require(pluginPath);

      // Validate plugin structure
      const validation = this._validatePlugin(plugin);
      if (!validation.valid) {
        this.logger.error(`Plugin validation failed for ${pluginPath}:\n${validation.errors.join('\n')}`);
        return false;
      }

      // Check for name conflicts
      if (this.plugins.has(plugin.name)) {
        this.logger.warn(`Plugin with name '${plugin.name}' is already loaded. Skipping: ${pluginPath}`);
        return false;
      }

      // Store plugin
      this.plugins.set(plugin.name, plugin);
      this.pluginMeta.set(plugin.name, {
        path: pluginPath,
        enabled: true
      });

      this.logger.info(`Loaded plugin: ${plugin.name} v${plugin.version}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to load plugin from ${pluginPath}: ${error.message}`);
      this.logger.debug(error.stack);
      return false;
    }
  }

  /**
   * Loads all discovered plugins
   * @returns {object} { loaded: number, failed: number }
   */
  loadAll() {
    // Check if plugins are enabled
    if (!this.config.plugins || !this.config.plugins.enabled) {
      this.logger.debug('Plugins are disabled in configuration');
      return { loaded: 0, failed: 0 };
    }

    const pluginPaths = this.discover();
    let loaded = 0;
    let failed = 0;

    for (const pluginPath of pluginPaths) {
      if (this.load(pluginPath)) {
        loaded++;
      } else {
        failed++;
      }
    }

    this.logger.info(`Plugin loading complete: ${loaded} loaded, ${failed} failed`);
    return { loaded, failed };
  }

  /**
   * Unloads a plugin by name
   * @param {string} name - Plugin name
   * @returns {boolean} True if unloaded successfully, false otherwise
   */
  unload(name) {
    if (!this.plugins.has(name)) {
      this.logger.warn(`Plugin '${name}' is not loaded`);
      return false;
    }

    const meta = this.pluginMeta.get(name);

    // Clear from require cache
    if (meta && meta.path) {
      delete require.cache[require.resolve(meta.path)];
    }

    // Remove from maps
    this.plugins.delete(name);
    this.pluginMeta.delete(name);

    this.logger.info(`Unloaded plugin: ${name}`);
    return true;
  }

  /**
   * Gets list of loaded plugins
   * @returns {Array<object>} Array of plugin info objects
   */
  getPlugins() {
    const result = [];

    for (const [name, plugin] of this.plugins.entries()) {
      const meta = this.pluginMeta.get(name);
      result.push({
        name: plugin.name,
        version: plugin.version,
        description: plugin.description || '',
        enabled: meta ? meta.enabled : true,
        hooks: plugin.hooks ? Object.keys(plugin.hooks) : []
      });
    }

    return result;
  }

  /**
   * Enables a plugin by name
   * @param {string} name - Plugin name
   * @returns {boolean} True if enabled successfully
   */
  enable(name) {
    if (!this.plugins.has(name)) {
      this.logger.warn(`Plugin '${name}' is not loaded`);
      return false;
    }

    const meta = this.pluginMeta.get(name);
    if (meta) {
      meta.enabled = true;
      this.logger.info(`Enabled plugin: ${name}`);
      return true;
    }

    return false;
  }

  /**
   * Disables a plugin by name
   * @param {string} name - Plugin name
   * @returns {boolean} True if disabled successfully
   */
  disable(name) {
    if (!this.plugins.has(name)) {
      this.logger.warn(`Plugin '${name}' is not loaded`);
      return false;
    }

    const meta = this.pluginMeta.get(name);
    if (meta) {
      meta.enabled = false;
      this.logger.info(`Disabled plugin: ${name}`);
      return true;
    }

    return false;
  }

  /**
   * Calls a hook on all enabled plugins
   * @param {string} hookName - Name of the hook to call
   * @param {object} event - Event data to pass to hook
   * @returns {Promise<object>} Results object with success/failure counts
   */
  async callHook(hookName, event = {}) {
    if (!VALID_HOOKS.includes(hookName)) {
      this.logger.warn(`Invalid hook name: ${hookName}`);
      return { success: 0, failed: 0, errors: [] };
    }

    const results = {
      success: 0,
      failed: 0,
      errors: []
    };

    // Call hook on each enabled plugin
    for (const [name, plugin] of this.plugins.entries()) {
      const meta = this.pluginMeta.get(name);

      // Skip disabled plugins
      if (!meta || !meta.enabled) {
        continue;
      }

      // Skip if plugin doesn't have this hook
      if (!plugin.hooks || typeof plugin.hooks[hookName] !== 'function') {
        continue;
      }

      try {
        this.logger.debug(`Calling ${hookName} on plugin: ${name}`);

        // Call hook with timeout protection
        const hookPromise = plugin.hooks[hookName](event);
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Hook execution timeout (30s)')), 30000)
        );

        await Promise.race([hookPromise, timeoutPromise]);

        results.success++;
        this.logger.debug(`Hook ${hookName} completed successfully on plugin: ${name}`);
      } catch (error) {
        results.failed++;
        const errorMsg = `Plugin '${name}' hook '${hookName}' failed: ${error.message}`;
        results.errors.push(errorMsg);
        this.logger.error(errorMsg);
        this.logger.debug(error.stack);
      }
    }

    if (results.success > 0 || results.failed > 0) {
      this.logger.debug(`Hook ${hookName} results: ${results.success} success, ${results.failed} failed`);
    }

    return results;
  }

  /**
   * Reloads a plugin by name
   * @param {string} name - Plugin name
   * @returns {boolean} True if reloaded successfully
   */
  reload(name) {
    const meta = this.pluginMeta.get(name);
    if (!meta || !meta.path) {
      this.logger.warn(`Cannot reload plugin '${name}': not found or no path`);
      return false;
    }

    const pluginPath = meta.path;
    this.unload(name);
    return this.load(pluginPath);
  }

  /**
   * Reloads all plugins
   * @returns {object} { loaded: number, failed: number }
   */
  reloadAll() {
    this.logger.info('Reloading all plugins...');

    // Store paths before unloading
    const paths = [];
    for (const meta of this.pluginMeta.values()) {
      if (meta.path) {
        paths.push(meta.path);
      }
    }

    // Unload all
    const names = Array.from(this.plugins.keys());
    for (const name of names) {
      this.unload(name);
    }

    // Reload all
    let loaded = 0;
    let failed = 0;
    for (const pluginPath of paths) {
      if (this.load(pluginPath)) {
        loaded++;
      } else {
        failed++;
      }
    }

    this.logger.info(`Plugin reload complete: ${loaded} loaded, ${failed} failed`);
    return { loaded, failed };
  }
}

module.exports = PluginLoader;
