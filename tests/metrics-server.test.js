const MetricsServer = require('../src/modules/metrics-server');

describe('MetricsServer', () => {
  let server;

  afterEach(async () => {
    if (server && server.isRunning) {
      await server.stop();
    }
  });

  it('should create with default config', () => {
    server = new MetricsServer();
    expect(server.port).toBe(9199);
    expect(server.isRunning).toBe(false);
  });

  it('should create with custom port', () => {
    server = new MetricsServer({ port: 9300 });
    expect(server.port).toBe(9300);
  });

  it('should increment counters', () => {
    server = new MetricsServer();
    server.increment('rate_limits_detected');
    server.increment('resumes_attempted', 3);
    expect(server._counters.rate_limits_detected).toBe(1);
    expect(server._counters.resumes_attempted).toBe(3);
  });

  it('should ignore invalid counter names', () => {
    server = new MetricsServer();
    server.increment('nonexistent');
    expect(server._counters.nonexistent).toBeUndefined();
  });

  it('should start and stop', async () => {
    server = new MetricsServer({ port: 0, logger: { log: () => {} } });
    await server.start();
    expect(server.isRunning).toBe(true);
    await server.stop();
    expect(server.isRunning).toBe(false);
  });

  it('should not start twice', async () => {
    server = new MetricsServer({ port: 0, logger: { log: () => {} } });
    await server.start();
    await server.start();
    expect(server.isRunning).toBe(true);
  });

  it('should not error on stop when not running', async () => {
    server = new MetricsServer();
    await server.stop();
    expect(server.isRunning).toBe(false);
  });

  it('should have all expected counters initialized to zero', () => {
    server = new MetricsServer();
    expect(server._counters.rate_limits_detected).toBe(0);
    expect(server._counters.resumes_attempted).toBe(0);
    expect(server._counters.resumes_succeeded).toBe(0);
    expect(server._counters.resumes_failed).toBe(0);
    expect(server._counters.hook_fires).toBe(0);
  });
});
