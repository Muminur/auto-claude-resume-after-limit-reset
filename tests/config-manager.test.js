const fs = require('fs');
const path = require('path');
const os = require('os');

// Mock fs module before requiring config-manager
jest.mock('fs');

const {
  loadConfig,
  saveConfig,
  getConfig,
  setConfigValue,
  resetConfig,
  getConfigPath,
  getConfigDir,
  DEFAULT_CONFIG
} = require('../src/modules/config-manager');

describe('config-manager', () => {
  const mockConfigDir = path.join(os.homedir(), '.claude', 'auto-resume');
  const mockConfigPath = path.join(mockConfigDir, 'config.json');

  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();

    // Reset module state by clearing cache
    jest.resetModules();

    // Default mock implementations
    fs.existsSync.mockReturnValue(false);
    fs.readFileSync.mockReturnValue('{}');
    fs.writeFileSync.mockImplementation(() => {});
    fs.mkdirSync.mockImplementation(() => {});
  });

  describe('getConfigDir', () => {
    it('should return correct config directory path', () => {
      const expected = path.join(os.homedir(), '.claude', 'auto-resume');
      expect(getConfigDir()).toBe(expected);
    });
  });

  describe('getConfigPath', () => {
    it('should return correct config file path', () => {
      const expected = path.join(os.homedir(), '.claude', 'auto-resume', 'config.json');
      expect(getConfigPath()).toBe(expected);
    });
  });

  describe('loadConfig', () => {
    it('should return default config when file does not exist', () => {
      fs.existsSync.mockReturnValue(false);

      const config = loadConfig();

      expect(config).toEqual(DEFAULT_CONFIG);
      expect(fs.existsSync).toHaveBeenCalledWith(mockConfigPath);
    });

    it('should load and merge config from file with defaults', () => {
      const userConfig = {
        resumePrompt: 'custom prompt',
        checkInterval: 10000,
        notifications: { enabled: false }
      };

      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify(userConfig));

      const config = loadConfig();

      expect(config.resumePrompt).toBe('custom prompt');
      expect(config.checkInterval).toBe(10000);
      expect(config.notifications.enabled).toBe(false);
      expect(config.notifications.sound).toBe(false); // from defaults
      expect(config.logLevel).toBe('info'); // from defaults
      expect(fs.readFileSync).toHaveBeenCalledWith(mockConfigPath, 'utf8');
    });

    it('should throw error for invalid JSON in config file', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue('{ invalid json }');

      expect(() => loadConfig()).toThrow('Invalid JSON in config file');
    });

    it('should throw error for invalid configuration values', () => {
      const invalidConfig = {
        ...DEFAULT_CONFIG,
        checkInterval: 500 // below minimum of 1000
      };

      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify(invalidConfig));

      expect(() => loadConfig()).toThrow('Invalid configuration');
    });

    it('should resolve tilde paths in plugin directory', () => {
      const userConfig = {
        ...DEFAULT_CONFIG,
        plugins: { enabled: true, directory: '~/custom/plugins' }
      };

      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify(userConfig));

      const config = loadConfig();

      expect(config.plugins.directory).toBe(
        path.join(os.homedir(), 'custom/plugins')
      );
    });

    it('should resolve tilde paths in watchPaths array', () => {
      const userConfig = {
        ...DEFAULT_CONFIG,
        watchPaths: ['~/path1', '~/path2', '/absolute/path']
      };

      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify(userConfig));

      const config = loadConfig();

      expect(config.watchPaths[0]).toBe(path.join(os.homedir(), 'path1'));
      expect(config.watchPaths[1]).toBe(path.join(os.homedir(), 'path2'));
      expect(config.watchPaths[2]).toBe('/absolute/path');
    });

    it('should cache loaded config', () => {
      fs.existsSync.mockReturnValue(false);

      const config1 = loadConfig();
      const config2 = getConfig();

      expect(config1).toBe(config2);
      expect(fs.existsSync).toHaveBeenCalledTimes(1);
    });
  });

  describe('saveConfig', () => {
    it('should save valid config to file', () => {
      const config = { ...DEFAULT_CONFIG };

      saveConfig(config);

      expect(fs.mkdirSync).toHaveBeenCalledWith(mockConfigDir, { recursive: true });
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        mockConfigPath,
        JSON.stringify(config, null, 2),
        'utf8'
      );
    });

    it('should throw error for invalid config', () => {
      const invalidConfig = {
        ...DEFAULT_CONFIG,
        logLevel: 'invalid' // not in enum
      };

      expect(() => saveConfig(invalidConfig)).toThrow('Invalid configuration');
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it('should throw error for missing required fields', () => {
      const invalidConfig = {
        resumePrompt: 'test'
        // missing other required fields
      };

      expect(() => saveConfig(invalidConfig)).toThrow('Invalid configuration');
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it('should update cached config after save', () => {
      fs.existsSync.mockReturnValue(false);

      const config = { ...DEFAULT_CONFIG, resumePrompt: 'updated' };
      saveConfig(config);

      const cached = getConfig();
      expect(cached.resumePrompt).toBe('updated');
    });

    it('should create config directory if it does not exist', () => {
      fs.existsSync.mockReturnValue(false);

      const config = { ...DEFAULT_CONFIG };
      saveConfig(config);

      expect(fs.mkdirSync).toHaveBeenCalledWith(mockConfigDir, { recursive: true });
    });
  });

  describe('getConfig', () => {
    it('should return cached config if available', () => {
      fs.existsSync.mockReturnValue(false);

      const config1 = loadConfig();
      const config2 = getConfig();

      expect(config1).toBe(config2);
      expect(fs.existsSync).toHaveBeenCalledTimes(1);
    });

    it('should load config if not cached', () => {
      // Clear the module cache to get a fresh instance
      jest.resetModules();

      // Re-setup fs mocks after module reset
      const fsMock = require('fs');
      fsMock.existsSync.mockReturnValue(false);
      fsMock.readFileSync.mockReturnValue('{}');
      fsMock.writeFileSync.mockImplementation(() => {});
      fsMock.mkdirSync.mockImplementation(() => {});

      // Require fresh instance after cache clear
      const freshConfigManager = require('../src/modules/config-manager');

      const config = freshConfigManager.getConfig();

      // Check that config has expected structure (not necessarily exact values due to tilde resolution)
      expect(config).toHaveProperty('resumePrompt');
      expect(config).toHaveProperty('menuSelection');
      expect(config).toHaveProperty('checkInterval');
      expect(config).toHaveProperty('logLevel');
      expect(config).toHaveProperty('notifications');
      expect(config).toHaveProperty('websocket');
      expect(config).toHaveProperty('api');
      expect(config).toHaveProperty('analytics');
      expect(config).toHaveProperty('watchPaths');
      expect(config).toHaveProperty('plugins');
      expect(fsMock.existsSync).toHaveBeenCalled();
    });
  });

  describe('setConfigValue', () => {
    beforeEach(() => {
      fs.existsSync.mockReturnValue(false);
      loadConfig(); // Initialize cache
    });

    it('should update top-level config value', () => {
      setConfigValue('resumePrompt', 'new prompt');

      expect(fs.writeFileSync).toHaveBeenCalled();
      const savedConfig = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
      expect(savedConfig.resumePrompt).toBe('new prompt');
    });

    it('should update nested config value using dot notation', () => {
      setConfigValue('notifications.enabled', false);

      const savedConfig = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
      expect(savedConfig.notifications.enabled).toBe(false);
      expect(savedConfig.notifications.sound).toBe(false); // unchanged
    });

    it('should update deeply nested config value', () => {
      setConfigValue('websocket.port', 4000);

      const savedConfig = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
      expect(savedConfig.websocket.port).toBe(4000);
    });

    it('should throw error for invalid key', () => {
      expect(() => setConfigValue('nonexistent', 'value')).toThrow(
        'Invalid configuration key'
      );
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it('should throw error for invalid nested key', () => {
      expect(() => setConfigValue('notifications.nonexistent', true)).toThrow(
        'Invalid configuration key'
      );
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it('should throw error for invalid value type', () => {
      expect(() => setConfigValue('checkInterval', 'not a number')).toThrow(
        'Invalid configuration value'
      );
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it('should throw error for value outside range', () => {
      expect(() => setConfigValue('checkInterval', 500)).toThrow(
        'Invalid configuration value'
      );
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it('should throw error for value not in enum', () => {
      expect(() => setConfigValue('logLevel', 'invalid')).toThrow(
        'Invalid configuration value'
      );
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it('should update cache after successful set', () => {
      setConfigValue('resumePrompt', 'updated');

      const config = getConfig();
      expect(config.resumePrompt).toBe('updated');
    });
  });

  describe('resetConfig', () => {
    it('should reset config to defaults', () => {
      fs.existsSync.mockReturnValue(false);

      const config = resetConfig();

      expect(config).toEqual(DEFAULT_CONFIG);
      expect(fs.writeFileSync).toHaveBeenCalled();

      const savedConfig = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
      expect(savedConfig).toEqual(DEFAULT_CONFIG);
    });

    it('should update cache to defaults', () => {
      fs.existsSync.mockReturnValue(false);
      loadConfig();

      setConfigValue('resumePrompt', 'custom');
      resetConfig();

      const config = getConfig();
      expect(config.resumePrompt).toBe(DEFAULT_CONFIG.resumePrompt);
    });

    it('should return the reset config', () => {
      const config = resetConfig();

      expect(config).toEqual(DEFAULT_CONFIG);
    });
  });

  describe('validation', () => {
    beforeEach(() => {
      fs.existsSync.mockReturnValue(false);
    });

    describe('type checking', () => {
      it('should reject wrong type for string field', () => {
        const config = { ...DEFAULT_CONFIG, resumePrompt: 123 };
        expect(() => saveConfig(config)).toThrow('must be of type string');
      });

      it('should reject wrong type for number field', () => {
        const config = { ...DEFAULT_CONFIG, checkInterval: '5000' };
        expect(() => saveConfig(config)).toThrow('must be of type number');
      });

      it('should reject wrong type for boolean field', () => {
        const config = { ...DEFAULT_CONFIG, notifications: { enabled: 'true', sound: false } };
        expect(() => saveConfig(config)).toThrow('must be of type boolean');
      });

      it('should reject wrong type for array field', () => {
        const config = { ...DEFAULT_CONFIG, watchPaths: 'not an array' };
        expect(() => saveConfig(config)).toThrow('must be an array');
      });

      it('should reject wrong type for object field', () => {
        const config = { ...DEFAULT_CONFIG, notifications: 'not an object' };
        expect(() => saveConfig(config)).toThrow('must be an object');
      });

      it('should reject null for object field', () => {
        const config = { ...DEFAULT_CONFIG, notifications: null };
        expect(() => saveConfig(config)).toThrow('must be an object');
      });

      it('should reject array for object field', () => {
        const config = { ...DEFAULT_CONFIG, notifications: [] };
        expect(() => saveConfig(config)).toThrow('must be an object');
      });
    });

    describe('range checking', () => {
      it('should reject value below minimum', () => {
        const config = { ...DEFAULT_CONFIG, checkInterval: 500 };
        expect(() => saveConfig(config)).toThrow('must be at least 1000');
      });

      it('should reject value above maximum', () => {
        const config = { ...DEFAULT_CONFIG, checkInterval: 70000 };
        expect(() => saveConfig(config)).toThrow('must be at most 60000');
      });

      it('should accept value at minimum', () => {
        const config = { ...DEFAULT_CONFIG, checkInterval: 1000 };
        expect(() => saveConfig(config)).not.toThrow();
      });

      it('should accept value at maximum', () => {
        const config = { ...DEFAULT_CONFIG, checkInterval: 60000 };
        expect(() => saveConfig(config)).not.toThrow();
      });

      it('should reject nested number below minimum', () => {
        const config = { ...DEFAULT_CONFIG, websocket: { enabled: true, port: 500 } };
        expect(() => saveConfig(config)).toThrow('must be at least 1024');
      });

      it('should reject nested number above maximum', () => {
        const config = { ...DEFAULT_CONFIG, api: { enabled: true, port: 70000 } };
        expect(() => saveConfig(config)).toThrow('must be at most 65535');
      });
    });

    describe('enum checking', () => {
      it('should reject invalid enum value', () => {
        const config = { ...DEFAULT_CONFIG, logLevel: 'trace' };
        expect(() => saveConfig(config)).toThrow('must be one of: debug, info, warn, error');
      });

      it('should accept valid enum values', () => {
        ['debug', 'info', 'warn', 'error'].forEach(level => {
          const config = { ...DEFAULT_CONFIG, logLevel: level };
          expect(() => saveConfig(config)).not.toThrow();
        });
      });
    });

    describe('required fields', () => {
      it('should reject missing required top-level field', () => {
        const config = { ...DEFAULT_CONFIG };
        delete config.resumePrompt;
        expect(() => saveConfig(config)).toThrow('Missing required field: resumePrompt');
      });

      it('should reject missing required nested field', () => {
        const config = { ...DEFAULT_CONFIG, notifications: { enabled: true } };
        expect(() => saveConfig(config)).toThrow('notifications.sound is required');
      });

      it('should accept config with all required fields', () => {
        const config = { ...DEFAULT_CONFIG };
        expect(() => saveConfig(config)).not.toThrow();
      });
    });

    describe('nested object validation', () => {
      it('should validate nested object properties', () => {
        const config = {
          ...DEFAULT_CONFIG,
          websocket: { enabled: 'not a boolean', port: 3847 }
        };
        expect(() => saveConfig(config)).toThrow('must be of type boolean');
      });

      it('should validate deeply nested properties', () => {
        const config = {
          ...DEFAULT_CONFIG,
          analytics: { enabled: true, retentionDays: 500 }
        };
        expect(() => saveConfig(config)).toThrow('must be at most 365');
      });

      it('should accept valid nested object', () => {
        const config = {
          ...DEFAULT_CONFIG,
          websocket: { enabled: true, port: 8080 }
        };
        expect(() => saveConfig(config)).not.toThrow();
      });
    });
  });

  describe('edge cases', () => {
    it('should handle empty watchPaths array', () => {
      const config = { ...DEFAULT_CONFIG, watchPaths: [] };
      expect(() => saveConfig(config)).not.toThrow();
    });

    it('should handle watchPaths with multiple entries', () => {
      const config = { ...DEFAULT_CONFIG, watchPaths: ['/path1', '/path2', '/path3'] };
      expect(() => saveConfig(config)).not.toThrow();
    });

    it('should deep merge nested objects without losing properties', () => {
      const userConfig = {
        notifications: { enabled: false }
        // sound is not specified
      };

      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify(userConfig));

      const config = loadConfig();

      expect(config.notifications.enabled).toBe(false);
      expect(config.notifications.sound).toBe(false); // from defaults
    });

    it('should handle file system errors gracefully', () => {
      fs.existsSync.mockImplementation(() => {
        throw { code: 'ENOENT' };
      });

      const config = loadConfig();
      expect(config).toEqual(DEFAULT_CONFIG);
    });

    it('should propagate non-ENOENT file system errors', () => {
      fs.existsSync.mockImplementation(() => {
        throw { code: 'EACCES', message: 'Permission denied' };
      });

      expect(() => loadConfig()).toThrow();
    });
  });
});
