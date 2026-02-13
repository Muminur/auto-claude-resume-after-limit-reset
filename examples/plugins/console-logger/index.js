/**
 * Console Logger Plugin
 *
 * A minimal example plugin that logs events to the console.
 * Perfect for learning how plugins work.
 */

// Format a timestamp in human-readable form
const formatTime = (timestamp) => {
  const date = new Date(timestamp);
  return date.toLocaleString();
};

// Calculate time until reset
const getTimeUntilReset = (resetTime) => {
  const now = Date.now();
  const resetMs = resetTime * 1000;
  const diffMs = resetMs - now;
  const minutes = Math.ceil(diffMs / 60000);

  if (minutes < 1) return 'less than a minute';
  if (minutes === 1) return '1 minute';
  return `${minutes} minutes`;
};

module.exports = {
  name: 'console-logger',
  version: '1.0.0',
  description: 'Simple console logging for auto-resume events',

  hooks: {
    onRateLimitDetected: async (event) => {
      console.log('\n┌─────────────────────────────────────────┐');
      console.log('│  ⚠️  RATE LIMIT DETECTED               │');
      console.log('├─────────────────────────────────────────┤');
      console.log(`│ Time: ${formatTime(event.timestamp).padEnd(31)}│`);
      console.log(`│ Conversation: ${event.conversationId.padEnd(23)}│`);
      console.log(`│ Reset in: ${getTimeUntilReset(event.resetTime).padEnd(27)}│`);
      console.log('└─────────────────────────────────────────┘\n');
    },

    onResumeSent: async (event) => {
      console.log('\n┌─────────────────────────────────────────┐');
      console.log('│  ✓ CONVERSATION RESUMED                 │');
      console.log('├─────────────────────────────────────────┤');
      console.log(`│ Time: ${formatTime(event.timestamp).padEnd(31)}│`);
      console.log(`│ Conversation: ${event.conversationId.padEnd(23)}│`);
      console.log(`│ Message: "${event.message}"${' '.repeat(29 - event.message.length)}│`);
      console.log('└─────────────────────────────────────────┘\n');
    }
  }
};
