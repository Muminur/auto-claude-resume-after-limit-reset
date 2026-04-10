#!/usr/bin/env node

/**
 * Proactive Usage Warning Hook (PostToolUse)
 *
 * Tracks tool usage per session and emits a warning system message
 * when the session approaches 80% of the historical average rate limit threshold.
 *
 * Hook Event: PostToolUse
 */

const { checkUsageWarning, incrementSessionUsage } = require('../src/modules/usage-warning');

async function main() {
  try {
    if (process.stdin.isTTY) {
      process.exit(0);
      return;
    }

    let stdinData = '';
    for await (const chunk of process.stdin) {
      stdinData += chunk;
    }

    if (!stdinData.trim()) {
      process.exit(0);
      return;
    }

    let input;
    try {
      input = JSON.parse(stdinData);
    } catch {
      process.exit(0);
      return;
    }

    const sessionId = input.session_id || 'default';

    // Increment usage counter
    incrementSessionUsage(sessionId);

    // Check if warning should be emitted
    const result = checkUsageWarning(sessionId);

    if (result.warning) {
      console.log(JSON.stringify({
        systemMessage: result.message
      }));
    }

    process.exit(0);
  } catch (err) {
    // Hook errors should never block Claude Code
    process.exit(0);
  }
}

main();
