const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Analytics Collector for AutoClaudeResume
 * Tracks rate limit events, resume events, and provides statistical analysis
 */
class AnalyticsCollector {
  /**
   * Creates an AnalyticsCollector instance
   * @param {object} config - Configuration object
   * @param {number} config.retentionDays - Days to retain data (default: 30)
   * @param {string} config.dataPath - Path to analytics data file (optional)
   */
  constructor(config = {}) {
    this.retentionDays = config.retentionDays || 30;
    this.dataPath = config.dataPath || this._getDefaultDataPath();
    this.data = this._loadData();
    this.writeLock = Promise.resolve();
  }

  /**
   * Gets the default analytics data file path
   * @returns {string} Path to analytics.json
   * @private
   */
  _getDefaultDataPath() {
    const analyticsDir = path.join(os.homedir(), '.claude', 'auto-resume');
    if (!fs.existsSync(analyticsDir)) {
      fs.mkdirSync(analyticsDir, { recursive: true });
    }
    return path.join(analyticsDir, 'analytics.json');
  }

  /**
   * Loads analytics data from file
   * @returns {object} Analytics data structure
   * @private
   */
  _loadData() {
    try {
      if (fs.existsSync(this.dataPath)) {
        const rawData = fs.readFileSync(this.dataPath, 'utf8');
        const data = JSON.parse(rawData);

        // Validate and initialize structure
        return {
          rateLimits: Array.isArray(data.rateLimits) ? data.rateLimits : [],
          resumes: Array.isArray(data.resumes) ? data.resumes : [],
          version: data.version || '1.0.0'
        };
      }
    } catch (error) {
      console.error(`Failed to load analytics data: ${error.message}`);
    }

    // Return empty structure if load failed or file doesn't exist
    return {
      rateLimits: [],
      resumes: [],
      version: '1.0.0'
    };
  }

  /**
   * Saves analytics data to file with concurrent write protection
   * @private
   */
  async _saveData() {
    // Queue writes to prevent concurrent access issues
    this.writeLock = this.writeLock.then(async () => {
      try {
        const tempPath = `${this.dataPath}.tmp`;
        const jsonData = JSON.stringify(this.data, null, 2);

        // Write to temp file first
        await fs.promises.writeFile(tempPath, jsonData, 'utf8');

        // Atomic rename (on most systems)
        await fs.promises.rename(tempPath, this.dataPath);
      } catch (error) {
        console.error(`Failed to save analytics data: ${error.message}`);
        throw error;
      }
    });

    return this.writeLock;
  }

  /**
   * Records a rate limit event
   * @param {object} event - Rate limit event
   * @param {number|Date} event.timestamp - When rate limit occurred
   * @param {number|Date} event.resetTime - When rate limit resets
   * @param {string} event.session - Session identifier (optional)
   * @returns {Promise<void>}
   */
  async recordRateLimit(event) {
    const record = {
      timestamp: this._normalizeTimestamp(event.timestamp || Date.now()),
      resetTime: this._normalizeTimestamp(event.resetTime),
      session: event.session || 'default',
      duration: null
    };

    // Calculate duration if resetTime is provided
    if (record.resetTime) {
      record.duration = record.resetTime - record.timestamp;
    }

    this.data.rateLimits.push(record);
    await this._saveData();
  }

  /**
   * Records a resume event
   * @param {object} event - Resume event
   * @param {number|Date} event.timestamp - When resume occurred
   * @param {string} event.session - Session identifier (optional)
   * @param {boolean} event.success - Whether resume was successful (optional)
   * @returns {Promise<void>}
   */
  async recordResume(event) {
    const record = {
      timestamp: this._normalizeTimestamp(event.timestamp || Date.now()),
      session: event.session || 'default',
      success: event.success !== undefined ? event.success : true
    };

    this.data.resumes.push(record);
    await this._saveData();
  }

  /**
   * Normalizes timestamp to milliseconds since epoch
   * @param {number|Date|string} timestamp - Timestamp to normalize
   * @returns {number} Milliseconds since epoch
   * @private
   */
  _normalizeTimestamp(timestamp) {
    if (timestamp instanceof Date) {
      return timestamp.getTime();
    }
    if (typeof timestamp === 'string') {
      return new Date(timestamp).getTime();
    }
    return Number(timestamp);
  }

  /**
   * Filters events by time range
   * @param {Array} events - Array of events
   * @param {number} days - Number of days to look back
   * @returns {Array} Filtered events
   * @private
   */
  _filterByTimeRange(events, days) {
    const cutoffTime = Date.now() - (days * 24 * 60 * 60 * 1000);
    return events.filter(event => event.timestamp >= cutoffTime);
  }

  /**
   * Groups events by time period
   * @param {Array} events - Array of events with timestamps
   * @param {string} period - 'hour' or 'day'
   * @returns {object} Grouped events { periodKey: count }
   * @private
   */
  _groupByPeriod(events, period = 'day') {
    const groups = {};

    events.forEach(event => {
      const date = new Date(event.timestamp);
      let key;

      if (period === 'hour') {
        key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:00`;
      } else {
        key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      }

      groups[key] = (groups[key] || 0) + 1;
    });

    return groups;
  }

  /**
   * Calculates statistics for a time range
   * @param {number} days - Number of days to analyze
   * @returns {object} Statistics object
   * @private
   */
  _calculateStats(days) {
    const rateLimits = this._filterByTimeRange(this.data.rateLimits, days);
    const resumes = this._filterByTimeRange(this.data.resumes, days);

    // Calculate average wait time
    const durationsWithData = rateLimits.filter(rl => rl.duration !== null);
    const avgWaitTime = durationsWithData.length > 0
      ? durationsWithData.reduce((sum, rl) => sum + rl.duration, 0) / durationsWithData.length
      : 0;

    // Find peak hours
    const hourlyRateLimits = this._groupByPeriod(rateLimits, 'hour');
    const peakHour = Object.entries(hourlyRateLimits)
      .sort((a, b) => b[1] - a[1])[0];

    // Find peak days
    const dailyRateLimits = this._groupByPeriod(rateLimits, 'day');
    const peakDay = Object.entries(dailyRateLimits)
      .sort((a, b) => b[1] - a[1])[0];

    return {
      period: `${days} days`,
      rateLimitCount: rateLimits.length,
      resumeCount: resumes.length,
      successfulResumes: resumes.filter(r => r.success).length,
      avgWaitTimeMs: Math.round(avgWaitTime),
      avgWaitTimeMinutes: Math.round(avgWaitTime / 60000),
      dailyAverage: rateLimits.length / days,
      peakHour: peakHour ? { time: peakHour[0], count: peakHour[1] } : null,
      peakDay: peakDay ? { date: peakDay[0], count: peakDay[1] } : null,
      hourlyDistribution: hourlyRateLimits,
      dailyDistribution: dailyRateLimits
    };
  }

  /**
   * Gets aggregated statistics
   * @returns {object} Statistics for different time periods
   */
  getStatistics() {
    return {
      last7Days: this._calculateStats(7),
      last30Days: this._calculateStats(30),
      allTime: {
        rateLimitCount: this.data.rateLimits.length,
        resumeCount: this.data.resumes.length,
        successfulResumes: this.data.resumes.filter(r => r.success).length,
        oldestRecord: this.data.rateLimits.length > 0
          ? new Date(Math.min(...this.data.rateLimits.map(rl => rl.timestamp)))
          : null
      }
    };
  }

  /**
   * Predicts next rate limit based on historical patterns
   * @returns {object} Prediction data
   */
  getPrediction() {
    const recentRateLimits = this._filterByTimeRange(this.data.rateLimits, 7);

    if (recentRateLimits.length === 0) {
      return {
        confidence: 'none',
        message: 'Insufficient data for prediction',
        nextPredictedTime: null
      };
    }

    // Sort by timestamp
    recentRateLimits.sort((a, b) => a.timestamp - b.timestamp);

    // Calculate average interval between rate limits
    const intervals = [];
    for (let i = 1; i < recentRateLimits.length; i++) {
      intervals.push(recentRateLimits[i].timestamp - recentRateLimits[i - 1].timestamp);
    }

    if (intervals.length === 0) {
      return {
        confidence: 'low',
        message: 'Only one rate limit event recorded',
        nextPredictedTime: null
      };
    }

    const avgInterval = intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length;
    const lastRateLimit = recentRateLimits[recentRateLimits.length - 1];
    const predictedTime = lastRateLimit.timestamp + avgInterval;

    // Calculate confidence based on interval consistency
    const variance = intervals.reduce((sum, interval) => {
      return sum + Math.pow(interval - avgInterval, 2);
    }, 0) / intervals.length;
    const stdDev = Math.sqrt(variance);
    const coefficientOfVariation = stdDev / avgInterval;

    let confidence;
    if (coefficientOfVariation < 0.2) {
      confidence = 'high';
    } else if (coefficientOfVariation < 0.5) {
      confidence = 'medium';
    } else {
      confidence = 'low';
    }

    return {
      confidence,
      nextPredictedTime: new Date(predictedTime),
      avgIntervalMs: Math.round(avgInterval),
      avgIntervalHours: Math.round(avgInterval / (1000 * 60 * 60) * 10) / 10,
      sampleSize: intervals.length,
      message: predictedTime > Date.now()
        ? `Next rate limit predicted around ${new Date(predictedTime).toLocaleString()}`
        : 'Pattern suggests rate limit may occur soon'
    };
  }

  /**
   * Removes data older than retention period
   * @returns {Promise<object>} Cleanup results
   */
  async cleanup() {
    const cutoffTime = Date.now() - (this.retentionDays * 24 * 60 * 60 * 1000);

    const initialRateLimitCount = this.data.rateLimits.length;
    const initialResumeCount = this.data.resumes.length;

    this.data.rateLimits = this.data.rateLimits.filter(
      event => event.timestamp >= cutoffTime
    );
    this.data.resumes = this.data.resumes.filter(
      event => event.timestamp >= cutoffTime
    );

    const removedRateLimits = initialRateLimitCount - this.data.rateLimits.length;
    const removedResumes = initialResumeCount - this.data.resumes.length;

    if (removedRateLimits > 0 || removedResumes > 0) {
      await this._saveData();
    }

    return {
      removedRateLimits,
      removedResumes,
      retentionDays: this.retentionDays,
      cutoffDate: new Date(cutoffTime)
    };
  }

  /**
   * Exports all analytics data
   * @returns {object} Complete analytics data
   */
  exportData() {
    return {
      exported: new Date().toISOString(),
      retentionDays: this.retentionDays,
      statistics: this.getStatistics(),
      prediction: this.getPrediction(),
      rawData: {
        rateLimits: [...this.data.rateLimits],
        resumes: [...this.data.resumes]
      },
      metadata: {
        version: this.data.version,
        totalEvents: this.data.rateLimits.length + this.data.resumes.length
      }
    };
  }

  /**
   * Exports data as JSON string
   * @param {boolean} pretty - Whether to pretty-print JSON
   * @returns {string} JSON string
   */
  exportDataAsJSON(pretty = true) {
    return JSON.stringify(this.exportData(), null, pretty ? 2 : 0);
  }

  /**
   * Clears all analytics data
   * @returns {Promise<void>}
   */
  async clearAllData() {
    this.data = {
      rateLimits: [],
      resumes: [],
      version: '1.0.0'
    };
    await this._saveData();
  }
}

module.exports = AnalyticsCollector;
