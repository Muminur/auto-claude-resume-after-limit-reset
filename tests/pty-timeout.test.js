const { sendViaPty } = require('../src/delivery/pty-delivery');

describe('PTY Delivery', () => {
  it('should reject on non-existent PTY path', async () => {
    await expect(sendViaPty('/dev/pts/99999', 'test')).rejects.toThrow(/PTY write/);
  });

  it('should reject on invalid path', async () => {
    await expect(sendViaPty('/nonexistent/path', 'test')).rejects.toThrow();
  });

  it('should accept menuSelection option', async () => {
    await expect(sendViaPty('/dev/pts/99999', 'test', { menuSelection: '2' })).rejects.toThrow();
  });
});
