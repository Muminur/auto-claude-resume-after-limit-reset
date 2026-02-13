const fs = require('fs');

async function verifyResumeByTranscript(opts) {
  const {
    transcriptPath,
    baselineMtime,
    baselineSize,
    timeoutMs = 15000,
    pollIntervalMs = 1000,
  } = opts;

  const startTime = Date.now();

  return new Promise((resolve) => {
    const check = () => {
      const elapsed = Date.now() - startTime;

      if (elapsed >= timeoutMs) {
        return resolve({ verified: false, newBytes: 0, elapsedMs: elapsed });
      }

      try {
        const stats = fs.statSync(transcriptPath);

        if (stats.size > baselineSize || stats.mtimeMs > baselineMtime) {
          return resolve({
            verified: true,
            newBytes: stats.size - baselineSize,
            elapsedMs: elapsed,
          });
        }
      } catch (err) {
        if (Date.now() - startTime >= timeoutMs) {
          return resolve({ verified: false, newBytes: 0, elapsedMs: elapsed });
        }
      }

      setTimeout(check, pollIntervalMs);
    };

    check();
  });
}

module.exports = { verifyResumeByTranscript };
