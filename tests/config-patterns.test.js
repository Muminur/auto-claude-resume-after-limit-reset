jest.mock('fs');

const fs = require('fs');
const path = require('path');
const os = require('os');

describe('Pattern Externalization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    fs.existsSync.mockReturnValue(false);
    fs.mkdirSync.mockReturnValue(undefined);
    fs.writeFileSync.mockReturnValue(undefined);
  });

  it('should compile default rate limit patterns to RegExp', () => {
    const { getCompiledPatterns } = require('../src/modules/config-manager');
    const { rateLimitPatterns, falsePositivePatterns } = getCompiledPatterns();
    expect(rateLimitPatterns.length).toBeGreaterThan(0);
    expect(falsePositivePatterns.length).toBeGreaterThan(0);
    expect(rateLimitPatterns[0]).toBeInstanceOf(RegExp);
  });

  it('should match known rate limit messages', () => {
    const { getCompiledPatterns } = require('../src/modules/config-manager');
    const { rateLimitPatterns } = getCompiledPatterns();
    const testMessages = [
      "You've hit your limit",
      "You're out of extra usage",
      "Rate limit exceeded",
      "too many requests"
    ];
    for (const msg of testMessages) {
      const matched = rateLimitPatterns.some(p => p.test(msg));
      expect(matched).toBe(true);
    }
  });

  it('should filter false positives', () => {
    const { getCompiledPatterns } = require('../src/modules/config-manager');
    const { falsePositivePatterns } = getCompiledPatterns();
    const testMessages = [
      "remove rate limit detection",
      "fix rate limit hook",
      "rate_limit_hook"
    ];
    for (const msg of testMessages) {
      const matched = falsePositivePatterns.some(p => p.test(msg));
      expect(matched).toBe(true);
    }
  });

  it('should have pattern arrays in DEFAULT_CONFIG', () => {
    const { DEFAULT_CONFIG } = require('../src/modules/config-manager');
    expect(DEFAULT_CONFIG.patterns).toBeDefined();
    expect(Array.isArray(DEFAULT_CONFIG.patterns.rateLimitPatterns)).toBe(true);
    expect(Array.isArray(DEFAULT_CONFIG.patterns.falsePositivePatterns)).toBe(true);
    expect(DEFAULT_CONFIG.patterns.rateLimitPatterns.length).toBeGreaterThan(5);
  });
});

describe('Per-Project Resume Prompt', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    fs.existsSync.mockReturnValue(false);
    fs.mkdirSync.mockReturnValue(undefined);
    fs.writeFileSync.mockReturnValue(undefined);
  });

  it('should return default resume prompt when no project path', () => {
    const { getResumePromptForProject } = require('../src/modules/config-manager');
    const prompt = getResumePromptForProject();
    expect(prompt).toBe('continue');
  });

  it('should return default resume prompt when project has no override', () => {
    const { getResumePromptForProject } = require('../src/modules/config-manager');
    const prompt = getResumePromptForProject('/some/random/project');
    expect(prompt).toBe('continue');
  });

  it('should return project-specific prompt when config has override', () => {
    const { getResumePromptForProject, getConfig } = require('../src/modules/config-manager');
    const config = getConfig();
    config.projectOverrides = {
      '/my/project': { resumePrompt: 'resume my task' }
    };
    const prompt = getResumePromptForProject('/my/project');
    expect(prompt).toBe('resume my task');
  });

  it('should match subproject paths to parent override', () => {
    const { getResumePromptForProject, getConfig } = require('../src/modules/config-manager');
    const config = getConfig();
    config.projectOverrides = {
      '/my/project': { resumePrompt: 'custom prompt' }
    };
    const prompt = getResumePromptForProject('/my/project/subdir');
    expect(prompt).toBe('custom prompt');
  });

  it('should have projectOverrides in DEFAULT_CONFIG', () => {
    const { DEFAULT_CONFIG } = require('../src/modules/config-manager');
    expect(DEFAULT_CONFIG.projectOverrides).toBeDefined();
    expect(typeof DEFAULT_CONFIG.projectOverrides).toBe('object');
  });

  it('should have metrics config in DEFAULT_CONFIG', () => {
    const { DEFAULT_CONFIG } = require('../src/modules/config-manager');
    expect(DEFAULT_CONFIG.metrics).toBeDefined();
    expect(DEFAULT_CONFIG.metrics.enabled).toBe(false);
    expect(DEFAULT_CONFIG.metrics.port).toBe(9199);
  });

  it('should have daemon config extensions in DEFAULT_CONFIG', () => {
    const { DEFAULT_CONFIG } = require('../src/modules/config-manager');
    expect(DEFAULT_CONFIG.daemon.staleThresholdHours).toBe(2);
    expect(DEFAULT_CONFIG.daemon.hookWatchdogThresholdHours).toBe(2);
  });
});
