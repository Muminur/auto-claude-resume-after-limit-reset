const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class RateLimitQueue {
  constructor(statusFilePath) {
    this.statusFile = statusFilePath;
  }

  _read() {
    if (!fs.existsSync(this.statusFile)) {
      return { queue: [], last_hook_run: null };
    }

    try {
      const raw = fs.readFileSync(this.statusFile, 'utf8');
      const data = JSON.parse(raw);

      // Migrate old single-slot format to queue format
      if (!Array.isArray(data.queue)) {
        const migrated = { queue: [], last_hook_run: data.last_hook_run || null };

        if (data.detected && data.reset_time) {
          migrated.queue.push({
            id: crypto.randomUUID(),
            reset_time: data.reset_time,
            timezone: data.timezone || null,
            message: data.message || '',
            detected_at: data.last_detected || new Date().toISOString(),
            claude_pid: data.claude_pid || null,
            status: 'pending',
          });
        }

        return migrated;
      }

      return data;
    } catch (err) {
      return { queue: [], last_hook_run: null };
    }
  }

  _write(data) {
    const dir = path.dirname(this.statusFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.statusFile, JSON.stringify(data, null, 2), 'utf8');
  }

  addDetection(detection) {
    const data = this._read();

    const exists = data.queue.some(
      (entry) => entry.reset_time === detection.reset_time
    );
    if (exists) {
      return;
    }

    data.queue.push({
      id: crypto.randomUUID(),
      reset_time: detection.reset_time,
      timezone: detection.timezone || null,
      message: detection.message || '',
      detected_at: new Date().toISOString(),
      claude_pid: detection.claude_pid || null,
      status: 'pending',
    });

    data.last_hook_run = new Date().toISOString();
    this._write(data);
  }

  getNextPending() {
    const data = this._read();

    const pending = data.queue
      .filter((entry) => entry.status === 'pending' || entry.status === 'waiting')
      .sort((a, b) => new Date(a.reset_time) - new Date(b.reset_time));

    return pending.length > 0 ? pending[0] : null;
  }

  updateEntryStatus(id, status) {
    const data = this._read();
    const entry = data.queue.find((e) => e.id === id);
    if (entry) {
      entry.status = status;
      if (status === 'completed') {
        entry.completed_at = new Date().toISOString();
      }
      this._write(data);
    }
  }
}

module.exports = { RateLimitQueue };
