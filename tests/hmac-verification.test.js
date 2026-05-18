const { signStatus, verifyStatus } = require('../src/modules/hmac-integrity');

describe('HMAC Integrity', () => {
  it('should sign and verify status data', () => {
    const status = { detected: true, reset_time: new Date().toISOString(), message: 'test' };
    const signed = signStatus(status);
    expect(signed._hmac).toBeDefined();
    expect(verifyStatus(signed).valid).toBe(true);
  });

  it('should reject tampered data', () => {
    const status = { detected: true, reset_time: new Date().toISOString(), message: 'test' };
    const signed = signStatus(status);
    signed.message = 'tampered';
    expect(verifyStatus(signed).valid).toBe(false);
  });

  it('should reject missing HMAC', () => {
    const status = { detected: true, reset_time: new Date().toISOString() };
    expect(verifyStatus(status).valid).toBe(false);
  });

  it('should reject null input', () => {
    expect(verifyStatus(null).valid).toBe(false);
  });
});
