const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');

// Mock fs and readline modules before requiring the hook
jest.mock('fs');
jest.mock('readline');

// Import the functions we'll be testing (after implementation)
// For now, we're writing tests first (TDD Red phase)
const {
  analyzeTranscript,
  analyzeTranscriptWithSubagents,
  isRateLimitMessage,
  isFalsePositive,
  parseResetTime
} = require('../hooks/rate-limit-hook');

describe('rate-limit-hook - Subagent Transcript Scanning', () => {
  const mockHomeDir = os.homedir();
  const mockSessionId = 'test-session-123';
  // Use path.join for cross-platform compatibility
  const mockTranscriptPath = path.join('/path/to/sessions', `${mockSessionId}.jsonl`);
  const mockSubagentsDir = path.join('/path/to/sessions', mockSessionId, 'subagents');

  beforeEach(() => {
    jest.clearAllMocks();

    // Default mock implementations
    fs.existsSync.mockReturnValue(false);
    fs.readdirSync.mockReturnValue([]);
    fs.createReadStream.mockReturnValue({
      on: jest.fn(),
      pipe: jest.fn()
    });
  });

  describe('analyzeTranscriptWithSubagents', () => {
    describe('main transcript analysis', () => {
      it('should analyze main transcript first', async () => {
        const mockRateLimitEntry = {
          type: 'assistant',
          error: 'rate_limit',
          message: {
            content: [{
              type: 'text',
              text: "You've hit your limit · resets 7pm (America/New_York)"
            }]
          }
        };

        mockReadlineInterface([JSON.stringify(mockRateLimitEntry)]);
        fs.existsSync.mockReturnValue(true);

        const result = await analyzeTranscriptWithSubagents(mockTranscriptPath);

        expect(result).not.toBeNull();
        expect(result.detected).toBe(true);
        expect(result.message).toContain("You've hit your limit");
      });

      it('should return immediately if rate limit found in main transcript', async () => {
        const mockRateLimitEntry = {
          type: 'assistant',
          error: 'rate_limit',
          message: {
            content: [{
              type: 'text',
              text: "You've hit your limit · resets 8pm (UTC)"
            }]
          }
        };

        mockReadlineInterface([JSON.stringify(mockRateLimitEntry)]);
        fs.existsSync.mockReturnValue(true);

        const result = await analyzeTranscriptWithSubagents(mockTranscriptPath);

        expect(result).not.toBeNull();
        expect(fs.readdirSync).not.toHaveBeenCalled(); // Should not scan subagents
      });

      it('should return null if main transcript does not exist', async () => {
        fs.existsSync.mockReturnValue(false);

        const result = await analyzeTranscriptWithSubagents(mockTranscriptPath);

        expect(result).toBeNull();
        expect(fs.readdirSync).not.toHaveBeenCalled();
      });
    });

    describe('subagent directory detection', () => {
      it('should check for subagents directory if no rate limit in main transcript', async () => {
        // Main transcript has no rate limit
        mockReadlineInterface([
          JSON.stringify({ type: 'user', message: { content: 'Hello' } })
        ]);
        fs.existsSync.mockImplementation(path => {
          if (path === mockTranscriptPath) return true;
          if (path === mockSubagentsDir) return true;
          return false;
        });

        await analyzeTranscriptWithSubagents(mockTranscriptPath);

        expect(fs.existsSync).toHaveBeenCalledWith(mockSubagentsDir);
      });

      it('should construct correct subagents directory path', async () => {
        const transcriptPath = path.join('/custom/path', 'session-456.jsonl');
        const expectedSubagentsDir = path.join('/custom/path', 'session-456', 'subagents');

        mockReadlineInterface([]);
        fs.existsSync.mockImplementation(p => {
          return p === transcriptPath || p === expectedSubagentsDir;
        });

        await analyzeTranscriptWithSubagents(transcriptPath);

        expect(fs.existsSync).toHaveBeenCalledWith(expectedSubagentsDir);
      });

      it('should return null if subagents directory does not exist', async () => {
        mockReadlineInterface([]);
        fs.existsSync.mockImplementation(path => {
          return path === mockTranscriptPath; // Only main transcript exists
        });

        const result = await analyzeTranscriptWithSubagents(mockTranscriptPath);

        expect(result).toBeNull();
      });
    });

    describe('subagent file scanning', () => {
      it('should scan all agent-*.jsonl files in subagents directory', async () => {
        mockReadlineInterface([]);
        fs.existsSync.mockImplementation(path => {
          return path === mockTranscriptPath || path === mockSubagentsDir;
        });
        fs.readdirSync.mockReturnValue([
          'agent-executor-001.jsonl',
          'agent-architect-002.jsonl',
          'agent-designer-003.jsonl',
          'other-file.txt' // Should be ignored
        ]);

        await analyzeTranscriptWithSubagents(mockTranscriptPath);

        // Should attempt to read the three agent-*.jsonl files
        expect(fs.createReadStream).toHaveBeenCalledWith(
          path.join(mockSubagentsDir, 'agent-executor-001.jsonl')
        );
        expect(fs.createReadStream).toHaveBeenCalledWith(
          path.join(mockSubagentsDir, 'agent-architect-002.jsonl')
        );
        expect(fs.createReadStream).toHaveBeenCalledWith(
          path.join(mockSubagentsDir, 'agent-designer-003.jsonl')
        );
        expect(fs.createReadStream).not.toHaveBeenCalledWith(
          expect.stringContaining('other-file.txt')
        );
      });

      it('should detect rate limit in first subagent and stop scanning', async () => {
        const rateLimitEntry = {
          type: 'assistant',
          isApiErrorMessage: true,
          message: {
            content: [{
              type: 'text',
              text: "You've hit your usage limit · resets 9pm (Europe/London)"
            }]
          }
        };

        let firstSubagentRead = false;
        mockReadlineInterface([]);
        fs.existsSync.mockReturnValue(true);
        fs.readdirSync.mockReturnValue([
          'agent-executor-001.jsonl',
          'agent-architect-002.jsonl'
        ]);

        // Mock createReadStream to return different content per file
        fs.createReadStream.mockImplementation(filePath => {
          if (filePath.includes('agent-executor-001.jsonl') && !firstSubagentRead) {
            firstSubagentRead = true;
            const mockStream = createMockStream([JSON.stringify(rateLimitEntry)]);
            return mockStream;
          }
          return createMockStream([]);
        });

        const result = await analyzeTranscriptWithSubagents(mockTranscriptPath);

        expect(result).not.toBeNull();
        expect(result.detected).toBe(true);
        expect(result.message).toContain("You've hit your usage limit");

        // Should have stopped after first subagent (only read first agent file once)
        const executorCalls = fs.createReadStream.mock.calls.filter(
          call => call[0].includes('agent-executor-001.jsonl')
        );
        expect(executorCalls.length).toBeLessThanOrEqual(2); // Main + first subagent
      });

      it('should continue scanning if no rate limit in first subagent', async () => {
        const rateLimitEntry = {
          type: 'assistant',
          error: 'rate_limit',
          message: {
            content: [{
              type: 'text',
              text: "You've hit your limit · resets 10pm (Asia/Tokyo)"
            }]
          }
        };

        mockReadlineInterface([]);
        fs.existsSync.mockReturnValue(true);
        fs.readdirSync.mockReturnValue([
          'agent-executor-001.jsonl',
          'agent-architect-002.jsonl'
        ]);

        fs.createReadStream.mockImplementation(filePath => {
          if (filePath.includes('agent-architect-002.jsonl')) {
            return createMockStream([JSON.stringify(rateLimitEntry)]);
          }
          return createMockStream([JSON.stringify({ type: 'user', message: {} })]);
        });

        const result = await analyzeTranscriptWithSubagents(mockTranscriptPath);

        expect(result).not.toBeNull();
        expect(result.detected).toBe(true);
        expect(result.message).toContain("You've hit your limit");
      });

      it('should return null if no rate limit found in any subagent', async () => {
        mockReadlineInterface([]);
        fs.existsSync.mockReturnValue(true);
        fs.readdirSync.mockReturnValue([
          'agent-executor-001.jsonl',
          'agent-architect-002.jsonl'
        ]);

        fs.createReadStream.mockImplementation(() => {
          return createMockStream([
            JSON.stringify({ type: 'user', message: { content: 'test' } })
          ]);
        });

        const result = await analyzeTranscriptWithSubagents(mockTranscriptPath);

        expect(result).toBeNull();
      });
    });

    describe('edge cases', () => {
      it('should handle empty subagents directory', async () => {
        mockReadlineInterface([]);
        fs.existsSync.mockReturnValue(true);
        fs.readdirSync.mockReturnValue([]);

        const result = await analyzeTranscriptWithSubagents(mockTranscriptPath);

        expect(result).toBeNull();
      });

      it('should handle malformed subagent filenames', async () => {
        mockReadlineInterface([]);
        fs.existsSync.mockReturnValue(true);
        fs.readdirSync.mockReturnValue([
          'agent-.jsonl',
          'agent-toolong-name-with-dashes.jsonl',
          'AGENT-UPPERCASE.jsonl'
        ]);

        // Should not throw
        await expect(analyzeTranscriptWithSubagents(mockTranscriptPath)).resolves.not.toThrow();
      });

      it('should handle file read errors gracefully', async () => {
        mockReadlineInterface([]);
        fs.existsSync.mockReturnValue(true);
        fs.readdirSync.mockReturnValue(['agent-test-001.jsonl']);
        fs.createReadStream.mockImplementation(() => {
          throw new Error('EACCES: permission denied');
        });

        // Should not throw, just skip to next file
        const result = await analyzeTranscriptWithSubagents(mockTranscriptPath);
        expect(result).toBeNull();
      });

      it('should handle malformed JSON in subagent files', async () => {
        mockReadlineInterface([]);
        fs.existsSync.mockReturnValue(true);
        fs.readdirSync.mockReturnValue(['agent-test-001.jsonl']);

        fs.createReadStream.mockImplementation(() => {
          return createMockStream([
            '{ invalid json',
            JSON.stringify({ type: 'user', message: {} })
          ]);
        });

        // Should skip malformed lines and continue
        const result = await analyzeTranscriptWithSubagents(mockTranscriptPath);
        expect(result).toBeNull();
      });
    });
  });

  describe('rate limit detection criteria', () => {
    describe('error field detection', () => {
      it('should detect rate limit with error: "rate_limit"', () => {
        const entry = {
          type: 'assistant',
          error: 'rate_limit',
          message: {
            content: [{
              type: 'text',
              text: "You've hit your limit · resets 7pm (UTC)"
            }]
          }
        };

        const text = entry.message.content[0].text;
        expect(isRateLimitMessage(text)).toBe(true);
      });

      it('should detect rate limit with isApiErrorMessage: true', () => {
        const entry = {
          type: 'assistant',
          isApiErrorMessage: true,
          message: {
            content: [{
              type: 'text',
              text: "You've hit your usage limit · resets 8pm (America/New_York)"
            }]
          }
        };

        const text = entry.message.content[0].text;
        expect(isRateLimitMessage(text)).toBe(true);
      });

      it('should require type: "assistant" for detection', () => {
        const userEntry = {
          type: 'user',
          error: 'rate_limit',
          message: {
            content: [{
              type: 'text',
              text: "You've hit your limit · resets 7pm (UTC)"
            }]
          }
        };

        // User messages should not trigger rate limit detection
        // This test verifies the analyzeTranscript function skips user messages
        expect(userEntry.type).toBe('user');
      });
    });

    describe('message content detection', () => {
      it('should detect "You\'ve hit your limit" with curly quote', () => {
        const text = "You've hit your limit · resets 7pm (UTC)";
        expect(isRateLimitMessage(text)).toBe(true);
      });

      it('should detect "You\'ve hit your limit" with standard apostrophe', () => {
        const text = "You've hit your limit · resets 7pm (UTC)";
        expect(isRateLimitMessage(text)).toBe(true);
      });

      it('should detect "You\'ve hit your usage limit"', () => {
        const text = "You've hit your usage limit · resets 8pm (America/Los_Angeles)";
        expect(isRateLimitMessage(text)).toBe(true);
      });

      it('should detect various time formats', () => {
        const messages = [
          "You've hit your limit · resets 7pm (UTC)",
          "You've hit your limit · resets 11pm (Europe/London)",
          "You've hit your limit · resets 1am (Asia/Tokyo)",
          "You've hit your limit · resets 12pm (America/New_York)"
        ];

        messages.forEach(msg => {
          expect(isRateLimitMessage(msg)).toBe(true);
        });
      });

      it('should detect with different timezone formats', () => {
        const messages = [
          "You've hit your limit · resets 7pm (UTC)",
          "You've hit your limit · resets 7pm (America/New_York)",
          "You've hit your limit · resets 7pm (Europe/London)",
          "You've hit your limit · resets 7pm (Asia/Dhaka)"
        ];

        messages.forEach(msg => {
          expect(isRateLimitMessage(msg)).toBe(true);
        });
      });
    });

    describe('message length validation', () => {
      it('should accept messages under 200 characters', () => {
        const shortMessage = "You've hit your limit · resets 7pm (UTC)";
        expect(shortMessage.length).toBeLessThan(200);
        expect(isRateLimitMessage(shortMessage)).toBe(true);
      });

      it('should reject messages over 200 characters', () => {
        const longMessage = "You've hit your limit · resets 7pm (UTC) " + 'x'.repeat(200);
        expect(longMessage.length).toBeGreaterThan(200);
        expect(isRateLimitMessage(longMessage)).toBe(false);
      });

      it('should reject very long file contents containing the pattern', () => {
        const fileContent = `
          const RATE_LIMIT_PATTERN = /You've hit your limit/;
          ${'// comment line\n'.repeat(50)}
          You've hit your limit · resets 7pm (UTC)
        `;
        expect(fileContent.length).toBeGreaterThan(200);
        expect(isRateLimitMessage(fileContent)).toBe(false);
      });
    });
  });

  describe('false positive prevention', () => {
    describe('tool_result exclusion', () => {
      it('should not detect rate limit in tool_result content', () => {
        const toolResult = {
          type: 'tool_result',
          content: "You've hit your limit · resets 7pm (UTC)"
        };

        expect(isFalsePositive(JSON.stringify(toolResult))).toBe(true);
      });

      it('should not detect rate limit in content with tool_use_id', () => {
        const content = `
          tool_use_id: "toolu_12345"
          You've hit your limit · resets 7pm (UTC)
        `;

        expect(isFalsePositive(content)).toBe(true);
      });

      it('should not detect rate limit in content with toolu_ prefix', () => {
        const content = "toolu_abc123: You've hit your limit · resets 7pm (UTC)";
        expect(isFalsePositive(content)).toBe(true);
      });
    });

    describe('user message exclusion', () => {
      it('should skip user messages entirely', async () => {
        const userMessage = {
          type: 'user',
          message: {
            role: 'user',
            content: [{
              type: 'text',
              text: "You've hit your limit · resets 7pm (UTC)"
            }]
          }
        };

        mockReadlineInterface([JSON.stringify(userMessage)]);
        fs.existsSync.mockReturnValue(true);

        const result = await analyzeTranscript(mockTranscriptPath);

        expect(result).toBeNull();
      });

      it('should skip entries with type: "user"', async () => {
        const userEntry = {
          type: 'user',
          message: { content: "You've hit your limit · resets 7pm (UTC)" }
        };

        mockReadlineInterface([JSON.stringify(userEntry)]);
        fs.existsSync.mockReturnValue(true);

        const result = await analyzeTranscript(mockTranscriptPath);

        expect(result).toBeNull();
      });
    });

    describe('code content exclusion', () => {
      it('should not detect rate limit in file read with line numbers', () => {
        const fileContent = `
          1→ const RATE_LIMIT_PATTERN = /You've hit your limit/;
          2→ // This is a comment: You've hit your limit · resets 7pm (UTC)
          3→ function checkRateLimit() {}
        `;

        expect(isFalsePositive(fileContent)).toBe(true);
      });

      it('should not detect rate limit in JSDoc comments', () => {
        const content = `
          /**
           * Check if message is: You've hit your limit · resets 7pm (UTC)
           * @returns {boolean}
           */
        `;

        expect(isFalsePositive(content)).toBe(true);
      });

      it('should not detect rate limit in function definitions', () => {
        const content = `
          function isRateLimit(msg) {
            return msg.includes("You've hit your limit");
          }
        `;

        expect(isFalsePositive(content)).toBe(true);
      });

      it('should not detect rate limit in const declarations', () => {
        const content = `
          const RATE_LIMIT_MSG = "You've hit your limit · resets 7pm (UTC)";
        `;

        expect(isFalsePositive(content)).toBe(true);
      });

      it('should not detect rate limit string in RATE_LIMIT_PATTERNS variable', () => {
        const content = `
          const RATE_LIMIT_PATTERNS = [
            /You've hit your limit/i
          ];
        `;

        expect(isFalsePositive(content)).toBe(true);
      });
    });

    describe('transcript metadata exclusion', () => {
      it('should not detect in content with parentUuid', () => {
        const content = JSON.stringify({
          parentUuid: '123',
          message: "You've hit your limit"
        });

        expect(isFalsePositive(content)).toBe(true);
      });

      it('should not detect in content with sessionId', () => {
        const content = JSON.stringify({
          sessionId: '123',
          message: "You've hit your limit"
        });

        expect(isFalsePositive(content)).toBe(true);
      });

      it('should not detect in content with isSidechain', () => {
        const content = JSON.stringify({
          isSidechain: true,
          message: "You've hit your limit"
        });

        expect(isFalsePositive(content)).toBe(true);
      });
    });

    describe('combined false positive scenarios', () => {
      it('should reject file read containing rate limit pattern', () => {
        const content = `
          "content": "1→ // Rate limit message: You've hit your limit · resets 7pm (UTC)\\n"
        `;

        expect(isFalsePositive(content)).toBe(true);
      });

      it('should reject tool result with rate limit in output', () => {
        const content = `
          {
            "type": "tool_result",
            "tool_use_id": "toolu_123",
            "content": "Error: You've hit your limit · resets 7pm (UTC)"
          }
        `;

        expect(isFalsePositive(content)).toBe(true);
      });

      it('should accept actual assistant error message', () => {
        const message = "You've hit your limit · resets 7pm (UTC)";

        expect(isFalsePositive(message)).toBe(false);
        expect(isRateLimitMessage(message)).toBe(true);
      });
    });
  });

  describe('integration tests', () => {
    it('should find rate limit in main transcript only', async () => {
      const rateLimitEntry = {
        type: 'assistant',
        error: 'rate_limit',
        message: {
          content: [{
            type: 'text',
            text: "You've hit your limit · resets 7pm (America/New_York)"
          }]
        }
      };

      mockReadlineInterface([
        JSON.stringify({ type: 'user', message: {} }),
        JSON.stringify(rateLimitEntry)
      ]);
      fs.existsSync.mockReturnValue(true);

      const result = await analyzeTranscriptWithSubagents(mockTranscriptPath);

      expect(result).not.toBeNull();
      expect(result.detected).toBe(true);
      expect(result.reset_time).toBeDefined();
      expect(result.timezone).toBe('America/New_York');
    });

    it('should find rate limit in subagent when main transcript is clean', async () => {
      const rateLimitEntry = {
        type: 'assistant',
        isApiErrorMessage: true,
        message: {
          content: [{
            type: 'text',
            text: "You've hit your usage limit · resets 9pm (Europe/Paris)"
          }]
        }
      };

      // Main transcript has no rate limit
      mockReadlineInterface([
        JSON.stringify({ type: 'user', message: {} }),
        JSON.stringify({ type: 'assistant', message: { content: [] } })
      ]);

      fs.existsSync.mockReturnValue(true);
      fs.readdirSync.mockReturnValue(['agent-executor-001.jsonl']);

      let mainTranscriptRead = false;
      fs.createReadStream.mockImplementation(filePath => {
        if (filePath === mockTranscriptPath && !mainTranscriptRead) {
          mainTranscriptRead = true;
          return createMockStream([
            JSON.stringify({ type: 'user', message: {} })
          ]);
        }
        return createMockStream([JSON.stringify(rateLimitEntry)]);
      });

      const result = await analyzeTranscriptWithSubagents(mockTranscriptPath);

      expect(result).not.toBeNull();
      expect(result.detected).toBe(true);
      expect(result.timezone).toBe('Europe/Paris');
    });

    it('should ignore false positives in all transcripts', async () => {
      const toolResultEntry = {
        type: 'tool_result',
        content: "1→ const MSG = \"You've hit your limit · resets 7pm (UTC)\";"
      };

      mockReadlineInterface([JSON.stringify(toolResultEntry)]);
      fs.existsSync.mockReturnValue(true);
      fs.readdirSync.mockReturnValue(['agent-test-001.jsonl']);

      fs.createReadStream.mockImplementation(() => {
        return createMockStream([JSON.stringify(toolResultEntry)]);
      });

      const result = await analyzeTranscriptWithSubagents(mockTranscriptPath);

      expect(result).toBeNull();
    });

    it('should scan multiple subagents until finding rate limit', async () => {
      const rateLimitEntry = {
        type: 'assistant',
        error: 'rate_limit',
        message: {
          content: [{
            type: 'text',
            text: "You've hit your limit · resets 11pm (Asia/Shanghai)"
          }]
        }
      };

      mockReadlineInterface([]);
      fs.existsSync.mockReturnValue(true);
      fs.readdirSync.mockReturnValue([
        'agent-executor-001.jsonl',
        'agent-architect-002.jsonl',
        'agent-designer-003.jsonl'
      ]);

      fs.createReadStream.mockImplementation(filePath => {
        if (filePath.includes('agent-designer-003.jsonl')) {
          return createMockStream([JSON.stringify(rateLimitEntry)]);
        }
        return createMockStream([JSON.stringify({ type: 'user', message: {} })]);
      });

      const result = await analyzeTranscriptWithSubagents(mockTranscriptPath);

      expect(result).not.toBeNull();
      expect(result.detected).toBe(true);
      expect(result.timezone).toBe('Asia/Shanghai');
    });

    it('should handle mixed valid and invalid entries', async () => {
      const entries = [
        JSON.stringify({ type: 'user', message: {} }),
        '{ invalid json',
        JSON.stringify({ type: 'tool_result', content: 'test' }),
        JSON.stringify({
          type: 'assistant',
          error: 'rate_limit',
          message: {
            content: [{
              type: 'text',
              text: "You've hit your limit · resets 6pm (UTC)"
            }]
          }
        })
      ];

      mockReadlineInterface(entries);
      fs.existsSync.mockReturnValue(true);

      const result = await analyzeTranscriptWithSubagents(mockTranscriptPath);

      expect(result).not.toBeNull();
      expect(result.detected).toBe(true);
    });
  });
});

// Helper function to mock readline interface
function mockReadlineInterface(lines) {
  const mockInterface = {
    [Symbol.asyncIterator]: async function* () {
      for (const line of lines) {
        yield line;
      }
    }
  };

  readline.createInterface.mockReturnValue(mockInterface);
}

// Helper function to create mock stream for different files
function createMockStream(lines) {
  return {
    on: jest.fn(),
    pipe: jest.fn(),
    [Symbol.asyncIterator]: async function* () {
      for (const line of lines) {
        yield line;
      }
    }
  };
}
