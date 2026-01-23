# Auto-Resume Plugin Enhancement Plan

## Overview
Comprehensive feature roadmap for enhancing the Auto-Resume plugin with WebSocket support, notifications, configuration, analytics, and a GUI interface.

---

## Milestone 1: Configuration System Foundation
**Priority:** Critical (dependency for other features)
**Estimated Complexity:** Medium

### Tasks
- [ ] 1.1 Design configuration schema (JSON Schema)
- [ ] 1.2 Create `config-manager.js` module
- [ ] 1.3 Implement config file loading from `~/.claude/auto-resume/config.json`
- [ ] 1.4 Add default configuration with sensible defaults
- [ ] 1.5 Create `/auto-resume:config` command for viewing/editing config
- [ ] 1.6 Write tests for config-manager
- [ ] 1.7 Update daemon to use configuration

### Configuration Options
```json
{
  "resumePrompt": "continue",
  "checkInterval": 5000,
  "logLevel": "info",
  "notifications": { "enabled": true, "sound": false },
  "websocket": { "enabled": false, "port": 3847 },
  "api": { "enabled": false, "port": 3848 },
  "analytics": { "enabled": true, "retentionDays": 30 },
  "watchPaths": ["~/.claude/auto-resume/status.json"]
}
```

---

## Milestone 2: Desktop Notifications
**Priority:** High (immediate user value)
**Estimated Complexity:** Low-Medium

### Tasks
- [ ] 2.1 Add `node-notifier` dependency
- [ ] 2.2 Create `notification-manager.js` module
- [ ] 2.3 Implement cross-platform notification sending
- [ ] 2.4 Add notification on rate limit detection
- [ ] 2.5 Add notification on session resume
- [ ] 2.6 Add notification settings to config (enable/disable, sound)
- [ ] 2.7 Write tests for notification-manager
- [ ] 2.8 Create `/auto-resume:notify` command for testing notifications

---

## Milestone 3: Multiple Status File Watching
**Priority:** Medium (multi-session support)
**Estimated Complexity:** Medium

### Tasks
- [ ] 3.1 Create `status-watcher.js` module with file watcher abstraction
- [ ] 3.2 Implement multi-file watching using `chokidar`
- [ ] 3.3 Add status aggregation for multiple sessions
- [ ] 3.4 Update daemon to support multiple watch paths from config
- [ ] 3.5 Add session identification/labeling
- [ ] 3.6 Write tests for status-watcher
- [ ] 3.7 Update `/auto-resume:status` command to show all sessions

---

## Milestone 4: WebSocket-Based Status Updates
**Priority:** High (real-time updates for GUI)
**Estimated Complexity:** High

### Tasks
- [ ] 4.1 Add `ws` WebSocket library dependency
- [ ] 4.2 Create `websocket-server.js` module
- [ ] 4.3 Implement WebSocket server with configurable port
- [ ] 4.4 Define message protocol (JSON-RPC style)
- [ ] 4.5 Broadcast status changes to connected clients
- [ ] 4.6 Add client subscription/filtering support
- [ ] 4.7 Implement heartbeat/connection health
- [ ] 4.8 Write tests for websocket-server
- [ ] 4.9 Create test client for debugging

### Message Protocol
```json
{ "type": "status", "data": { "session": "...", "state": "rate_limited", "resetTime": "..." } }
{ "type": "event", "data": { "event": "resume_sent", "timestamp": "..." } }
{ "type": "subscribe", "data": { "sessions": ["*"] } }
```

---

## Milestone 5: Status API Endpoint
**Priority:** Medium (integration support)
**Estimated Complexity:** Medium

### Tasks
- [ ] 5.1 Create `api-server.js` module using native `http` module
- [ ] 5.2 Implement RESTful endpoints
- [ ] 5.3 Add CORS support for browser access
- [ ] 5.4 Implement rate limiting for API
- [ ] 5.5 Add API key authentication (optional)
- [ ] 5.6 Write tests for api-server
- [ ] 5.7 Document API endpoints

### API Endpoints
```
GET  /api/status          - All sessions status
GET  /api/status/:session - Single session status
GET  /api/config          - Current configuration
POST /api/resume/:session - Force resume a session
GET  /api/analytics       - Analytics data
GET  /api/health          - Health check
```

---

## Milestone 6: Rate Limit Prediction & Analytics
**Priority:** Medium (insights)
**Estimated Complexity:** High

### Tasks
- [ ] 6.1 Create `analytics-collector.js` module
- [ ] 6.2 Design analytics data schema (SQLite or JSON)
- [ ] 6.3 Track rate limit events (time, duration, frequency)
- [ ] 6.4 Implement rolling statistics calculation
- [ ] 6.5 Create prediction algorithm based on usage patterns
- [ ] 6.6 Add `/auto-resume:analytics` command
- [ ] 6.7 Write tests for analytics-collector
- [ ] 6.8 Add data export functionality

### Analytics Data Points
- Rate limit occurrences per day/hour
- Average wait time
- Peak usage periods
- Prediction confidence score

---

## Milestone 7: Plugin System for Custom Actions
**Priority:** Low (extensibility)
**Estimated Complexity:** High

### Tasks
- [ ] 7.1 Design plugin interface specification
- [ ] 7.2 Create `plugin-loader.js` module
- [ ] 7.3 Implement plugin discovery from `~/.claude/auto-resume/plugins/`
- [ ] 7.4 Define lifecycle hooks (onRateLimitDetected, onResumeSent, etc.)
- [ ] 7.5 Create plugin validation and sandboxing
- [ ] 7.6 Build example plugins (Slack notify, log to file)
- [ ] 7.7 Write tests for plugin-loader
- [ ] 7.8 Document plugin development guide

### Plugin Interface
```javascript
module.exports = {
  name: 'slack-notifier',
  version: '1.0.0',
  hooks: {
    onRateLimitDetected: async (event) => { /* ... */ },
    onResumeSent: async (event) => { /* ... */ }
  }
};
```

---

## Milestone 8: GUI Interface for Status Monitoring
**Priority:** Low (nice-to-have)
**Estimated Complexity:** Very High

### Tasks
- [ ] 8.1 Create `gui/` directory structure
- [ ] 8.2 Build static HTML/CSS/JS dashboard
- [ ] 8.3 Implement WebSocket client for real-time updates
- [ ] 8.4 Display session status cards
- [ ] 8.5 Add analytics charts (Chart.js)
- [ ] 8.6 Implement configuration editor in GUI
- [ ] 8.7 Add manual resume button
- [ ] 8.8 Create system tray integration (Electron optional)
- [ ] 8.9 Write E2E tests for GUI
- [ ] 8.10 Add `/auto-resume:gui` command to open dashboard

---

## Implementation Order (Recommended)

```
Phase 1: Foundation
├── Milestone 1: Configuration System ← START HERE
└── Milestone 2: Desktop Notifications

Phase 2: Multi-Session & Real-Time
├── Milestone 3: Multiple Status File Watching
└── Milestone 4: WebSocket Status Updates

Phase 3: API & Analytics
├── Milestone 5: Status API Endpoint
└── Milestone 6: Rate Limit Prediction

Phase 4: Extensibility & GUI
├── Milestone 7: Plugin System
└── Milestone 8: GUI Interface
```

---

## Testing Strategy

### Unit Tests
- Each module has corresponding `*.test.js` file
- Use Jest as test runner
- Mock file system and network operations

### Integration Tests
- Test daemon with all modules integrated
- Test WebSocket + API + GUI communication

### E2E Tests
- Simulate rate limit detection → notification → resume flow
- Test GUI interactions with Playwright

---

## Dependencies to Add

```json
{
  "dependencies": {
    "chokidar": "^3.5.3",
    "node-notifier": "^10.0.1",
    "ws": "^8.16.0",
    "better-sqlite3": "^9.4.3"
  },
  "devDependencies": {
    "jest": "^29.7.0"
  }
}
```

---

## Current Progress

| Milestone | Status | Progress |
|-----------|--------|----------|
| 1. Configuration System | Complete | 100% |
| 2. Desktop Notifications | Complete | 100% |
| 3. Multi-File Watching | Complete | 100% |
| 4. WebSocket Updates | Complete | 100% |
| 5. Status API | Complete | 100% |
| 6. Analytics | Complete | 100% |
| 7. Plugin System | Complete | 100% |
| 8. GUI Interface | Complete | 100% |

---

## Files Created

### Core Modules
- `src/modules/config-manager.js` - Configuration management system
- `src/modules/notification-manager.js` - Cross-platform desktop notifications
- `src/modules/status-watcher.js` - Multi-file status watching with chokidar
- `src/modules/websocket-server.js` - WebSocket server for real-time updates
- `src/modules/api-server.js` - RESTful API endpoint server
- `src/modules/analytics-collector.js` - Rate limit analytics and predictions
- `src/modules/plugin-loader.js` - Dynamic plugin loading system

### GUI Interface
- `gui/index.html` - Dashboard HTML structure
- `gui/styles.css` - Dashboard styling
- `gui/app.js` - WebSocket client and UI logic

### Test Suite
- `tests/config-manager.test.js` - Configuration system tests
- `tests/notification-manager.test.js` - Notification system tests
- `tests/status-watcher.test.js` - Multi-file watcher tests
- `tests/websocket-server.test.js` - WebSocket server tests
- `tests/api-server.test.js` - API endpoint tests
- `tests/analytics-collector.test.js` - Analytics system tests

### Commands
- `commands/config.md` - Configuration management command
- `commands/gui.md` - GUI launcher command
- `commands/analytics.md` - Analytics viewer command
- `commands/notify.md` - Notification test command

### Examples
- `examples/plugins/slack-notifier.js` - Slack notification plugin
- `examples/plugins/discord-webhook.js` - Discord webhook plugin

---

## Notes

- All new modules follow existing code style (ES6, async/await)
- Cross-platform compatibility required (Windows, macOS, Linux)
- No breaking changes to existing functionality
- Configuration migration path for existing users
