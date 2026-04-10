const fs = require('fs');
const path = require('path');
const os = require('os');

jest.mock('fs');
jest.mock('os');

describe('Context-Aware Resume Prompt', () => {
  const mockHomeDir = '/home/testuser';
  const STATUS_DIR = path.join(mockHomeDir, '.claude', 'auto-resume');
  const STATUS_FILE = path.join(STATUS_DIR, 'status.json');

  beforeEach(() => {
    jest.clearAllMocks();
    os.homedir.mockReturnValue(mockHomeDir);
    fs.existsSync.mockReturnValue(true);
    fs.mkdirSync.mockReturnValue(undefined);
    fs.writeFileSync.mockReturnValue(undefined);
  });

  describe('extractLastTaskContext', () => {
    const { extractLastTaskContext } = require('../src/modules/context-extractor');

    it('should extract last user message text from transcript', () => {
      const transcript = [
        JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'Fix the login bug in auth.js' }] } }),
        JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'I will fix that.' }] } }),
        JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_123' }] } }),
        JSON.stringify({ type: 'assistant', error: 'rate_limit', message: { content: [{ type: 'text', text: "You've hit your limit" }] } }),
      ];

      const result = extractLastTaskContext(transcript);

      expect(result.last_task_context).toBe('Fix the login bug in auth.js');
      expect(result.resume_prompt).toBe('Continue with: Fix the login bug in auth.js');
    });

    it('should skip tool_result entries when scanning backwards', () => {
      const transcript = [
        JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'Deploy to production' }] } }),
        JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_456' }] } }),
        JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_789' }] } }),
      ];

      const result = extractLastTaskContext(transcript);

      expect(result.last_task_context).toBe('Deploy to production');
    });

    it('should return null when no user text messages found', () => {
      const transcript = [
        JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_123' }] } }),
        JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [] } }),
      ];

      const result = extractLastTaskContext(transcript);

      expect(result).toBeNull();
    });

    it('should handle string content in user messages', () => {
      const transcript = [
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'Simple string task' } }),
      ];

      const result = extractLastTaskContext(transcript);

      expect(result.last_task_context).toBe('Simple string task');
    });

    it('should truncate very long context to 200 chars', () => {
      const longText = 'A'.repeat(300);
      const transcript = [
        JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: longText }] } }),
      ];

      const result = extractLastTaskContext(transcript);

      expect(result.last_task_context.length).toBeLessThanOrEqual(200);
    });
  });

  describe('getResumeText', () => {
    const { getResumeText } = require('../src/modules/context-extractor');

    it('should use resume_prompt from status when available', () => {
      const status = { resume_prompt: 'Continue with: Fix login bug' };
      const result = getResumeText(status, { resumePrompt: 'continue' });
      expect(result).toBe('Continue with: Fix login bug');
    });

    it('should fall back to last_task_context', () => {
      const status = { last_task_context: 'Fix login bug' };
      const result = getResumeText(status, { resumePrompt: 'continue' });
      expect(result).toBe('Fix login bug');
    });

    it('should fall back to config resumePrompt', () => {
      const status = {};
      const result = getResumeText(status, { resumePrompt: 'please continue' });
      expect(result).toBe('please continue');
    });

    it('should fall back to "continue" as last resort', () => {
      const result = getResumeText({}, {});
      expect(result).toBe('continue');
    });
  });
});
