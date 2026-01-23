const fs = require('fs');
const path = require('path');
const os = require('os');

const PluginLoader = require('../src/modules/plugin-loader');

describe('PluginLoader', () => {
  let loader;
  let mockLogger;
  let mockConfig;
  let testPluginsDir;

  beforeAll(() => {
    // Create a temp directory for test plugins
    testPluginsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-loader-test-'));
  });

  afterAll(() => {
    // Clean up temp directory
    if (fs.existsSync(testPluginsDir)) {
      fs.rmSync(testPluginsDir, { recursive: true, force: true });
    }
  });

  beforeEach(() => {
    // Clear previous test plugins
    if (fs.existsSync(testPluginsDir)) {
      fs.readdirSync(testPluginsDir).forEach(file => {
        const filePath = path.join(testPluginsDir, file);
        if (fs.statSync(filePath).isDirectory()) {
          fs.rmSync(filePath, { recursive: true, force: true });
        } else {
          fs.unlinkSync(filePath);
        }
      });
    }

    // Clear require cache for test plugins
    Object.keys(require.cache).forEach(key => {
      if (key.startsWith(testPluginsDir)) {
        delete require.cache[key];
      }
    });

    // Mock logger
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };

    // Mock config
    mockConfig = {
      plugins: {
        enabled: true,
        directory: testPluginsDir
      }
    };
  });

  // Helper to create a plugin file
  const createPlugin = (name, plugin) => {
    const pluginPath = path.join(testPluginsDir, `${name}.js`);
    // Handle plugins with hooks (functions)
    if (plugin.hooks) {
      const hooksStr = Object.keys(plugin.hooks)
        .map(key => `${key}: () => {}`)
        .join(',\n      ');
      const content = `module.exports = {
        name: '${plugin.name}',
        version: '${plugin.version}'${plugin.description ? `,\n    description: '${plugin.description}'` : ''},
        hooks: {
          ${hooksStr}
        }
      };`;
      fs.writeFileSync(pluginPath, content);
    } else {
      const content = `module.exports = ${JSON.stringify(plugin)};`;
      fs.writeFileSync(pluginPath, content);
    }
    return pluginPath;
  };

  // Helper to create error plugin
  const createErrorPlugin = (name, errorMsg) => {
    const pluginPath = path.join(testPluginsDir, `${name}.js`);
    fs.writeFileSync(pluginPath, `throw new Error('${errorMsg}');`);
    return pluginPath;
  };

  // Helper to create plugin directory
  const createPluginDir = (name, plugin) => {
    const pluginDir = path.join(testPluginsDir, name);
    fs.mkdirSync(pluginDir);
    const pluginPath = path.join(pluginDir, 'index.js');
    // Handle plugins with hooks (functions)
    if (plugin.hooks) {
      const hooksStr = Object.keys(plugin.hooks)
        .map(key => `${key}: () => {}`)
        .join(',\n      ');
      const content = `module.exports = {
        name: '${plugin.name}',
        version: '${plugin.version}'${plugin.description ? `,\n    description: '${plugin.description}'` : ''},
        hooks: {
          ${hooksStr}
        }
      };`;
      fs.writeFileSync(pluginPath, content);
    } else {
      const content = `module.exports = ${JSON.stringify(plugin)};`;
      fs.writeFileSync(pluginPath, content);
    }
    return pluginPath;
  };

  describe('constructor', () => {
    it('should initialize with config and logger', () => {
      loader = new PluginLoader(mockConfig, mockLogger);

      expect(loader.config).toBe(mockConfig);
      expect(loader.logger).toBe(mockLogger);
      expect(loader.plugins).toBeInstanceOf(Map);
      expect(loader.pluginMeta).toBeInstanceOf(Map);
      expect(loader.plugins.size).toBe(0);
    });

    it('should create default logger if none provided', () => {
      loader = new PluginLoader(mockConfig);

      expect(loader.logger).toBeDefined();
      expect(typeof loader.logger.debug).toBe('function');
      expect(typeof loader.logger.info).toBe('function');
      expect(typeof loader.logger.warn).toBe('function');
      expect(typeof loader.logger.error).toBe('function');
    });

    it('should initialize with empty plugin maps', () => {
      loader = new PluginLoader(mockConfig, mockLogger);

      expect(loader.plugins.size).toBe(0);
      expect(loader.pluginMeta.size).toBe(0);
    });
  });

  describe('discover', () => {
    beforeEach(() => {
      loader = new PluginLoader(mockConfig, mockLogger);
    });

    it('should return empty array if plugins directory does not exist', () => {
      const badConfig = { plugins: { enabled: true, directory: '/nonexistent' } };
      loader = new PluginLoader(badConfig, mockLogger);

      const plugins = loader.discover();

      expect(plugins).toEqual([]);
    });

    it('should discover .js files in plugins directory', () => {
      createPlugin('plugin1', { name: 'plugin1', version: '1.0.0' });
      createPlugin('plugin2', { name: 'plugin2', version: '1.0.0' });

      const plugins = loader.discover();

      expect(plugins).toHaveLength(2);
    });

    it('should discover index.js in subdirectories', () => {
      createPluginDir('my-plugin', { name: 'my-plugin', version: '1.0.0' });

      const plugins = loader.discover();

      expect(plugins).toHaveLength(1);
      expect(plugins[0]).toContain('my-plugin');
      expect(plugins[0]).toContain('index.js');
    });

    it('should skip directories without index.js', () => {
      fs.mkdirSync(path.join(testPluginsDir, 'empty-dir'));

      const plugins = loader.discover();

      expect(plugins).toEqual([]);
    });

    it('should skip non-.js files', () => {
      fs.writeFileSync(path.join(testPluginsDir, 'README.md'), '# README');
      fs.writeFileSync(path.join(testPluginsDir, 'config.json'), '{}');
      createPlugin('plugin', { name: 'plugin', version: '1.0.0' });

      const plugins = loader.discover();

      expect(plugins).toHaveLength(1);
    });

    it('should throw error if plugins directory not configured', () => {
      const badConfig = { plugins: {} };
      loader = new PluginLoader(badConfig, mockLogger);

      expect(() => loader.discover()).toThrow('Plugins directory not configured');
    });
  });

  describe('load', () => {
    beforeEach(() => {
      loader = new PluginLoader(mockConfig, mockLogger);
    });

    it('should load valid plugin successfully', () => {
      const pluginPath = createPlugin('test-plugin', {
        name: 'test-plugin',
        version: '1.0.0',
        description: 'Test plugin'
      });

      const result = loader.load(pluginPath);

      expect(result).toBe(true);
      expect(loader.plugins.has('test-plugin')).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith('Loaded plugin: test-plugin v1.0.0');
    });

    it('should reject plugin missing required name field', () => {
      const pluginPath = createPlugin('bad', { version: '1.0.0' });

      const result = loader.load(pluginPath);

      expect(result).toBe(false);
      expect(loader.plugins.size).toBe(0);
      expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('validation failed'));
    });

    it('should reject plugin missing required version field', () => {
      const pluginPath = createPlugin('bad', { name: 'bad' });

      const result = loader.load(pluginPath);

      expect(result).toBe(false);
      expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('validation failed'));
    });

    it('should reject plugin with invalid hook name', () => {
      const pluginPath = path.join(testPluginsDir, 'bad.js');
      fs.writeFileSync(pluginPath, `
        module.exports = {
          name: 'bad',
          version: '1.0.0',
          hooks: { invalidHook: () => {} }
        };
      `);

      const result = loader.load(pluginPath);

      expect(result).toBe(false);
      expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Invalid hook'));
    });

    it('should reject plugin with non-function hook', () => {
      const pluginPath = path.join(testPluginsDir, 'bad.js');
      fs.writeFileSync(pluginPath, `
        module.exports = {
          name: 'bad',
          version: '1.0.0',
          hooks: { onRateLimitDetected: 'not a function' }
        };
      `);

      const result = loader.load(pluginPath);

      expect(result).toBe(false);
      expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('must be a function'));
    });

    it('should reject plugin with duplicate name', () => {
      const path1 = createPlugin('plugin1', { name: 'duplicate', version: '1.0.0' });
      const path2 = createPlugin('plugin2', { name: 'duplicate', version: '1.0.0' });

      loader.load(path1);
      const result = loader.load(path2);

      expect(result).toBe(false);
      expect(loader.plugins.size).toBe(1);
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('already loaded'));
    });

    it('should handle plugin load errors', () => {
      const pluginPath = createErrorPlugin('error', 'Syntax error');

      const result = loader.load(pluginPath);

      expect(result).toBe(false);
      expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Failed to load'));
    });

    it('should accept plugin without hooks', () => {
      const pluginPath = createPlugin('simple', { name: 'simple', version: '1.0.0' });

      const result = loader.load(pluginPath);

      expect(result).toBe(true);
      expect(loader.plugins.has('simple')).toBe(true);
    });

    it('should store plugin metadata with path and enabled status', () => {
      const pluginPath = createPlugin('test', { name: 'test', version: '1.0.0' });

      loader.load(pluginPath);

      const meta = loader.pluginMeta.get('test');
      expect(meta.path).toBe(pluginPath);
      expect(meta.enabled).toBe(true);
    });
  });

  describe('loadAll', () => {
    beforeEach(() => {
      loader = new PluginLoader(mockConfig, mockLogger);
    });

    it('should return zero counts if plugins disabled in config', () => {
      mockConfig.plugins.enabled = false;

      const result = loader.loadAll();

      expect(result).toEqual({ loaded: 0, failed: 0 });
    });

    it('should load all discovered plugins', () => {
      createPlugin('plugin1', { name: 'plugin1', version: '1.0.0' });
      createPlugin('plugin2', { name: 'plugin2', version: '1.0.0' });

      // Need to reset config.plugins.enabled since previous test may have changed it
      mockConfig.plugins.enabled = true;
      loader = new PluginLoader(mockConfig, mockLogger);

      const result = loader.loadAll();

      expect(result.loaded).toBe(2);
      expect(result.failed).toBe(0);
      expect(loader.plugins.size).toBe(2);
    });

    it('should track failed plugin loads', () => {
      createPlugin('good', { name: 'good', version: '1.0.0' });
      createErrorPlugin('bad', 'Load error');

      const result = loader.loadAll();

      expect(result.loaded).toBe(1);
      expect(result.failed).toBe(1);
    });

    it('should return zero counts if no plugins found', () => {
      const result = loader.loadAll();

      expect(result).toEqual({ loaded: 0, failed: 0 });
    });
  });

  describe('unload', () => {
    beforeEach(() => {
      loader = new PluginLoader(mockConfig, mockLogger);
    });

    it('should unload plugin by name', () => {
      const pluginPath = createPlugin('test', { name: 'test', version: '1.0.0' });
      loader.load(pluginPath);

      const result = loader.unload('test');

      expect(result).toBe(true);
      expect(loader.plugins.has('test')).toBe(false);
      expect(mockLogger.info).toHaveBeenCalledWith('Unloaded plugin: test');
    });

    it('should return false if plugin not loaded', () => {
      const result = loader.unload('nonexistent');

      expect(result).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith("Plugin 'nonexistent' is not loaded");
    });

    it('should clear plugin from require cache', () => {
      const pluginPath = createPlugin('test', { name: 'test', version: '1.0.0' });
      loader.load(pluginPath);

      loader.unload('test');

      expect(loader.plugins.has('test')).toBe(false);
      expect(loader.pluginMeta.has('test')).toBe(false);
    });
  });

  describe('getPlugins', () => {
    beforeEach(() => {
      loader = new PluginLoader(mockConfig, mockLogger);
    });

    it('should return empty array if no plugins loaded', () => {
      const plugins = loader.getPlugins();

      expect(plugins).toEqual([]);
    });

    it('should return list of loaded plugins with metadata', () => {
      const path1 = path.join(testPluginsDir, 'plugin1.js');
      fs.writeFileSync(path1, `
        module.exports = {
          name: 'plugin1',
          version: '1.0.0',
          description: 'First',
          hooks: { onRateLimitDetected: () => {} }
        };
      `);

      loader.load(path1);

      const plugins = loader.getPlugins();

      expect(plugins).toHaveLength(1);
      expect(plugins[0].name).toBe('plugin1');
      expect(plugins[0].version).toBe('1.0.0');
      expect(plugins[0].enabled).toBe(true);
      expect(plugins[0].hooks).toContain('onRateLimitDetected');
    });

    it('should handle plugins without description', () => {
      const pluginPath = createPlugin('simple', { name: 'simple', version: '1.0.0' });
      loader.load(pluginPath);

      const plugins = loader.getPlugins();

      expect(plugins[0].description).toBe('');
    });

    it('should handle plugins without hooks', () => {
      const pluginPath = createPlugin('simple', { name: 'simple', version: '1.0.0' });
      loader.load(pluginPath);

      const plugins = loader.getPlugins();

      expect(plugins[0].hooks).toEqual([]);
    });

    it('should reflect disabled status', () => {
      const pluginPath = createPlugin('test', { name: 'test', version: '1.0.0' });
      loader.load(pluginPath);
      loader.disable('test');

      const plugins = loader.getPlugins();

      expect(plugins[0].enabled).toBe(false);
    });
  });

  describe('enable/disable', () => {
    beforeEach(() => {
      loader = new PluginLoader(mockConfig, mockLogger);
    });

    it('should enable plugin by name', () => {
      const pluginPath = createPlugin('test', { name: 'test', version: '1.0.0' });
      loader.load(pluginPath);
      loader.disable('test');

      const result = loader.enable('test');

      expect(result).toBe(true);
      expect(loader.pluginMeta.get('test').enabled).toBe(true);
    });

    it('should disable plugin by name', () => {
      const pluginPath = createPlugin('test', { name: 'test', version: '1.0.0' });
      loader.load(pluginPath);

      const result = loader.disable('test');

      expect(result).toBe(true);
      expect(loader.pluginMeta.get('test').enabled).toBe(false);
    });

    it('should return false when enabling nonexistent plugin', () => {
      const result = loader.enable('nonexistent');

      expect(result).toBe(false);
    });

    it('should return false when disabling nonexistent plugin', () => {
      const result = loader.disable('nonexistent');

      expect(result).toBe(false);
    });
  });

  describe('callHook', () => {
    beforeEach(() => {
      loader = new PluginLoader(mockConfig, mockLogger);
    });

    it('should call hook on enabled plugins', async () => {
      const path1 = path.join(testPluginsDir, 'plugin1.js');
      fs.writeFileSync(path1, `
        module.exports = {
          name: 'plugin1',
          version: '1.0.0',
          hooks: {
            onRateLimitDetected: async (event) => {
              global.hookCalled1 = event;
            }
          }
        };
      `);

      loader.load(path1);

      const event = { status: 'rate_limited' };
      const result = await loader.callHook('onRateLimitDetected', event);

      expect(result.success).toBe(1);
      expect(result.failed).toBe(0);
      expect(global.hookCalled1).toEqual(event);
      delete global.hookCalled1;
    });

    it('should skip disabled plugins', async () => {
      const path1 = path.join(testPluginsDir, 'plugin1.js');
      fs.writeFileSync(path1, `
        module.exports = {
          name: 'plugin1',
          version: '1.0.0',
          hooks: {
            onRateLimitDetected: async () => {
              global.shouldNotBeCalled = true;
            }
          }
        };
      `);

      loader.load(path1);
      loader.disable('plugin1');

      await loader.callHook('onRateLimitDetected', {});

      expect(global.shouldNotBeCalled).toBeUndefined();
    });

    it('should skip plugins without the hook', async () => {
      const path1 = path.join(testPluginsDir, 'plugin1.js');
      fs.writeFileSync(path1, `
        module.exports = {
          name: 'plugin1',
          version: '1.0.0',
          hooks: { onResumeSent: async () => {} }
        };
      `);

      loader.load(path1);

      const result = await loader.callHook('onRateLimitDetected', {});

      expect(result.success).toBe(0);
    });

    it('should isolate errors - one plugin failure does not affect others', async () => {
      const path1 = path.join(testPluginsDir, 'plugin1.js');
      fs.writeFileSync(path1, `
        module.exports = {
          name: 'plugin1',
          version: '1.0.0',
          hooks: {
            onRateLimitDetected: async () => {
              throw new Error('Plugin 1 error');
            }
          }
        };
      `);

      const path2 = path.join(testPluginsDir, 'plugin2.js');
      fs.writeFileSync(path2, `
        module.exports = {
          name: 'plugin2',
          version: '1.0.0',
          hooks: {
            onRateLimitDetected: async () => {
              global.plugin2Called = true;
            }
          }
        };
      `);

      loader.load(path1);
      loader.load(path2);

      const result = await loader.callHook('onRateLimitDetected', {});

      expect(result.success).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.errors[0]).toContain('Plugin 1 error');
      expect(global.plugin2Called).toBe(true);
      delete global.plugin2Called;
    });

    it('should timeout hooks after 30 seconds', async () => {
      jest.useFakeTimers();

      const path1 = path.join(testPluginsDir, 'slow.js');
      fs.writeFileSync(path1, `
        module.exports = {
          name: 'slow',
          version: '1.0.0',
          hooks: {
            onRateLimitDetected: async () => {
              return new Promise(() => {});  // Never resolves
            }
          }
        };
      `);

      loader.load(path1);

      const hookPromise = loader.callHook('onRateLimitDetected', {});
      jest.advanceTimersByTime(30000);

      const result = await hookPromise;

      expect(result.failed).toBe(1);
      expect(result.errors[0]).toContain('timeout');

      jest.useRealTimers();
    });

    it('should warn on invalid hook name', async () => {
      const result = await loader.callHook('invalidHook', {});

      expect(result.success).toBe(0);
      expect(mockLogger.warn).toHaveBeenCalledWith('Invalid hook name: invalidHook');
    });

    it('should pass event data to hooks', async () => {
      const path1 = path.join(testPluginsDir, 'plugin1.js');
      fs.writeFileSync(path1, `
        module.exports = {
          name: 'plugin1',
          version: '1.0.0',
          hooks: {
            onStatusChange: async (event) => {
              global.eventData = event;
            }
          }
        };
      `);

      loader.load(path1);

      const event = { oldStatus: 'idle', newStatus: 'active' };
      await loader.callHook('onStatusChange', event);

      expect(global.eventData).toEqual(event);
      delete global.eventData;
    });

    it('should handle hooks without event parameter', async () => {
      const path1 = path.join(testPluginsDir, 'plugin1.js');
      fs.writeFileSync(path1, `
        module.exports = {
          name: 'plugin1',
          version: '1.0.0',
          hooks: {
            onDaemonStart: async (event) => {
              global.eventReceived = event;
            }
          }
        };
      `);

      loader.load(path1);

      await loader.callHook('onDaemonStart');

      expect(global.eventReceived).toEqual({});
      delete global.eventReceived;
    });

    it('should handle synchronous hook functions', async () => {
      const path1 = path.join(testPluginsDir, 'plugin1.js');
      fs.writeFileSync(path1, `
        module.exports = {
          name: 'plugin1',
          version: '1.0.0',
          hooks: {
            onRateLimitDetected: () => {
              global.syncCalled = true;
            }
          }
        };
      `);

      loader.load(path1);

      const result = await loader.callHook('onRateLimitDetected', {});

      expect(result.success).toBe(1);
      expect(global.syncCalled).toBe(true);
      delete global.syncCalled;
    });
  });

  describe('error isolation', () => {
    beforeEach(() => {
      loader = new PluginLoader(mockConfig, mockLogger);
    });

    it('should continue loading other plugins after one fails', () => {
      createPlugin('plugin1', { name: 'plugin1', version: '1.0.0' });
      createErrorPlugin('plugin2', 'Load error');
      createPlugin('plugin3', { name: 'plugin3', version: '1.0.0' });

      const result = loader.loadAll();

      expect(result.loaded).toBe(2);
      expect(result.failed).toBe(1);
      expect(loader.plugins.has('plugin1')).toBe(true);
      expect(loader.plugins.has('plugin3')).toBe(true);
    });

    it('should not crash when unloading plugin with missing metadata', () => {
      const pluginPath = createPlugin('test', { name: 'test', version: '1.0.0' });
      loader.load(pluginPath);
      loader.pluginMeta.delete('test');

      const result = loader.unload('test');

      expect(result).toBe(true);
      expect(loader.plugins.has('test')).toBe(false);
    });

    it('should handle hook execution errors gracefully', async () => {
      const path1 = path.join(testPluginsDir, 'error.js');
      fs.writeFileSync(path1, `
        module.exports = {
          name: 'error',
          version: '1.0.0',
          hooks: {
            onRateLimitDetected: () => {
              throw new Error('Synchronous error');
            }
          }
        };
      `);

      loader.load(path1);

      const result = await loader.callHook('onRateLimitDetected', {});

      expect(result.failed).toBe(1);
      expect(result.errors[0]).toContain('Synchronous error');
    });
  });

  describe('validation', () => {
    beforeEach(() => {
      loader = new PluginLoader(mockConfig, mockLogger);
    });

    it('should reject plugin with wrong type for name', () => {
      const pluginPath = path.join(testPluginsDir, 'bad.js');
      fs.writeFileSync(pluginPath, 'module.exports = { name: 123, version: "1.0.0" };');

      const result = loader.load(pluginPath);

      expect(result).toBe(false);
      expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('must be of type string'));
    });

    it('should reject plugin with wrong type for hooks', () => {
      const pluginPath = path.join(testPluginsDir, 'bad.js');
      fs.writeFileSync(pluginPath, 'module.exports = { name: "test", version: "1.0.0", hooks: "bad" };');

      const result = loader.load(pluginPath);

      expect(result).toBe(false);
      expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('must be an object'));
    });

    it('should accept all valid hook names', () => {
      const path1 = path.join(testPluginsDir, 'test.js');
      fs.writeFileSync(path1, `
        module.exports = {
          name: 'test',
          version: '1.0.0',
          hooks: {
            onRateLimitDetected: () => {},
            onResumeSent: () => {},
            onStatusChange: () => {},
            onDaemonStart: () => {},
            onDaemonStop: () => {}
          }
        };
      `);

      const result = loader.load(path1);

      expect(result).toBe(true);
    });
  });
});
