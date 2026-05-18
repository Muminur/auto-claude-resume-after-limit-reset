/**
 * HMAC Integrity Check for status.json
 *
 * Signs status data with HMAC-SHA256 using a per-installation secret.
 * Daemon verifies HMAC before processing status to prevent tampering.
 *
 * @module HmacIntegrity
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');

function getSecretPath() {
  return path.join(os.homedir(), '.claude', 'auto-resume', '.secret');
}

/**
 * Get or create the HMAC secret.
 * Creates a 32-byte random hex secret with mode 0o600 on first use.
 *
 * @returns {string} The hex-encoded secret
 */
function getOrCreateSecret() {
  const secretPath = getSecretPath();

  try {
    if (fs.existsSync(secretPath)) {
      return fs.readFileSync(secretPath, 'utf8').trim();
    }
  } catch (e) {
    // Failed to read existing secret — fall through to create new
    console.error(`[hmac-integrity] Failed to read existing secret, regenerating: ${e.message}`);
  }

  const secret = crypto.randomBytes(32).toString('hex');

  try {
    const dir = path.dirname(secretPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(secretPath, secret, { mode: 0o600 });
    // On Unix, also try chmod explicitly
    if (process.platform !== 'win32') {
      try { fs.chmodSync(secretPath, 0o600); } catch (e) { /* chmod failed — secret still usable but permissions may be loose */ }
    }
  } catch (e) {
    // If we can't persist the secret, still return for this session
    console.error(`[hmac-integrity] Failed to persist HMAC secret: ${e.message}`);
  }

  return secret;
}

/**
 * Compute HMAC for status data (excluding _hmac field).
 *
 * @param {Object} data - Status data object
 * @param {string} secret - HMAC secret
 * @returns {string} Hex-encoded HMAC
 */
function computeHmac(data, secret) {
  // Remove _hmac field for computation
  const { _hmac, ...cleanData } = data;
  const payload = JSON.stringify(cleanData);
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Sign status data by adding _hmac field.
 *
 * @param {Object} statusData - Status data to sign
 * @returns {Object} Status data with _hmac field added
 */
function signStatus(statusData) {
  const secret = getOrCreateSecret();
  const signed = { ...statusData };
  // Remove any existing _hmac before computing
  delete signed._hmac;
  signed._hmac = computeHmac(signed, secret);
  return signed;
}

/**
 * Verify status data HMAC integrity.
 *
 * @param {Object} statusData - Status data with _hmac field
 * @returns {{ valid: boolean }}
 */
function verifyStatus(statusData) {
  if (!statusData || !statusData._hmac) {
    return { valid: false };
  }

  try {
    const secret = getOrCreateSecret();
    const expected = computeHmac(statusData, secret);

    // Constant-time comparison
    const valid = crypto.timingSafeEqual(
      Buffer.from(statusData._hmac, 'hex'),
      Buffer.from(expected, 'hex')
    );

    return { valid };
  } catch {
    return { valid: false };
  }
}

module.exports = { signStatus, verifyStatus, getOrCreateSecret };
