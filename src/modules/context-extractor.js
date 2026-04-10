/**
 * Context-Aware Resume Prompt Extractor
 *
 * Scans transcript backwards to find the last user task message
 * (skipping tool_result entries) and generates a context-aware resume prompt.
 *
 * @module ContextExtractor
 */

const MAX_CONTEXT_LENGTH = 200;

/**
 * Extract the last user task context from transcript lines.
 * Scans backwards, skipping tool_result entries.
 *
 * @param {string[]} transcriptLines - Array of JSON line strings from transcript
 * @returns {{ last_task_context: string, resume_prompt: string } | null}
 */
function extractLastTaskContext(transcriptLines) {
  // Scan backwards
  for (let i = transcriptLines.length - 1; i >= 0; i--) {
    const line = transcriptLines[i];
    if (!line || typeof line !== 'string') continue;

    let entry;
    try {
      entry = JSON.parse(line.trim());
    } catch {
      continue;
    }

    // Only look at user entries
    if (entry.type !== 'user') continue;

    const message = entry.message;
    if (!message) continue;

    // Skip if role is not user
    if (message.role && message.role !== 'user') continue;

    const content = message.content;

    // Handle string content directly
    if (typeof content === 'string' && content.trim()) {
      const truncated = content.trim().substring(0, MAX_CONTEXT_LENGTH);
      return {
        last_task_context: truncated,
        resume_prompt: `Continue with: ${truncated}`
      };
    }

    // Handle array content
    if (Array.isArray(content)) {
      // Skip if only tool_result entries
      const hasToolResult = content.some(c => c.type === 'tool_result');
      const hasText = content.some(c => c.type === 'text' && c.text);

      if (hasToolResult && !hasText) continue;

      // Extract text content
      for (const part of content) {
        if (part.type === 'text' && part.text && part.text.trim()) {
          const truncated = part.text.trim().substring(0, MAX_CONTEXT_LENGTH);
          return {
            last_task_context: truncated,
            resume_prompt: `Continue with: ${truncated}`
          };
        }
      }
    }
  }

  return null;
}

/**
 * Get the resume text to send, using priority chain:
 * 1. status.resume_prompt
 * 2. status.last_task_context
 * 3. config.resumePrompt
 * 4. 'continue'
 *
 * @param {Object} status - Status object from status.json
 * @param {Object} config - Config object
 * @returns {string}
 */
function getResumeText(status, config) {
  if (status && status.resume_prompt) return status.resume_prompt;
  if (status && status.last_task_context) return status.last_task_context;
  if (config && config.resumePrompt) return config.resumePrompt;
  return 'continue';
}

module.exports = { extractLastTaskContext, getResumeText };
