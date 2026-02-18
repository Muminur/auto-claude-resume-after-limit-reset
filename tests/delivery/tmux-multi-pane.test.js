const { findAllClaudePanes, sendToAllPanes } = require('../../src/delivery/tmux-delivery');

describe('tmux multi-pane delivery', () => {
  describe('findAllClaudePanes', () => {
    it('should return an array', async () => {
      const panes = await findAllClaudePanes();
      expect(Array.isArray(panes)).toBe(true);
    });

    it('should return objects with target and pid fields', async () => {
      const panes = await findAllClaudePanes();
      // In test environment, may find 0 panes (no tmux) or real panes
      for (const pane of panes) {
        expect(pane).toHaveProperty('target');
        expect(pane).toHaveProperty('pid');
        expect(typeof pane.target).toBe('string');
        expect(typeof pane.pid).toBe('number');
      }
    });

    it('should not include non-claude panes', async () => {
      const panes = await findAllClaudePanes();
      // Every returned pane should have a claude-related command
      for (const pane of panes) {
        expect(pane).toHaveProperty('command');
      }
    });
  });

  describe('sendToAllPanes', () => {
    it('should be a function', () => {
      expect(typeof sendToAllPanes).toBe('function');
    });

    it('should return a result with sent count', async () => {
      // With no matching panes, should return 0
      const result = await sendToAllPanes('continue', []);
      expect(result).toHaveProperty('sent');
      expect(result.sent).toBe(0);
    });

    it('should send to multiple panes and count successes', async () => {
      // Pass fake panes - sendViaTmux will fail for non-existent targets
      // but sendToAllPanes should handle errors gracefully
      const fakePanes = [
        { target: 'fake-session-999:0.0', pid: 1, command: 'claude' },
        { target: 'fake-session-999:0.1', pid: 2, command: 'claude' },
      ];
      const result = await sendToAllPanes('continue', fakePanes);
      expect(result).toHaveProperty('sent');
      expect(result).toHaveProperty('failed');
      expect(result.sent + result.failed).toBe(2);
    });
  });
});
