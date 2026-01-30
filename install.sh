#!/usr/bin/env bash

###############################################################################
# Claude Code Auto-Resume Plugin Installer
#
# Installation script for Linux and macOS
# Supports installation, uninstallation, and system checks
#
# Usage:
#   ./install.sh              Install the plugin
#   ./install.sh --uninstall  Remove the plugin
#   ./install.sh --check      Check system requirements
###############################################################################

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Detect OS
OS="$(uname -s)"
case "${OS}" in
    Linux*)     PLATFORM=linux;;
    Darwin*)    PLATFORM=macos;;
    *)          PLATFORM=unknown;;
esac

# Directories
CLAUDE_DIR="${HOME}/.claude"
HOOKS_DIR="${CLAUDE_DIR}/hooks"
AUTO_RESUME_DIR="${CLAUDE_DIR}/auto-resume"
PLUGIN_CACHE_DIR="${CLAUDE_DIR}/plugins/cache/auto-claude-resume"
SETTINGS_FILE="${CLAUDE_DIR}/settings.json"

# Source files (in same directory as installer)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK_SOURCE="${SCRIPT_DIR}/hooks/rate-limit-hook.js"
DAEMON_SOURCE="${SCRIPT_DIR}/auto-resume-daemon.js"
PACKAGE_SOURCE="${SCRIPT_DIR}/package.json"

# Destination files
HOOK_DEST="${HOOKS_DIR}/rate-limit-hook.js"
DAEMON_DEST="${AUTO_RESUME_DIR}/auto-resume-daemon.js"
PACKAGE_DEST="${AUTO_RESUME_DIR}/package.json"

# Service files
SYSTEMD_SERVICE_NAME="claude-auto-resume"
SYSTEMD_SERVICE_FILE="${HOME}/.config/systemd/user/${SYSTEMD_SERVICE_NAME}.service"
LAUNCHD_PLIST_NAME="com.claude.auto-resume"
LAUNCHD_PLIST_FILE="${HOME}/Library/LaunchAgents/${LAUNCHD_PLIST_NAME}.plist"

###############################################################################
# Logging Functions
###############################################################################

log_info() {
    echo -e "${CYAN}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_step() {
    echo -e "${MAGENTA}▶${NC} $1"
}

show_banner() {
    echo ""
    echo -e "${MAGENTA}  ╔═══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${MAGENTA}  ║       Claude Code Auto-Resume Plugin Installer v1.0.0        ║${NC}"
    echo -e "${MAGENTA}  ║              Linux & macOS Installation Script               ║${NC}"
    echo -e "${MAGENTA}  ╚═══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
}

###############################################################################
# System Checks
###############################################################################

check_node() {
    log_step "Checking Node.js installation..."

    if ! command -v node &> /dev/null; then
        log_error "Node.js is not installed"
        echo ""
        echo "Please install Node.js (v16 or higher):"
        echo "  - Visit: https://nodejs.org/"
        echo "  - Or use a package manager:"
        if [[ "$PLATFORM" == "linux" ]]; then
            echo "    Ubuntu/Debian: sudo apt install nodejs npm"
            echo "    RHEL/CentOS: sudo yum install nodejs npm"
            echo "    Arch: sudo pacman -S nodejs npm"
        else
            echo "    macOS: brew install node"
        fi
        return 1
    fi

    NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
    if [[ "$NODE_VERSION" -lt 16 ]]; then
        log_warning "Node.js version $(node -v) detected. v16+ recommended."
    else
        log_success "Node.js $(node -v) detected"
    fi

    return 0
}

check_xdotool_linux() {
    log_step "Checking xdotool (required for Linux)..."

    if ! command -v xdotool &> /dev/null; then
        log_warning "xdotool not found (required for sending keystrokes)"
        echo ""
        echo "Install xdotool with:"
        echo "  Ubuntu/Debian: sudo apt-get install xdotool"
        echo "  RHEL/CentOS:   sudo yum install xdotool"
        echo "  Arch Linux:    sudo pacman -S xdotool"
        echo "  Fedora:        sudo dnf install xdotool"
        echo ""
        read -p "Install xdotool now? (requires sudo) [y/N]: " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            if command -v apt-get &> /dev/null; then
                sudo apt-get install -y xdotool
            elif command -v yum &> /dev/null; then
                sudo yum install -y xdotool
            elif command -v dnf &> /dev/null; then
                sudo dnf install -y xdotool
            elif command -v pacman &> /dev/null; then
                sudo pacman -S --noconfirm xdotool
            else
                log_error "Could not determine package manager"
                return 1
            fi
            log_success "xdotool installed"
        else
            log_warning "Skipping xdotool installation. Auto-resume may not work."
        fi
    else
        log_success "xdotool is installed"
    fi

    return 0
}

check_accessibility_macos() {
    log_step "Checking accessibility permissions (macOS)..."

    log_warning "macOS requires accessibility permissions for keyboard automation"
    echo ""
    echo "After installation, you may need to:"
    echo "  1. Open System Preferences > Security & Privacy > Accessibility"
    echo "  2. Add Terminal.app or iTerm.app to the list"
    echo "  3. Enable the checkbox next to it"
    echo ""
    log_info "Press Enter to continue..."
    read

    return 0
}

check_jq() {
    if command -v jq &> /dev/null; then
        log_success "jq detected (will use for JSON merging)"
        return 0
    else
        log_info "jq not found (will use fallback JSON merge)"
        return 1
    fi
}

check_requirements() {
    show_banner
    log_info "Platform: ${PLATFORM}"
    echo ""

    # Check Node.js
    if ! check_node; then
        return 1
    fi

    # Platform-specific checks
    if [[ "$PLATFORM" == "linux" ]]; then
        check_xdotool_linux
    elif [[ "$PLATFORM" == "macos" ]]; then
        check_accessibility_macos
    fi

    # Check jq
    check_jq

    echo ""
    return 0
}

###############################################################################
# Installation Functions
###############################################################################

create_directories() {
    log_step "Creating directory structure..."

    mkdir -p "$CLAUDE_DIR"
    mkdir -p "$HOOKS_DIR"
    mkdir -p "$AUTO_RESUME_DIR"

    log_success "Directories created"
}

copy_files() {
    log_step "Copying plugin files..."

    # Check if source files exist
    if [[ ! -f "$HOOK_SOURCE" ]]; then
        log_error "Hook source not found: $HOOK_SOURCE"
        return 1
    fi

    if [[ ! -f "$DAEMON_SOURCE" ]]; then
        log_error "Daemon source not found: $DAEMON_SOURCE"
        return 1
    fi

    # Copy files
    cp "$HOOK_SOURCE" "$HOOK_DEST"
    cp "$DAEMON_SOURCE" "$DAEMON_DEST"

    if [[ -f "$PACKAGE_SOURCE" ]]; then
        cp "$PACKAGE_SOURCE" "$PACKAGE_DEST"
    fi

    # Make scripts executable
    chmod +x "$HOOK_DEST"
    chmod +x "$DAEMON_DEST"

    log_success "Files copied and made executable"
}

update_settings() {
    log_step "Updating Claude settings.json..."

    # Hook configuration
    local HOOK_CONFIG='{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node ~/.claude/hooks/rate-limit-hook.js",
            "timeout": 10
          }
        ]
      }
    ]
  }
}'

    if [[ ! -f "$SETTINGS_FILE" ]]; then
        # Create new settings file
        log_info "Creating new settings.json..."
        echo "$HOOK_CONFIG" > "$SETTINGS_FILE"
        log_success "Settings file created"
    else
        # Merge with existing settings
        log_info "Merging with existing settings.json..."

        if command -v jq &> /dev/null; then
            # Use jq for proper JSON merging
            local TEMP_FILE=$(mktemp)
            jq -s '.[0] * .[1]' "$SETTINGS_FILE" <(echo "$HOOK_CONFIG") > "$TEMP_FILE"
            mv "$TEMP_FILE" "$SETTINGS_FILE"
            log_success "Settings merged using jq"
        else
            # Fallback: manual merge (basic)
            log_warning "jq not available, using fallback merge"

            # Backup original
            cp "$SETTINGS_FILE" "${SETTINGS_FILE}.backup"
            log_info "Backup created: ${SETTINGS_FILE}.backup"

            # Check if hooks section already exists
            if grep -q '"hooks"' "$SETTINGS_FILE"; then
                log_warning "Hooks section already exists in settings.json"
                log_warning "Please manually add the Stop hook configuration:"
                echo ""
                echo "$HOOK_CONFIG"
                echo ""
            else
                # Simple append (won't work for all JSON structures)
                local TEMP_FILE=$(mktemp)

                # Remove closing brace, add hooks, re-add closing brace
                sed '$ d' "$SETTINGS_FILE" > "$TEMP_FILE"

                # Add comma if file has content
                if [[ -s "$TEMP_FILE" ]]; then
                    echo "," >> "$TEMP_FILE"
                fi

                # Add hooks section
                echo '  "hooks": {' >> "$TEMP_FILE"
                echo '    "Stop": [' >> "$TEMP_FILE"
                echo '      {' >> "$TEMP_FILE"
                echo '        "hooks": [' >> "$TEMP_FILE"
                echo '          {' >> "$TEMP_FILE"
                echo '            "type": "command",' >> "$TEMP_FILE"
                echo '            "command": "node ~/.claude/hooks/rate-limit-hook.js",' >> "$TEMP_FILE"
                echo '            "timeout": 10' >> "$TEMP_FILE"
                echo '          }' >> "$TEMP_FILE"
                echo '        ]' >> "$TEMP_FILE"
                echo '      }' >> "$TEMP_FILE"
                echo '    ]' >> "$TEMP_FILE"
                echo '  }' >> "$TEMP_FILE"
                echo '}' >> "$TEMP_FILE"

                mv "$TEMP_FILE" "$SETTINGS_FILE"
                log_success "Settings merged"
            fi
        fi
    fi
}

verify_stop_hook() {
    log_step "Verifying Stop hook registration..."

    if [[ ! -f "$SETTINGS_FILE" ]]; then
        log_warning "Settings file not found, skipping verification"
        return 0
    fi

    # Check if rate-limit-hook.js is already in settings
    if grep -q "rate-limit-hook.js" "$SETTINGS_FILE"; then
        log_success "Stop hook already registered"
        return 0
    fi

    log_warning "Stop hook missing, adding..."

    if command -v jq &> /dev/null; then
        # Safe append using jq - preserves existing hooks
        local TEMP_FILE=$(mktemp)
        local HOOK_ENTRY='{
          "type": "command",
          "command": "node ~/.claude/hooks/rate-limit-hook.js",
          "timeout": 10
        }'

        # Ensure hooks.Stop array exists and append to it
        jq --argjson entry "$HOOK_ENTRY" '
          .hooks //= {} |
          .hooks.Stop //= [] |
          .hooks.Stop += [{"hooks": [$entry]}]
        ' "$SETTINGS_FILE" > "$TEMP_FILE" && mv "$TEMP_FILE" "$SETTINGS_FILE"

        log_success "Stop hook registered (via jq)"
    else
        log_warning "jq not available. Please manually add the Stop hook to ~/.claude/settings.json"
        log_info "See installation guide for the JSON snippet to add"
    fi
}

install_dependencies() {
    log_step "Installing npm dependencies..."

    if [[ ! -f "$PACKAGE_DEST" ]]; then
        log_warning "package.json not found, skipping npm install"
        return 0
    fi

    cd "$AUTO_RESUME_DIR"

    if command -v npm &> /dev/null; then
        npm install --production 2>&1 | sed 's/^/  /'
        log_success "Dependencies installed"

        # Ensure critical dependencies for dashboard are installed
        log_info "Verifying dashboard dependencies (ws, node-notifier)..."
        npm install ws node-notifier --save 2>&1 | sed 's/^/  /'
        log_success "Dashboard dependencies verified"
    else
        log_warning "npm not found, dependencies not installed"
        log_warning "Please run 'npm install ws node-notifier --save' manually"
    fi
}

install_plugin_cache_dependencies() {
    log_step "Checking plugin cache dependencies..."

    # Find plugin cache directory
    local CACHE_DIR="${HOME}/.claude/plugins/cache/auto-claude-resume"

    if [[ -d "$CACHE_DIR" ]]; then
        # Find the version directory
        local VERSION_DIR=$(find "$CACHE_DIR" -maxdepth 2 -name "package.json" -exec dirname {} \; 2>/dev/null | head -1)

        if [[ -n "$VERSION_DIR" && -d "$VERSION_DIR" ]]; then
            log_info "Found plugin cache at: $VERSION_DIR"

            # Check if node_modules/ws exists
            if [[ ! -d "$VERSION_DIR/node_modules/ws" ]]; then
                log_info "Installing dashboard dependencies in plugin cache..."
                cd "$VERSION_DIR"
                npm install ws node-notifier --save 2>&1 | sed 's/^/  /'
                log_success "Plugin cache dependencies installed"
            else
                log_success "Plugin cache dependencies already installed"
            fi
        fi
    fi
}

create_systemd_service() {
    log_step "Creating systemd service..."

    local SERVICE_DIR="${HOME}/.config/systemd/user"
    mkdir -p "$SERVICE_DIR"

    cat > "$SYSTEMD_SERVICE_FILE" <<EOF
[Unit]
Description=Claude Code Auto-Resume Daemon
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/env node ${DAEMON_DEST} --monitor
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=default.target
EOF

    log_success "Systemd service file created: $SYSTEMD_SERVICE_FILE"

    # Reload systemd and enable service
    log_info "Enabling systemd service..."
    systemctl --user daemon-reload
    systemctl --user enable "$SYSTEMD_SERVICE_NAME"

    log_success "Service enabled (will start on next login)"
    echo ""
    log_info "To start the service now, run:"
    echo "  systemctl --user start $SYSTEMD_SERVICE_NAME"
    log_info "To check service status:"
    echo "  systemctl --user status $SYSTEMD_SERVICE_NAME"
}

create_launchd_service() {
    log_step "Creating launchd service..."

    local LAUNCHD_DIR="${HOME}/Library/LaunchAgents"
    mkdir -p "$LAUNCHD_DIR"

    cat > "$LAUNCHD_PLIST_FILE" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LAUNCHD_PLIST_NAME}</string>

    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>${DAEMON_DEST}</string>
        <string>--monitor</string>
    </array>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <true/>

    <key>StandardOutPath</key>
    <string>${AUTO_RESUME_DIR}/daemon.log</string>

    <key>StandardErrorPath</key>
    <string>${AUTO_RESUME_DIR}/daemon.error.log</string>
</dict>
</plist>
EOF

    log_success "Launchd plist created: $LAUNCHD_PLIST_FILE"

    # Load the service
    log_info "Loading launchd service..."
    launchctl load "$LAUNCHD_PLIST_FILE" 2>/dev/null || true

    log_success "Service loaded (will start on next login)"
    echo ""
    log_info "To start the service now, run:"
    echo "  launchctl start $LAUNCHD_PLIST_NAME"
    log_info "To check service status:"
    echo "  launchctl list | grep claude-auto-resume"
}

install() {
    show_banner

    # Check requirements
    if ! check_requirements; then
        log_error "Requirements check failed"
        exit 1
    fi

    # Create directory structure
    create_directories

    # Copy files
    if ! copy_files; then
        log_error "File copy failed"
        exit 1
    fi

    # Update settings
    update_settings

    # Verify Stop hook registration
    verify_stop_hook

    # Install dependencies
    install_dependencies

    # Create service
    echo ""
    if [[ "$PLATFORM" == "linux" ]]; then
        read -p "Create systemd service for auto-resume daemon? [Y/n]: " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Nn]$ ]]; then
            create_systemd_service
        else
            log_info "Skipping systemd service creation"
        fi
    elif [[ "$PLATFORM" == "macos" ]]; then
        read -p "Create launchd service for auto-resume daemon? [Y/n]: " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Nn]$ ]]; then
            create_launchd_service
        else
            log_info "Skipping launchd service creation"
        fi
    fi

    echo ""
    log_success "Installation complete!"
    echo ""
    echo -e "${GREEN}Next steps:${NC}"
    echo "  1. The rate limit hook is now active in Claude Code"
    echo "  2. Run the daemon manually: node ${DAEMON_DEST} --monitor"
    echo "  3. Or start the service (see instructions above)"
    echo ""
    log_info "For manual testing:"
    echo "  node ${DAEMON_DEST} --test 30"
    echo ""
}

###############################################################################
# Uninstallation Functions
###############################################################################

uninstall() {
    show_banner
    log_warning "Uninstalling Claude Code Auto-Resume Plugin..."
    echo ""

    # Stop and remove service
    if [[ "$PLATFORM" == "linux" ]]; then
        if [[ -f "$SYSTEMD_SERVICE_FILE" ]]; then
            log_step "Stopping and removing systemd service..."
            systemctl --user stop "$SYSTEMD_SERVICE_NAME" 2>/dev/null || true
            systemctl --user disable "$SYSTEMD_SERVICE_NAME" 2>/dev/null || true
            rm -f "$SYSTEMD_SERVICE_FILE"
            systemctl --user daemon-reload
            log_success "Systemd service removed"
        fi
    elif [[ "$PLATFORM" == "macos" ]]; then
        if [[ -f "$LAUNCHD_PLIST_FILE" ]]; then
            log_step "Stopping and removing launchd service..."
            launchctl unload "$LAUNCHD_PLIST_FILE" 2>/dev/null || true
            rm -f "$LAUNCHD_PLIST_FILE"
            log_success "Launchd service removed"
        fi
    fi

    # Remove files
    log_step "Removing plugin files..."
    rm -f "$HOOK_DEST"
    rm -f "$DAEMON_DEST"
    rm -f "$PACKAGE_DEST"
    rm -rf "$AUTO_RESUME_DIR"
    log_success "Plugin files removed"

    # Remove plugin cache
    if [[ -d "$PLUGIN_CACHE_DIR" ]]; then
        log_step "Removing plugin cache..."
        rm -rf "$PLUGIN_CACHE_DIR"
        log_success "Plugin cache removed: $PLUGIN_CACHE_DIR"
    fi

    # Remove hook from settings.json
    if [[ -f "$SETTINGS_FILE" ]]; then
        log_step "Removing hook from settings.json..."

        if command -v jq &> /dev/null; then
            local TEMP_FILE=$(mktemp)
            jq 'del(.hooks.Stop[] | select(.hooks[]?.command | contains("rate-limit-hook")))' \
                "$SETTINGS_FILE" > "$TEMP_FILE"
            mv "$TEMP_FILE" "$SETTINGS_FILE"
            log_success "Hook removed from settings.json"
        else
            log_warning "jq not available, please manually remove the Stop hook from:"
            echo "  $SETTINGS_FILE"
        fi
    fi

    echo ""
    log_success "Uninstallation complete!"
    echo ""
}

###############################################################################
# Main Script
###############################################################################

main() {
    # Parse arguments
    case "${1:-}" in
        --uninstall)
            uninstall
            ;;
        --check)
            check_requirements
            ;;
        --help|-h)
            show_banner
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  (no args)       Install the Claude Auto-Resume plugin"
            echo "  --uninstall     Remove the plugin"
            echo "  --check         Check system requirements"
            echo "  --help, -h      Show this help message"
            echo ""
            ;;
        *)
            install
            ;;
    esac
}

# Run main
main "$@"
