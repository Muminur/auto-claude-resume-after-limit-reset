const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

jest.mock('fs');
jest.mock('os');

os.homedir = jest.fn().mockReturnValue('/home/testuser');

const { signStatus, verifyStatus, getOrCreateSecret } = require('../src/modules/hmac-integrity');

describe('HMAC Integrity Check', () => {
  const mockHomeDir = '/home/testuser';
  const secretPath = path.join(mockHomeDir, '.claude', 'auto-resume', '.secret');

  beforeEach(() => {
    jest.clearAllMocks();
    os.homedir.mockReturnValue(mockHomeDir);
    fs.mkdirSync.mockReturnValue(undefined);
    fs.writeFileSync.mockReturnValue(undefined);
    fs.chmodSync = jest.fn();
  });

  describe('getOrCreateSecret', () => {
    it('should return existing secret when file exists', () => {
      const existingSecret = 'a'.repeat(64);
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(existingSecret);

      const secret = getOrCreateSecret();

      expect(secret).toBe(existingSecret);
    });

    it('should create new secret when file missing', () => {
      fs.existsSync.mockReturnValue(false);

      const secret = getOrCreateSecret();

      expect(secret).toHaveLength(64); // 32 bytes hex = 64 chars
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        secretPath,
        expect.any(String),
        expect.objectContaining({ mode: 0o600 })
      );
    });
  });

  describe('signStatus', () => {
    it('should add _hmac field to status data', () => {
      const secret = 'test-secret-key';
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(secret);

      const statusData = { detected: true, reset_time: '2025-01-01T12:00:00Z' };
      const signed = signStatus(statusData);

      expect(signed._hmac).toBeDefined();
      expect(typeof signed._hmac).toBe('string');
      expect(signed.detected).toBe(true);
    });

    it('should produce consistent HMAC for same data and secret', () => {
      const secret = 'consistent-key';
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(secret);

      const statusData = { detected: true, message: 'rate limit' };
      const signed1 = signStatus({ ...statusData });
      const signed2 = signStatus({ ...statusData });

      expect(signed1._hmac).toBe(signed2._hmac);
    });
  });

  describe('verifyStatus', () => {
    it('should return valid=true for correctly signed status', () => {
      const secret = 'verify-key';
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(secret);

      const statusData = { detected: true, reset_time: '2025-01-01T12:00:00Z' };
      const signed = signStatus(statusData);

      const result = verifyStatus(signed);

      expect(result.valid).toBe(true);
    });

    it('should return valid=false for tampered status (wrong HMAC)', () => {
      const secret = 'verify-key';
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(secret);

      const tampered = {
        detected: true,
        reset_time: '2025-01-01T12:00:00Z',
        _hmac: 'wrong-hmac-value'
      };

      const result = verifyStatus(tampered);

      expect(result.valid).toBe(false);
    });

    it('should return valid=false when _hmac field is missing', () => {
      const secret = 'verify-key';
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(secret);

      const unsigned = { detected: true, reset_time: '2025-01-01T12:00:00Z' };
      const result = verifyStatus(unsigned);

      expect(result.valid).toBe(false);
    });

    it('should return valid=false when data was modified after signing', () => {
      const secret = 'verify-key';
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(secret);

      const statusData = { detected: true, reset_time: '2025-01-01T12:00:00Z' };
      const signed = signStatus(statusData);

      // Tamper with data
      signed.reset_time = '2025-06-01T12:00:00Z';

      const result = verifyStatus(signed);

      expect(result.valid).toBe(false);
    });
  });
});
