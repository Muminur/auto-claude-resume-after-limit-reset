# Auto-Resume Plugin Examples

This directory contains example plugins that demonstrate how to extend the Auto-Resume plugin with custom functionality.

## Available Examples

### 1. console-logger

A minimal example plugin that logs events to the console with pretty formatting.

**Features:**
- Simple console output with box drawing
- Human-readable timestamps
- Time until reset display
- Perfect for learning how plugins work

**Installation:**
```bash
# Copy to your plugins directory
cp -r examples/plugins/console-logger ~/.claude/auto-resume/plugins/

# Enable in plugin.json
# Add to "plugins" array: "~/.claude/auto-resume/plugins/console-logger"
```

**Why start here?**
This is the simplest plugin example. Use it to understand the basic plugin structure before moving on to more complex examples like log-to-file or slack-notify.

### 2. log-to-file

Logs all auto-resume events to a file for debugging and auditing.

**Location:** `~/.claude/auto-resume/events.log`

**Features:**
- Logs rate limit detections
- Logs resume messages sent
- Logs plugin enable/disable events
- Human-readable log format with timestamps
- Automatic log directory creation

**Installation:**
```bash
# Copy to your plugins directory
cp -r examples/plugins/log-to-file ~/.claude/auto-resume/plugins/

# Enable in plugin.json
# Add to "plugins" array: "~/.claude/auto-resume/plugins/log-to-file"
```

### 3. slack-notify

Sends Slack notifications when rate limits are detected.

**Features:**
- Beautiful formatted Slack messages
- Shows reset time and wait duration
- Notifies when conversation resumes
- Configurable webhook URL

**Configuration:**

Option 1 - Environment variable:
```bash
export SLACK_WEBHOOK_URL="https://hooks.slack.com/services/YOUR/WEBHOOK/URL"
```

Option 2 - Config file:
```bash
# Create config file
mkdir -p ~/.claude/auto-resume
echo '{"webhookUrl": "https://hooks.slack.com/services/YOUR/WEBHOOK/URL"}' > ~/.claude/auto-resume/slack-config.json
```

**Installation:**
```bash
# Copy to your plugins directory
cp -r examples/plugins/slack-notify ~/.claude/auto-resume/plugins/

# Enable in plugin.json
# Add to "plugins" array: "~/.claude/auto-resume/plugins/slack-notify"
```

## Creating Your Own Plugin

### Plugin Structure

A plugin is a Node.js module that exports a configuration object:

```javascript
module.exports = {
  name: 'my-plugin',
  version: '1.0.0',
  description: 'What my plugin does',

  hooks: {
    onRateLimitDetected: async (event) => {
      // Handle rate limit detection
    },

    onResumeSent: async (event) => {
      // Handle resume message sent
    },

    onPluginEnabled: async (event) => {
      // Optional: initialization logic
    },

    onPluginDisabled: async (event) => {
      // Optional: cleanup logic
    }
  }
};
```

### Available Hooks

#### onRateLimitDetected

Called when a rate limit is detected.

**Event data:**
```javascript
{
  timestamp: "2026-01-24T10:30:00.000Z",  // ISO timestamp
  resetTime: 1737715800,                   // Unix timestamp (seconds)
  conversationId: "conv_abc123"            // Conversation ID
}
```

#### onResumeSent

Called when a resume message is sent.

**Event data:**
```javascript
{
  timestamp: "2026-01-24T10:35:00.000Z",  // ISO timestamp
  conversationId: "conv_abc123",           // Conversation ID
  message: "continue"                      // Resume message content
}
```

#### onPluginEnabled

Called when the plugin is enabled (optional).

**Event data:**
```javascript
{
  timestamp: "2026-01-24T10:00:00.000Z"   // ISO timestamp
}
```

#### onPluginDisabled

Called when the plugin is disabled (optional).

**Event data:**
```javascript
{
  timestamp: "2026-01-24T11:00:00.000Z"   // ISO timestamp
}
```

### Best Practices

1. **Error Handling**: Always wrap hook logic in try-catch blocks. Errors in plugins shouldn't crash the main plugin.

```javascript
onRateLimitDetected: async (event) => {
  try {
    // Your logic here
  } catch (error) {
    console.error('[my-plugin] Error:', error.message);
    // Don't throw - let other plugins continue
  }
}
```

2. **Async/Await**: All hooks should be async functions, even if they don't await anything.

3. **Logging**: Prefix console messages with your plugin name:
```javascript
console.log('[my-plugin] Did something');
console.error('[my-plugin] Error occurred');
```

4. **Configuration**: Store config in `~/.claude/auto-resume/`:
```javascript
const path = require('path');
const os = require('os');

const configPath = path.join(
  os.homedir(),
  '.claude',
  'auto-resume',
  'my-plugin-config.json'
);
```

5. **Cross-Platform**: Use Node.js `path` module for file paths:
```javascript
const path = require('path');
// Good: path.join(dir, 'file.txt')
// Bad:  dir + '/file.txt'
```

### Plugin Ideas

Here are some plugin ideas you could implement:

- **Email Notifications**: Send email when rate limits occur
- **Discord Bot**: Post to Discord channel
- **Metrics Collector**: Track rate limit patterns over time
- **Custom Resume Messages**: Generate context-aware resume messages
- **Integration with Task Managers**: Create tasks in Jira/Asana
- **Desktop Notifications**: Show OS-level notifications
- **Analytics Dashboard**: Send data to analytics service
- **SMS Alerts**: Text message notifications via Twilio
- **Custom Delays**: Adjust wait times based on time of day
- **Rate Limit Predictor**: ML-based prediction of rate limits

### Testing Your Plugin

1. Create your plugin directory:
```bash
mkdir -p ~/.claude/auto-resume/plugins/my-plugin
```

2. Create `index.js` with your plugin code

3. Add to `plugin.json`:
```json
{
  "plugins": [
    "~/.claude/auto-resume/plugins/my-plugin"
  ]
}
```

4. Trigger a rate limit to test (send many requests quickly)

5. Check logs:
```bash
# For log-to-file plugin
tail -f ~/.claude/auto-resume/events.log

# For your plugin
# Check wherever you're logging
```

### Plugin Loading

Plugins are loaded when Claude Code starts. To reload:
1. Make changes to your plugin
2. Restart Claude Code
3. Your updated plugin will be loaded

### Dependencies

Plugins can use built-in Node.js modules (fs, path, https, etc.) without additional installation.

For external dependencies:
1. Create a `package.json` in your plugin directory
2. Run `npm install` in that directory
3. Require dependencies normally

Example:
```bash
cd ~/.claude/auto-resume/plugins/my-plugin
npm init -y
npm install axios
```

```javascript
// In your plugin
const axios = require('axios');
```

### Distributing Plugins

To share your plugin:

1. Create a Git repository with your plugin code
2. Include a README with:
   - What the plugin does
   - How to configure it
   - Installation instructions
3. Publish to npm (optional)
4. Share the installation command

Example README:
```markdown
# My Awesome Plugin

Does something cool with auto-resume.

## Installation

git clone https://github.com/user/my-plugin.git ~/.claude/auto-resume/plugins/my-plugin

## Configuration

Set the SOME_API_KEY environment variable.

## Usage

Add to plugin.json plugins array:
"~/.claude/auto-resume/plugins/my-plugin"
```

## Contributing

Have a useful plugin? Consider contributing it to this repository!

1. Fork the repo
2. Add your plugin to `examples/plugins/`
3. Update this README
4. Submit a pull request

## Support

For issues with example plugins or questions about plugin development, please open an issue on the main repository.
