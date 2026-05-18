const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');

let hmacIntegrity = null;
try {
  hmacIntegrity = require('./hmac-integrity');
} catch {}

const BASE_DIR = path.join(os.homedir(), '.claude', 'auto-resume');
const STATUS_FILE = path.join(BASE_DIR, 'status.json');
const HEARTBEAT_FILE = path.join(BASE_DIR, 'heartbeat.json');

class MetricsServer {
  constructor(config = {}) {
    this.port = config.port || 9199;
    this.logger = config.logger || console;
    this.server = null;
    this.isRunning = false;
    this._counters = {
      rate_limits_detected: 0,
      resumes_attempted: 0,
      resumes_succeeded: 0,
      resumes_failed: 0,
      hook_fires: 0
    };
    this._startTime = Date.now();
  }

  increment(counter, amount = 1) {
    if (counter in this._counters) {
      this._counters[counter] += amount;
    }
  }

  async start() {
    if (this.isRunning) return;

    this.server = http.createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/metrics') {
        this._handleMetrics(res);
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });

    await new Promise((resolve, reject) => {
      this.server.listen(this.port, '127.0.0.1', (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    this.isRunning = true;
    this._log('info', `Metrics server started on http://127.0.0.1:${this.port}/metrics`);
  }

  async stop() {
    if (!this.isRunning || !this.server) return;
    await new Promise((resolve) => {
      this.server.close(() => resolve());
    });
    this.server = null;
    this.isRunning = false;
  }

  _handleMetrics(res) {
    const lines = [];
    const now = Date.now();

    lines.push('# HELP autoresume_daemon_uptime_seconds Daemon uptime in seconds');
    lines.push('# TYPE autoresume_daemon_uptime_seconds gauge');
    lines.push(`autoresume_daemon_uptime_seconds ${Math.floor((now - this._startTime) / 1000)}`);

    lines.push('# HELP autoresume_rate_limits_detected_total Total rate limits detected');
    lines.push('# TYPE autoresume_rate_limits_detected_total counter');
    lines.push(`autoresume_rate_limits_detected_total ${this._counters.rate_limits_detected}`);

    lines.push('# HELP autoresume_resumes_attempted_total Total resume attempts');
    lines.push('# TYPE autoresume_resumes_attempted_total counter');
    lines.push(`autoresume_resumes_attempted_total ${this._counters.resumes_attempted}`);

    lines.push('# HELP autoresume_resumes_succeeded_total Successful resumes');
    lines.push('# TYPE autoresume_resumes_succeeded_total counter');
    lines.push(`autoresume_resumes_succeeded_total ${this._counters.resumes_succeeded}`);

    lines.push('# HELP autoresume_resumes_failed_total Failed resumes');
    lines.push('# TYPE autoresume_resumes_failed_total counter');
    lines.push(`autoresume_resumes_failed_total ${this._counters.resumes_failed}`);

    lines.push('# HELP autoresume_hook_fires_total Total hook fires');
    lines.push('# TYPE autoresume_hook_fires_total counter');
    lines.push(`autoresume_hook_fires_total ${this._counters.hook_fires}`);

    const mem = process.memoryUsage();
    lines.push('# HELP autoresume_heap_used_bytes Heap memory used');
    lines.push('# TYPE autoresume_heap_used_bytes gauge');
    lines.push(`autoresume_heap_used_bytes ${mem.heapUsed}`);

    lines.push('# HELP autoresume_rss_bytes Resident set size');
    lines.push('# TYPE autoresume_rss_bytes gauge');
    lines.push(`autoresume_rss_bytes ${mem.rss}`);

    let isRateLimited = 0;
    let resetTimeRemaining = 0;
    try {
      if (fs.existsSync(STATUS_FILE)) {
        const status = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
        if (status.detected) {
          // Verify HMAC if available
          if (hmacIntegrity && status._hmac) {
            const { valid } = hmacIntegrity.verifyStatus(status);
            if (!valid) {
              // Tampered status — report as not rate limited
              isRateLimited = 0;
              resetTimeRemaining = 0;
            } else {
              isRateLimited = 1;
              const resetTime = new Date(status.reset_time);
              resetTimeRemaining = Math.max(0, Math.floor((resetTime - now) / 1000));
            }
          } else {
            isRateLimited = 1;
            const resetTime = new Date(status.reset_time);
            resetTimeRemaining = Math.max(0, Math.floor((resetTime - now) / 1000));
          }
        }
      }
    } catch {}

    lines.push('# HELP autoresume_rate_limited Is currently rate limited (0 or 1)');
    lines.push('# TYPE autoresume_rate_limited gauge');
    lines.push(`autoresume_rate_limited ${isRateLimited}`);

    lines.push('# HELP autoresume_reset_time_remaining_seconds Seconds until rate limit resets');
    lines.push('# TYPE autoresume_reset_time_remaining_seconds gauge');
    lines.push(`autoresume_reset_time_remaining_seconds ${resetTimeRemaining}`);

    let heartbeatAge = -1;
    try {
      if (fs.existsSync(HEARTBEAT_FILE)) {
        const data = JSON.parse(fs.readFileSync(HEARTBEAT_FILE, 'utf8'));
        heartbeatAge = Math.floor((now - data.timestamp) / 1000);
      }
    } catch {}

    lines.push('# HELP autoresume_heartbeat_age_seconds Seconds since last heartbeat');
    lines.push('# TYPE autoresume_heartbeat_age_seconds gauge');
    lines.push(`autoresume_heartbeat_age_seconds ${heartbeatAge}`);

    lines.push('');

    res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' });
    res.end(lines.join('\n'));
  }

  _log(level, message) {
    try {
      if (this.logger && typeof this.logger.log === 'function') {
        this.logger.log(level, `[MetricsServer] ${message}`);
      } else if (this.logger && typeof this.logger[level] === 'function') {
        this.logger[level](`[MetricsServer] ${message}`);
      }
    } catch {}
  }
}

module.exports = MetricsServer;
