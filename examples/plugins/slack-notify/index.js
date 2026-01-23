/**
 * Slack Notify Plugin
 *
 * Sends Slack notifications when rate limits are detected.
 * Requires a Slack webhook URL to be configured.
 *
 * Configuration:
 * Set the SLACK_WEBHOOK_URL environment variable or create a config file at:
 * ~/.claude/auto-resume/slack-config.json with {"webhookUrl": "your-url"}
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const url = require('url');

// Get Slack webhook URL from env or config file
const getWebhookUrl = () => {
  // Try environment variable first
  if (process.env.SLACK_WEBHOOK_URL) {
    return process.env.SLACK_WEBHOOK_URL;
  }

  // Try config file
  try {
    const configPath = path.join(os.homedir(), '.claude', 'auto-resume', 'slack-config.json');

    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return config.webhookUrl;
    }
  } catch (error) {
    console.error(`[slack-notify] Error reading config file:`, error.message);
  }

  return null;
};

// Send message to Slack
const sendSlackMessage = async (message) => {
  const webhookUrl = getWebhookUrl();

  if (!webhookUrl) {
    console.warn('[slack-notify] No webhook URL configured. Set SLACK_WEBHOOK_URL env var or create ~/.claude/auto-resume/slack-config.json');
    return;
  }

  return new Promise((resolve, reject) => {
    const parsedUrl = url.parse(webhookUrl);
    const protocol = parsedUrl.protocol === 'https:' ? https : http;

    const payload = JSON.stringify(message);

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const req = protocol.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode === 200) {
          console.log('[slack-notify] Message sent successfully');
          resolve(data);
        } else {
          console.error(`[slack-notify] Failed to send message: ${res.statusCode} ${data}`);
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', (error) => {
      console.error('[slack-notify] Request error:', error.message);
      reject(error);
    });

    req.write(payload);
    req.end();
  });
};

// Format a duration in human-readable form
const formatDuration = (seconds) => {
  if (seconds < 60) return `${seconds} seconds`;

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (minutes < 60) {
    return remainingSeconds > 0
      ? `${minutes} minutes ${remainingSeconds} seconds`
      : `${minutes} minutes`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  return remainingMinutes > 0
    ? `${hours} hours ${remainingMinutes} minutes`
    : `${hours} hours`;
};

module.exports = {
  name: 'slack-notify',
  version: '1.0.0',
  description: 'Sends Slack notifications for rate limits',

  hooks: {
    /**
     * Called when a rate limit is detected
     * @param {Object} event - Event data
     * @param {string} event.timestamp - ISO timestamp
     * @param {number} event.resetTime - Unix timestamp when rate limit resets
     * @param {string} event.conversationId - ID of the conversation
     */
    onRateLimitDetected: async (event) => {
      try {
        const resetTime = new Date(event.resetTime * 1000);
        const now = new Date();
        const waitSeconds = Math.ceil((resetTime - now) / 1000);

        const message = {
          text: ':warning: Claude Code Rate Limit Detected',
          blocks: [
            {
              type: 'header',
              text: {
                type: 'plain_text',
                text: ':warning: Rate Limit Detected',
                emoji: true
              }
            },
            {
              type: 'section',
              fields: [
                {
                  type: 'mrkdwn',
                  text: `*Conversation:*\n${event.conversationId}`
                },
                {
                  type: 'mrkdwn',
                  text: `*Time:*\n${event.timestamp}`
                }
              ]
            },
            {
              type: 'section',
              fields: [
                {
                  type: 'mrkdwn',
                  text: `*Reset Time:*\n${resetTime.toLocaleString()}`
                },
                {
                  type: 'mrkdwn',
                  text: `*Wait Duration:*\n${formatDuration(waitSeconds)}`
                }
              ]
            },
            {
              type: 'context',
              elements: [
                {
                  type: 'mrkdwn',
                  text: 'Auto-resume will continue the conversation after the rate limit resets.'
                }
              ]
            }
          ]
        };

        await sendSlackMessage(message);
      } catch (error) {
        console.error('[slack-notify] Error sending rate limit notification:', error.message);
      }
    },

    /**
     * Called when a resume message is sent
     * @param {Object} event - Event data
     * @param {string} event.timestamp - ISO timestamp
     * @param {string} event.conversationId - ID of the conversation
     * @param {string} event.message - Resume message content
     */
    onResumeSent: async (event) => {
      try {
        const message = {
          text: ':white_check_mark: Conversation Resumed',
          blocks: [
            {
              type: 'header',
              text: {
                type: 'plain_text',
                text: ':white_check_mark: Conversation Resumed',
                emoji: true
              }
            },
            {
              type: 'section',
              fields: [
                {
                  type: 'mrkdwn',
                  text: `*Conversation:*\n${event.conversationId}`
                },
                {
                  type: 'mrkdwn',
                  text: `*Time:*\n${event.timestamp}`
                }
              ]
            },
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*Resume Message:*\n${event.message}`
              }
            }
          ]
        };

        await sendSlackMessage(message);
      } catch (error) {
        console.error('[slack-notify] Error sending resume notification:', error.message);
      }
    }
  }
};
