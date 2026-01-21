# Auto Claude Resume After Limit Reset

Automatically resume Claude Code terminal sessions when rate limits reset. This plugin monitors for rate limit messages and sends "continue" when the limit lifts.

## Features

- Detects Claude Code rate limit messages
- Parses reset time from various timezone formats (40+ timezones)
- Shows countdown timer until reset
- Automatically sends "continue" when limit resets
- Cross-platform: Windows, Linux, macOS
- Multiple interfaces: PowerShell, Bash, Node.js
- Can be installed as a Claude Code plugin

## Rate Limit Detection

When Claude Code hits the rate limit, you'll see:
```
You've hit your limit · resets 8pm (Asia/Dhaka)
```

This plugin parses that message, calculates the wait time, and auto-resumes when ready.

## Installation Guides

- [Windows Installation Guide](docs/INSTALL-WINDOWS.md)
- [Linux Installation Guide](docs/INSTALL-LINUX.md)
- [macOS Installation Guide](docs/INSTALL-MACOS.md)

## Quick Start

### Windows
```powershell
.\claude-auto-resume.ps1
```

### Linux/macOS
```bash
./claude-auto-resume.sh -i
```

### Node.js (Any Platform)
```bash
node index.js
```

## Operation Modes

### 1. Interactive Mode
Paste the rate limit message directly into the console.

### 2. Clipboard Monitor Mode
Continuously monitors clipboard - copy a rate limit message to trigger countdown.

### 3. Test Mode
Simulate a rate limit with custom countdown time.

## Command-Line Options

### PowerShell

| Option | Description |
|--------|-------------|
| `-MonitorMode` | Clipboard monitor mode |
| `-TestMode <seconds>` | Test with countdown |
| `-Prompt <text>` | Custom prompt (default: "continue") |
| `-WindowTitle <text>` | Target window title |
| `-Help` | Show help |
| `-ShowVersion` | Show version |

### Bash

| Option | Description |
|--------|-------------|
| `-m, --monitor` | Clipboard monitor mode |
| `-i, --interactive` | Interactive mode |
| `-t, --test <seconds>` | Test mode |
| `-p, --prompt <text>` | Custom prompt |
| `-h, --help` | Show help |

### Node.js

| Option | Description |
|--------|-------------|
| `-m, --monitor` | Clipboard monitor mode |
| `-i, --interactive` | Interactive mode |
| `--test <seconds>` | Test mode |
| `--prompt <text>` | Custom prompt |
| `-h, --help` | Show help |

## Supported Timezones

Asia, Americas, Europe, Australia, Pacific regions - 40+ timezones supported.

## Claude Code Plugin Installation

See the platform-specific installation guides for setting up as a Claude Code plugin:
- [Windows](docs/INSTALL-WINDOWS.md#claude-code-plugin-setup)
- [Linux](docs/INSTALL-LINUX.md#claude-code-plugin-setup)
- [macOS](docs/INSTALL-MACOS.md#claude-code-plugin-setup)

## License

MIT License

## Credits

Inspired by [terryso/claude-auto-resume](https://github.com/terryso/claude-auto-resume)
