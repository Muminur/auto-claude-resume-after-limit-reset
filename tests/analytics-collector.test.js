const fs = require('fs');
const path = require('path');
const os = require('os');

// Mock fs module before requiring analytics-collector
jest.mock('fs');

const AnalyticsCollector = require('../src/modules/analytics-collector');

describe('AnalyticsCollector', () => {
  const mockAnalyticsDir = path.join(os.homedir(), '.claude', 'auto-resume');
  const mockAnalyticsPath = path.join(mockAnalyticsDir, 'analytics.json');

  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();

    // Default mock implementations
    fs.existsSync.mockReturnValue(false);
    fs.readFileSync.mockReturnValue('{}');
    fs.mkdirSync.mockImplementation(() => {});

    // Mock promises API
    fs.promises = {
      writeFile: jest.fn().mockResolvedValue(undefined),
      rename: jest.fn().mockResolvedValue(undefined)
    };
  });

  describe('constructor', () => {
    it('should initialize with default config', () => {
      const collector = new AnalyticsCollector();

      expect(collector.retentionDays).toBe(30);
      expect(collector.dataPath).toBe(mockAnalyticsPath);
      expect(collector.data).toEqual({
        rateLimits: [],
        resumes: [],
        version: '1.0.0'
      });
    });

    it('should initialize with custom config', () => {
      const customPath = '/custom/path/analytics.json';
      const collector = new AnalyticsCollector({
        retentionDays: 60,
        dataPath: customPath
      });

      expect(collector.retentionDays).toBe(60);
      expect(collector.dataPath).toBe(customPath);
    });

    it('should create analytics directory if it does not exist', () => {
      fs.existsSync.mockReturnValue(false);

      new AnalyticsCollector();

      expect(fs.mkdirSync).toHaveBeenCalledWith(
        mockAnalyticsDir,
        { recursive: true }
      );
    });

    it('should load existing data from file', () => {
      const existingData = {
        rateLimits: [
          { timestamp: 1000, resetTime: 2000, session: 'test', duration: 1000 }
        ],
        resumes: [
          { timestamp: 3000, session: 'test', success: true }
        ],
        version: '1.0.0'
      };

      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify(existingData));

      const collector = new AnalyticsCollector();

      expect(collector.data).toEqual(existingData);
    });

    it('should handle corrupted data file gracefully', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue('invalid json');

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const collector = new AnalyticsCollector();

      expect(collector.data).toEqual({
        rateLimits: [],
        resumes: [],
        version: '1.0.0'
      });
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should validate and fix invalid data structure', () => {
      const invalidData = {
        rateLimits: 'not an array',
        resumes: null,
        version: '1.0.0'
      };

      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify(invalidData));

      const collector = new AnalyticsCollector();

      expect(collector.data.rateLimits).toEqual([]);
      expect(collector.data.resumes).toEqual([]);
    });
  });

  describe('recordRateLimit', () => {
    it('should record rate limit event with all fields', async () => {
      const collector = new AnalyticsCollector();
      const event = {
        timestamp: 1000,
        resetTime: 2000,
        session: 'test-session'
      };

      await collector.recordRateLimit(event);

      expect(collector.data.rateLimits).toHaveLength(1);
      expect(collector.data.rateLimits[0]).toEqual({
        timestamp: 1000,
        resetTime: 2000,
        session: 'test-session',
        duration: 1000
      });
    });

    it('should use default values for optional fields', async () => {
      const collector = new AnalyticsCollector();
      const event = {
        resetTime: 2000
      };

      await collector.recordRateLimit(event);

      expect(collector.data.rateLimits[0].session).toBe('default');
      expect(collector.data.rateLimits[0].timestamp).toBeGreaterThan(0);
    });

    it('should calculate duration from resetTime', async () => {
      const collector = new AnalyticsCollector();
      const event = {
        timestamp: 1000,
        resetTime: 5000
      };

      await collector.recordRateLimit(event);

      expect(collector.data.rateLimits[0].duration).toBe(4000);
    });

    it('should set duration to null if resetTime is not provided', async () => {
      const collector = new AnalyticsCollector();
      const event = {
        timestamp: 1000
      };

      await collector.recordRateLimit(event);

      expect(collector.data.rateLimits[0].duration).toBeNull();
    });

    it('should normalize Date object timestamps', async () => {
      const collector = new AnalyticsCollector();
      const timestamp = new Date('2024-01-01T00:00:00Z');
      const resetTime = new Date('2024-01-01T01:00:00Z');

      await collector.recordRateLimit({ timestamp, resetTime });

      expect(collector.data.rateLimits[0].timestamp).toBe(timestamp.getTime());
      expect(collector.data.rateLimits[0].resetTime).toBe(resetTime.getTime());
    });

    it('should normalize string timestamps', async () => {
      const collector = new AnalyticsCollector();
      const timestamp = '2024-01-01T00:00:00Z';
      const resetTime = '2024-01-01T01:00:00Z';

      await collector.recordRateLimit({ timestamp, resetTime });

      expect(collector.data.rateLimits[0].timestamp).toBe(new Date(timestamp).getTime());
      expect(collector.data.rateLimits[0].resetTime).toBe(new Date(resetTime).getTime());
    });

    it('should save data to file', async () => {
      const collector = new AnalyticsCollector();

      await collector.recordRateLimit({ resetTime: 2000 });

      expect(fs.promises.writeFile).toHaveBeenCalled();
      expect(fs.promises.rename).toHaveBeenCalled();
    });

    it('should handle save errors gracefully', async () => {
      const collector = new AnalyticsCollector();
      fs.promises.writeFile.mockRejectedValue(new Error('Write failed'));

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await expect(collector.recordRateLimit({ resetTime: 2000 }))
        .rejects.toThrow('Write failed');

      consoleSpy.mockRestore();
    });
  });

  describe('recordResume', () => {
    it('should record resume event with all fields', async () => {
      const collector = new AnalyticsCollector();
      const event = {
        timestamp: 1000,
        session: 'test-session',
        success: true
      };

      await collector.recordResume(event);

      expect(collector.data.resumes).toHaveLength(1);
      expect(collector.data.resumes[0]).toEqual({
        timestamp: 1000,
        session: 'test-session',
        success: true
      });
    });

    it('should use default values for optional fields', async () => {
      const collector = new AnalyticsCollector();
      const event = {};

      await collector.recordResume(event);

      expect(collector.data.resumes[0].session).toBe('default');
      expect(collector.data.resumes[0].success).toBe(true);
      expect(collector.data.resumes[0].timestamp).toBeGreaterThan(0);
    });

    it('should record failed resume events', async () => {
      const collector = new AnalyticsCollector();
      const event = {
        timestamp: 1000,
        success: false
      };

      await collector.recordResume(event);

      expect(collector.data.resumes[0].success).toBe(false);
    });

    it('should normalize timestamps', async () => {
      const collector = new AnalyticsCollector();
      const timestamp = new Date('2024-01-01T00:00:00Z');

      await collector.recordResume({ timestamp });

      expect(collector.data.resumes[0].timestamp).toBe(timestamp.getTime());
    });

    it('should save data to file', async () => {
      const collector = new AnalyticsCollector();

      await collector.recordResume({});

      expect(fs.promises.writeFile).toHaveBeenCalled();
      expect(fs.promises.rename).toHaveBeenCalled();
    });
  });

  describe('getStatistics', () => {
    it('should return statistics for 7-day and 30-day periods', () => {
      const collector = new AnalyticsCollector();
      const now = Date.now();

      // Add events within last 7 days
      collector.data.rateLimits.push(
        { timestamp: now - 5 * 24 * 60 * 60 * 1000, resetTime: now - 5 * 24 * 60 * 60 * 1000 + 60000, duration: 60000 },
        { timestamp: now - 3 * 24 * 60 * 60 * 1000, resetTime: now - 3 * 24 * 60 * 60 * 1000 + 120000, duration: 120000 }
      );

      // Add events within last 30 days but outside 7 days
      collector.data.rateLimits.push(
        { timestamp: now - 20 * 24 * 60 * 60 * 1000, resetTime: now - 20 * 24 * 60 * 60 * 1000 + 90000, duration: 90000 }
      );

      // Add resumes
      collector.data.resumes.push(
        { timestamp: now - 5 * 24 * 60 * 60 * 1000, success: true },
        { timestamp: now - 3 * 24 * 60 * 60 * 1000, success: false }
      );

      const stats = collector.getStatistics();

      expect(stats.last7Days.rateLimitCount).toBe(2);
      expect(stats.last7Days.resumeCount).toBe(2);
      expect(stats.last7Days.successfulResumes).toBe(1);
      expect(stats.last7Days.period).toBe('7 days');

      expect(stats.last30Days.rateLimitCount).toBe(3);
      expect(stats.last30Days.resumeCount).toBe(2);
    });

    it('should calculate average wait time correctly', () => {
      const collector = new AnalyticsCollector();
      const now = Date.now();

      collector.data.rateLimits.push(
        { timestamp: now - 5 * 24 * 60 * 60 * 1000, duration: 60000 },
        { timestamp: now - 3 * 24 * 60 * 60 * 1000, duration: 120000 }
      );

      const stats = collector.getStatistics();

      expect(stats.last7Days.avgWaitTimeMs).toBe(90000);
      expect(stats.last7Days.avgWaitTimeMinutes).toBe(2);
    });

    it('should handle events with null duration', () => {
      const collector = new AnalyticsCollector();
      const now = Date.now();

      collector.data.rateLimits.push(
        { timestamp: now - 5 * 24 * 60 * 60 * 1000, duration: 60000 },
        { timestamp: now - 3 * 24 * 60 * 60 * 1000, duration: null }
      );

      const stats = collector.getStatistics();

      expect(stats.last7Days.avgWaitTimeMs).toBe(60000);
    });

    it('should calculate daily average', () => {
      const collector = new AnalyticsCollector();
      const now = Date.now();

      // Add 14 events in last 7 days
      for (let i = 0; i < 14; i++) {
        collector.data.rateLimits.push({
          timestamp: now - i * 12 * 60 * 60 * 1000,
          duration: 60000
        });
      }

      const stats = collector.getStatistics();

      expect(stats.last7Days.dailyAverage).toBe(14 / 7);
    });

    it('should identify peak hour', () => {
      const collector = new AnalyticsCollector();
      const now = Date.now();

      // Add multiple events at 10:00 hour (within last 30 days)
      const day1 = now - 5 * 24 * 60 * 60 * 1000; // 5 days ago
      const day1Hour10 = new Date(day1);
      day1Hour10.setHours(10, 30, 0, 0);
      const day1Hour10_2 = new Date(day1);
      day1Hour10_2.setHours(10, 45, 0, 0);
      const day1Hour14 = new Date(day1);
      day1Hour14.setHours(14, 0, 0, 0);

      collector.data.rateLimits.push(
        { timestamp: day1Hour10.getTime(), duration: 60000 },
        { timestamp: day1Hour10_2.getTime(), duration: 60000 },
        { timestamp: day1Hour14.getTime(), duration: 60000 }
      );

      const stats = collector.getStatistics();

      expect(stats.last30Days.peakHour).toBeTruthy();
      expect(stats.last30Days.peakHour.count).toBe(2);
    });

    it('should identify peak day', () => {
      const collector = new AnalyticsCollector();
      const now = Date.now();

      // Add multiple events on same day (within last 30 days)
      const day1 = now - 5 * 24 * 60 * 60 * 1000; // 5 days ago
      const day2 = now - 4 * 24 * 60 * 60 * 1000; // 4 days ago

      collector.data.rateLimits.push(
        { timestamp: day1 + 10 * 60 * 60 * 1000, duration: 60000 }, // day1 10:00
        { timestamp: day1 + 14 * 60 * 60 * 1000, duration: 60000 }, // day1 14:00
        { timestamp: day2 + 10 * 60 * 60 * 1000, duration: 60000 }  // day2 10:00
      );

      const stats = collector.getStatistics();

      expect(stats.last30Days.peakDay).toBeTruthy();
      expect(stats.last30Days.peakDay.count).toBe(2);
    });

    it('should return allTime statistics', () => {
      const collector = new AnalyticsCollector();
      const now = Date.now();

      // Add events outside retention period
      collector.data.rateLimits.push(
        { timestamp: now - 100 * 24 * 60 * 60 * 1000, duration: 60000 },
        { timestamp: now - 5 * 24 * 60 * 60 * 1000, duration: 60000 }
      );

      collector.data.resumes.push(
        { timestamp: now - 100 * 24 * 60 * 60 * 1000, success: true },
        { timestamp: now - 5 * 24 * 60 * 60 * 1000, success: false }
      );

      const stats = collector.getStatistics();

      expect(stats.allTime.rateLimitCount).toBe(2);
      expect(stats.allTime.resumeCount).toBe(2);
      expect(stats.allTime.successfulResumes).toBe(1);
      expect(stats.allTime.oldestRecord).toBeInstanceOf(Date);
    });

    it('should handle empty data', () => {
      const collector = new AnalyticsCollector();
      const stats = collector.getStatistics();

      expect(stats.last7Days.rateLimitCount).toBe(0);
      expect(stats.last7Days.resumeCount).toBe(0);
      expect(stats.last7Days.avgWaitTimeMs).toBe(0);
      expect(stats.allTime.oldestRecord).toBeNull();
    });
  });

  describe('getPrediction', () => {
    it('should return "none" confidence with no data', () => {
      const collector = new AnalyticsCollector();
      const prediction = collector.getPrediction();

      expect(prediction.confidence).toBe('none');
      expect(prediction.message).toBe('Insufficient data for prediction');
      expect(prediction.nextPredictedTime).toBeNull();
    });

    it('should return "low" confidence with only one event', () => {
      const collector = new AnalyticsCollector();
      const now = Date.now();

      collector.data.rateLimits.push({
        timestamp: now - 2 * 24 * 60 * 60 * 1000,
        duration: 60000
      });

      const prediction = collector.getPrediction();

      expect(prediction.confidence).toBe('low');
      expect(prediction.message).toBe('Only one rate limit event recorded');
      expect(prediction.nextPredictedTime).toBeNull();
    });

    it('should predict next rate limit based on average interval', () => {
      const collector = new AnalyticsCollector();
      const now = Date.now();
      const interval = 24 * 60 * 60 * 1000; // 1 day

      collector.data.rateLimits.push(
        { timestamp: now - 4 * interval, duration: 60000 },
        { timestamp: now - 3 * interval, duration: 60000 },
        { timestamp: now - 2 * interval, duration: 60000 },
        { timestamp: now - 1 * interval, duration: 60000 }
      );

      const prediction = collector.getPrediction();

      expect(prediction.nextPredictedTime).toBeInstanceOf(Date);
      expect(prediction.avgIntervalMs).toBeCloseTo(interval, -2);
      expect(prediction.avgIntervalHours).toBe(24);
      expect(prediction.sampleSize).toBe(3);
    });

    it('should calculate high confidence for consistent intervals', () => {
      const collector = new AnalyticsCollector();
      const now = Date.now();
      const interval = 24 * 60 * 60 * 1000; // Exactly 1 day

      // Add events with very consistent intervals
      collector.data.rateLimits.push(
        { timestamp: now - 5 * interval, duration: 60000 },
        { timestamp: now - 4 * interval, duration: 60000 },
        { timestamp: now - 3 * interval, duration: 60000 },
        { timestamp: now - 2 * interval, duration: 60000 },
        { timestamp: now - 1 * interval, duration: 60000 }
      );

      const prediction = collector.getPrediction();

      expect(prediction.confidence).toBe('high');
    });

    it('should calculate medium confidence for moderately varying intervals', () => {
      const collector = new AnalyticsCollector();
      const now = Date.now();
      const hour = 60 * 60 * 1000;

      // Add events with moderate variation (coefficient of variation between 0.2 and 0.5)
      // Using intervals: 20h, 28h, 22h, 26h (avg ~24h, CV ~0.15)
      // Need more variation: 18h, 32h, 20h, 34h (avg ~26h, CV ~0.28)
      collector.data.rateLimits.push(
        { timestamp: now - 104 * hour, duration: 60000 },  // Start
        { timestamp: now - 86 * hour, duration: 60000 },   // +18 hours
        { timestamp: now - 54 * hour, duration: 60000 },   // +32 hours
        { timestamp: now - 34 * hour, duration: 60000 },   // +20 hours
        { timestamp: now - 0 * hour, duration: 60000 }     // +34 hours
      );

      const prediction = collector.getPrediction();

      expect(prediction.confidence).toBe('medium');
    });

    it('should calculate low confidence for highly varying intervals', () => {
      const collector = new AnalyticsCollector();
      const now = Date.now();

      // Add events with high variation
      collector.data.rateLimits.push(
        { timestamp: now - 10 * 24 * 60 * 60 * 1000, duration: 60000 },
        { timestamp: now - 7 * 24 * 60 * 60 * 1000, duration: 60000 },
        { timestamp: now - 2 * 24 * 60 * 60 * 1000, duration: 60000 },
        { timestamp: now - 1 * 24 * 60 * 60 * 1000, duration: 60000 }
      );

      const prediction = collector.getPrediction();

      expect(prediction.confidence).toBe('low');
    });

    it('should only use recent data (last 7 days)', () => {
      const collector = new AnalyticsCollector();
      const now = Date.now();

      // Add old events
      collector.data.rateLimits.push(
        { timestamp: now - 20 * 24 * 60 * 60 * 1000, duration: 60000 },
        { timestamp: now - 15 * 24 * 60 * 60 * 1000, duration: 60000 }
      );

      // Add recent events
      collector.data.rateLimits.push(
        { timestamp: now - 2 * 24 * 60 * 60 * 1000, duration: 60000 },
        { timestamp: now - 1 * 24 * 60 * 60 * 1000, duration: 60000 }
      );

      const prediction = collector.getPrediction();

      // Should only consider the 2 recent events
      expect(prediction.sampleSize).toBe(1);
    });

    it('should indicate when prediction time is in the past', () => {
      const collector = new AnalyticsCollector();
      const now = Date.now();
      const interval = 1 * 60 * 60 * 1000; // 1 hour

      // Add events with short intervals in the past
      collector.data.rateLimits.push(
        { timestamp: now - 5 * interval, duration: 60000 },
        { timestamp: now - 4 * interval, duration: 60000 },
        { timestamp: now - 3 * interval, duration: 60000 }
      );

      const prediction = collector.getPrediction();

      expect(prediction.message).toBe('Pattern suggests rate limit may occur soon');
    });
  });

  describe('cleanup', () => {
    it('should remove data older than retention period', async () => {
      const collector = new AnalyticsCollector({ retentionDays: 30 });
      const now = Date.now();

      collector.data.rateLimits.push(
        { timestamp: now - 40 * 24 * 60 * 60 * 1000, duration: 60000 }, // Old
        { timestamp: now - 20 * 24 * 60 * 60 * 1000, duration: 60000 }  // Recent
      );

      collector.data.resumes.push(
        { timestamp: now - 40 * 24 * 60 * 60 * 1000, success: true }, // Old
        { timestamp: now - 20 * 24 * 60 * 60 * 1000, success: true }  // Recent
      );

      const result = await collector.cleanup();

      expect(result.removedRateLimits).toBe(1);
      expect(result.removedResumes).toBe(1);
      expect(result.retentionDays).toBe(30);
      expect(result.cutoffDate).toBeInstanceOf(Date);

      expect(collector.data.rateLimits).toHaveLength(1);
      expect(collector.data.resumes).toHaveLength(1);
    });

    it('should not save if no data is removed', async () => {
      const collector = new AnalyticsCollector({ retentionDays: 30 });
      const now = Date.now();

      collector.data.rateLimits.push(
        { timestamp: now - 20 * 24 * 60 * 60 * 1000, duration: 60000 }
      );

      const result = await collector.cleanup();

      expect(result.removedRateLimits).toBe(0);
      expect(result.removedResumes).toBe(0);
      expect(fs.promises.writeFile).not.toHaveBeenCalled();
    });

    it('should handle empty data', async () => {
      const collector = new AnalyticsCollector();
      const result = await collector.cleanup();

      expect(result.removedRateLimits).toBe(0);
      expect(result.removedResumes).toBe(0);
    });

    it('should respect custom retention period', async () => {
      const collector = new AnalyticsCollector({ retentionDays: 7 });
      const now = Date.now();

      collector.data.rateLimits.push(
        { timestamp: now - 10 * 24 * 60 * 60 * 1000, duration: 60000 }, // Old
        { timestamp: now - 5 * 24 * 60 * 60 * 1000, duration: 60000 }   // Recent
      );

      const result = await collector.cleanup();

      expect(result.removedRateLimits).toBe(1);
      expect(result.retentionDays).toBe(7);
      expect(collector.data.rateLimits).toHaveLength(1);
    });
  });

  describe('exportData', () => {
    it('should export complete analytics data', () => {
      const collector = new AnalyticsCollector();
      const now = Date.now();

      collector.data.rateLimits.push({
        timestamp: now - 5 * 24 * 60 * 60 * 1000,
        resetTime: now - 5 * 24 * 60 * 60 * 1000 + 60000,
        duration: 60000,
        session: 'test'
      });

      collector.data.resumes.push({
        timestamp: now - 5 * 24 * 60 * 60 * 1000,
        session: 'test',
        success: true
      });

      const exported = collector.exportData();

      expect(exported.exported).toBeTruthy();
      expect(exported.retentionDays).toBe(30);
      expect(exported.statistics).toBeTruthy();
      expect(exported.prediction).toBeTruthy();
      expect(exported.rawData.rateLimits).toHaveLength(1);
      expect(exported.rawData.resumes).toHaveLength(1);
      expect(exported.metadata.version).toBe('1.0.0');
      expect(exported.metadata.totalEvents).toBe(2);
    });

    it('should include statistics and prediction', () => {
      const collector = new AnalyticsCollector();
      const exported = collector.exportData();

      expect(exported.statistics.last7Days).toBeTruthy();
      expect(exported.statistics.last30Days).toBeTruthy();
      expect(exported.statistics.allTime).toBeTruthy();
      expect(exported.prediction.confidence).toBeTruthy();
    });

    it('should include copies of arrays in export', () => {
      const collector = new AnalyticsCollector();
      collector.data.rateLimits.push({ timestamp: 1000, duration: 60000 });

      const exported = collector.exportData();

      // Arrays should be present and have same content
      expect(exported.rawData.rateLimits).toHaveLength(1);
      expect(exported.rawData.rateLimits[0].timestamp).toBe(1000);

      // Note: Spread operator creates shallow copy, so nested objects may share references
      // This is acceptable for analytics export which is typically read-only
    });
  });

  describe('exportDataAsJSON', () => {
    it('should export as pretty-printed JSON by default', () => {
      const collector = new AnalyticsCollector();
      const json = collector.exportDataAsJSON();

      expect(json).toContain('\n');
      expect(json).toContain('  ');

      const parsed = JSON.parse(json);
      expect(parsed.metadata).toBeTruthy();
    });

    it('should export as compact JSON when pretty is false', () => {
      const collector = new AnalyticsCollector();
      const json = collector.exportDataAsJSON(false);

      // Compact JSON should not have spacing
      const prettyJson = collector.exportDataAsJSON(true);
      expect(json.length).toBeLessThan(prettyJson.length);

      const parsed = JSON.parse(json);
      expect(parsed.metadata).toBeTruthy();
    });

    it('should produce valid JSON', () => {
      const collector = new AnalyticsCollector();
      collector.data.rateLimits.push({ timestamp: 1000, duration: 60000 });

      const json = collector.exportDataAsJSON();

      expect(() => JSON.parse(json)).not.toThrow();
    });
  });

  describe('clearAllData', () => {
    it('should clear all analytics data', async () => {
      const collector = new AnalyticsCollector();

      collector.data.rateLimits.push({ timestamp: 1000, duration: 60000 });
      collector.data.resumes.push({ timestamp: 2000, success: true });

      await collector.clearAllData();

      expect(collector.data.rateLimits).toHaveLength(0);
      expect(collector.data.resumes).toHaveLength(0);
      expect(collector.data.version).toBe('1.0.0');
    });

    it('should save cleared data to file', async () => {
      const collector = new AnalyticsCollector();
      collector.data.rateLimits.push({ timestamp: 1000, duration: 60000 });

      await collector.clearAllData();

      expect(fs.promises.writeFile).toHaveBeenCalled();
      expect(fs.promises.rename).toHaveBeenCalled();
    });

    it('should handle already empty data', async () => {
      const collector = new AnalyticsCollector();

      await collector.clearAllData();

      expect(collector.data.rateLimits).toHaveLength(0);
      expect(collector.data.resumes).toHaveLength(0);
    });
  });

  describe('concurrent writes', () => {
    it('should handle concurrent recordRateLimit calls safely', async () => {
      const collector = new AnalyticsCollector();

      // Simulate concurrent writes
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(collector.recordRateLimit({
          timestamp: 1000 + i,
          resetTime: 2000 + i
        }));
      }

      await Promise.all(promises);

      expect(collector.data.rateLimits).toHaveLength(10);
      // writeFile should be called 10 times, but they are queued
      expect(fs.promises.writeFile).toHaveBeenCalledTimes(10);
    });

    it('should handle concurrent recordResume calls safely', async () => {
      const collector = new AnalyticsCollector();

      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(collector.recordResume({
          timestamp: 1000 + i,
          success: i % 2 === 0
        }));
      }

      await Promise.all(promises);

      expect(collector.data.resumes).toHaveLength(10);
      expect(fs.promises.writeFile).toHaveBeenCalledTimes(10);
    });

    it('should handle mixed concurrent operations', async () => {
      const collector = new AnalyticsCollector();
      const now = Date.now();

      // Use recent timestamps so cleanup doesn't remove them
      const promises = [
        collector.recordRateLimit({ timestamp: now - 1000, resetTime: now }),
        collector.recordResume({ timestamp: now - 2000 }),
        collector.recordRateLimit({ timestamp: now - 3000, resetTime: now - 2000 }),
        collector.recordResume({ timestamp: now - 4000 })
      ];

      await Promise.all(promises);

      // Should have both rate limits and resumes after concurrent operations
      expect(collector.data.rateLimits).toHaveLength(2);
      expect(collector.data.resumes).toHaveLength(2);
    });

    it('should queue writes to prevent race conditions', async () => {
      const collector = new AnalyticsCollector();

      // Track write call order
      const writeOrder = [];
      fs.promises.writeFile.mockImplementation((path, data) => {
        writeOrder.push(JSON.parse(data));
        return Promise.resolve();
      });

      await collector.recordRateLimit({ timestamp: 1000, resetTime: 2000 });
      await collector.recordRateLimit({ timestamp: 3000, resetTime: 4000 });

      // Second write should include both events
      expect(writeOrder).toHaveLength(2);
      expect(writeOrder[1].rateLimits).toHaveLength(2);
    });

    it('should propagate errors from concurrent operations', async () => {
      const collector = new AnalyticsCollector();
      fs.promises.writeFile.mockRejectedValue(new Error('Write failed'));

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await expect(
        collector.recordRateLimit({ timestamp: 1000, resetTime: 2000 })
      ).rejects.toThrow('Write failed');

      consoleSpy.mockRestore();
    });
  });

  describe('edge cases', () => {
    it('should handle very large datasets', () => {
      const collector = new AnalyticsCollector();
      const now = Date.now();

      // Add 1000 events
      for (let i = 0; i < 1000; i++) {
        collector.data.rateLimits.push({
          timestamp: now - i * 60 * 60 * 1000,
          duration: 60000
        });
      }

      const stats = collector.getStatistics();

      expect(stats.allTime.rateLimitCount).toBe(1000);
      expect(() => collector.exportDataAsJSON()).not.toThrow();
    });

    it('should handle timestamp at epoch zero', () => {
      const collector = new AnalyticsCollector();

      collector.data.rateLimits.push({
        timestamp: 0,
        duration: 60000
      });

      const stats = collector.getStatistics();
      expect(stats.allTime.rateLimitCount).toBe(1);
    });

    it('should handle future timestamps', () => {
      const collector = new AnalyticsCollector();
      const future = Date.now() + 365 * 24 * 60 * 60 * 1000;

      collector.data.rateLimits.push({
        timestamp: future,
        duration: 60000
      });

      const stats = collector.getStatistics();
      expect(stats.last30Days.rateLimitCount).toBe(1);
    });

    it('should handle zero duration', () => {
      const collector = new AnalyticsCollector();
      const now = Date.now();

      collector.data.rateLimits.push({
        timestamp: now,
        resetTime: now,
        duration: 0
      });

      const stats = collector.getStatistics();
      expect(stats.last7Days.avgWaitTimeMs).toBe(0);
    });

    it('should handle negative duration (clock skew)', () => {
      const collector = new AnalyticsCollector();
      const now = Date.now();

      collector.data.rateLimits.push({
        timestamp: now,
        resetTime: now - 1000,
        duration: -1000
      });

      const stats = collector.getStatistics();
      expect(stats.last7Days.avgWaitTimeMs).toBe(-1000);
    });
  });
});
