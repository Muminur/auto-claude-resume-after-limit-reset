const fs = require('fs');
const net = require('net');

jest.mock('fs');
jest.mock('net');

describe('Windows Terminal Named Pipe', () => {
  let originalEnv;
  let originalPlatform;

  beforeEach(() => {
    jest.clearAllMocks();
    originalEnv = { ...process.env };
    originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
  });

  afterEach(() => {
    process.env = originalEnv;
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform);
    }
  });

  describe('getWindowsTerminalPipePath', () => {
    const { getWindowsTerminalPipePath } = require('../src/modules/wt-pipe');

    it('should return named pipe path when WT_SESSION is set', () => {
      process.env.WT_SESSION = 'abc-123-def';

      const result = getWindowsTerminalPipePath();

      expect(result).toBe('\\\\.\\pipe\\WT_Session_abc-123-def');
    });

    it('should return null when WT_SESSION is not set', () => {
      delete process.env.WT_SESSION;

      const result = getWindowsTerminalPipePath();

      expect(result).toBeNull();
    });
  });

  describe('tryNamedPipeDelivery', () => {
    const { tryNamedPipeDelivery } = require('../src/modules/wt-pipe');

    it('should attempt named pipe write when WT_SESSION is set', async () => {
      process.env.WT_SESSION = 'test-session-456';

      const mockSocket = {
        write: jest.fn((data, cb) => cb()),
        end: jest.fn(),
        on: jest.fn(),
        destroy: jest.fn()
      };
      net.connect = jest.fn().mockReturnValue(mockSocket);

      // Simulate 'connect' event
      net.connect.mockImplementation((opts, connectCb) => {
        setTimeout(() => connectCb(), 0);
        return mockSocket;
      });

      const result = await tryNamedPipeDelivery('continue');

      expect(net.connect).toHaveBeenCalledWith(
        expect.objectContaining({
          path: '\\\\.\\pipe\\WT_Session_test-session-456'
        }),
        expect.any(Function)
      );
      expect(result.attempted).toBe(true);
      expect(result.pipePath).toContain('WT_Session_test-session-456');
    });

    it('should return attempted=false when WT_SESSION is not set', async () => {
      delete process.env.WT_SESSION;

      const result = await tryNamedPipeDelivery('continue');

      expect(result.attempted).toBe(false);
      expect(net.connect).not.toHaveBeenCalled();
    });

    it('should handle pipe connection errors gracefully', async () => {
      process.env.WT_SESSION = 'bad-session';

      const mockSocket = {
        write: jest.fn(),
        end: jest.fn(),
        on: jest.fn(),
        destroy: jest.fn()
      };

      net.connect = jest.fn().mockImplementation((opts, connectCb) => {
        // Simulate error
        setTimeout(() => {
          const errorHandler = mockSocket.on.mock.calls.find(c => c[0] === 'error');
          if (errorHandler) errorHandler[1](new Error('ENOENT'));
        }, 0);
        return mockSocket;
      });

      const result = await tryNamedPipeDelivery('continue');

      expect(result.attempted).toBe(true);
      expect(result.success).toBe(false);
    });
  });
});
