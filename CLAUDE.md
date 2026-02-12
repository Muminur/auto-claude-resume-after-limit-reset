# Auto Claude Resume - Project Instructions

## Git Commit Rules

- NEVER mention "Claude", "AI", or "assistant" in commit messages
- NEVER add Claude as author or co-author
- Use conventional commit format: `type(scope): message`

## Version Bump Policy

When modifying code files, bump the version before committing:

```bash
node scripts/bump-version.js        # Patch bump (1.2.4 -> 1.2.5)
node scripts/bump-version.js minor  # Minor bump (1.2.4 -> 1.3.0)
node scripts/bump-version.js major  # Major bump (1.2.4 -> 2.0.0)
```

Include version files in commits:
```bash
git add .claude-plugin/plugin.json .claude-plugin/marketplace.json
```

| Type | When to Use | Example |
|------|-------------|---------|
| `patch` | Bug fixes, doc updates | 1.2.3 -> 1.2.4 |
| `minor` | New features | 1.2.3 -> 1.3.0 |
| `major` | Breaking changes | 1.2.3 -> 2.0.0 |

## Key Files

| File | Purpose |
|------|---------|
| `auto-resume-daemon.js` | Main daemon (~60KB) — monitoring, countdown, keystroke injection |
| `systemd-wrapper.js` | Systemd wrapper — TCP anchor + explicit `main()` call |
| `hooks/rate-limit-hook.js` | Stop hook — detects rate limits in transcripts |
| `scripts/ensure-daemon-running.js` | SessionStart hook — auto-starts daemon |
| `config.json` | Default daemon configuration |
| `claude-auto-resume.service` | Systemd service file template |
| `tests/test-systemd-service.sh` | Bash test suite (24 tests) |
| `tests/cli.test.js` | Jest unit tests |

## Critical Implementation Notes

### require.main Guard

All modules that have a `main()` function MUST use:
```javascript
if (require.main === module) {
  main();
}
```

Without this guard, `require()`-ing the module will execute `main()`, which may call `process.exit()` and kill the parent process. This was the root cause of the daemon crashing under systemd.

### systemd-wrapper.js

- Creates a TCP server anchor BEFORE loading the daemon (prevents event loop drain)
- Calls `daemon.main()` explicitly (bypasses `require.main` guard)
- Sets `process.argv[2] = 'monitor'` as default command

### DISPLAY for systemd

The service file must have the correct DISPLAY and XAUTHORITY values for xdotool to work. These are NOT inherited from the user session in systemd.

### Tab Cycling

gnome-terminal tabs share a single window ID. The daemon counts bash children of `gnome-terminal-server` to detect tab count, then uses `Ctrl+PageDown` to cycle through all tabs.

## Testing Changes

```bash
# Run bash tests
bash tests/test-systemd-service.sh

# Run Jest tests
npx jest

# Live test (10s countdown + keystroke)
node auto-resume-daemon.js test

# After pushing, users re-install:
cd auto-claude-resume-after-limit-reset && git pull
./install.sh
```
