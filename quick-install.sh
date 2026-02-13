#!/usr/bin/env bash

###############################################################################
# Auto Claude Resume — One-Line Bootstrap Installer
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/Muminur/auto-claude-resume-after-limit-reset/main/quick-install.sh | bash
#
# What it does:
#   1. Checks prerequisites (Node.js, git, xdotool on Linux)
#   2. Clones the repo to a temp directory
#   3. Runs install.sh non-interactively
#   4. Cleans up the temp directory
#   5. Verifies installation
###############################################################################

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m'

log_info()    { echo -e "${CYAN}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $1"; }

REPO_URL="https://github.com/Muminur/auto-claude-resume-after-limit-reset.git"

echo ""
echo -e "${MAGENTA}  ╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${MAGENTA}  ║          Auto Claude Resume — Quick Installer                ║${NC}"
echo -e "${MAGENTA}  ╚═══════════════════════════════════════════════════════════════╝${NC}"
echo ""

###############################################################################
# 1. Check prerequisites
###############################################################################

# Detect OS
OS="$(uname -s)"
case "${OS}" in
    Linux*)     PLATFORM=linux;;
    Darwin*)    PLATFORM=macos;;
    *)          PLATFORM=unknown;;
esac

log_info "Platform: ${PLATFORM}"

# Check git
if ! command -v git &>/dev/null; then
    log_error "git is not installed."
    echo ""
    echo "Install git first:"
    if [[ "$PLATFORM" == "linux" ]]; then
        echo "  sudo apt-get install -y git      # Ubuntu/Debian"
        echo "  sudo dnf install -y git           # Fedora"
        echo "  sudo pacman -S --noconfirm git    # Arch"
    elif [[ "$PLATFORM" == "macos" ]]; then
        echo "  xcode-select --install"
        echo "  # or: brew install git"
    fi
    exit 1
fi
log_success "git found"

# Check Node.js
if ! command -v node &>/dev/null; then
    log_error "Node.js is not installed (v16+ required)."
    echo ""
    echo "Install Node.js first:"
    if [[ "$PLATFORM" == "linux" ]]; then
        echo "  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -"
        echo "  sudo apt-get install -y nodejs"
        echo ""
        echo "  Or use nvm:"
        echo "  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash"
        echo "  nvm install 20"
    elif [[ "$PLATFORM" == "macos" ]]; then
        echo "  brew install node"
        echo "  # or visit: https://nodejs.org/"
    fi
    exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [[ "$NODE_VERSION" -lt 16 ]]; then
    log_error "Node.js $(node -v) is too old. v16+ required."
    exit 1
fi
log_success "Node.js $(node -v) found"

# Check npm
if ! command -v npm &>/dev/null; then
    log_error "npm is not installed. Install Node.js with npm included."
    exit 1
fi
log_success "npm $(npm -v) found"

# Linux: check/install xdotool
if [[ "$PLATFORM" == "linux" ]]; then
    if ! command -v xdotool &>/dev/null; then
        log_warning "xdotool not found (required for auto-resume on Linux)"
        log_info "Attempting to install xdotool..."

        INSTALL_CMD=""
        if command -v apt-get &>/dev/null; then
            INSTALL_CMD="apt-get install -y xdotool"
        elif command -v dnf &>/dev/null; then
            INSTALL_CMD="dnf install -y xdotool"
        elif command -v yum &>/dev/null; then
            INSTALL_CMD="yum install -y xdotool"
        elif command -v pacman &>/dev/null; then
            INSTALL_CMD="pacman -S --noconfirm xdotool"
        elif command -v zypper &>/dev/null; then
            INSTALL_CMD="zypper install -y xdotool"
        fi

        if [[ -n "$INSTALL_CMD" ]]; then
            # Try non-interactive sudo, then pkexec for GUI prompt
            if sudo -n true 2>/dev/null; then
                sudo $INSTALL_CMD
            elif command -v pkexec &>/dev/null; then
                log_info "Using graphical authentication prompt..."
                pkexec $INSTALL_CMD
            else
                log_info "Trying sudo (may prompt for password)..."
                sudo $INSTALL_CMD
            fi

            if command -v xdotool &>/dev/null; then
                log_success "xdotool installed"
            else
                log_warning "xdotool installation failed. Install manually:"
                echo "  sudo apt-get install -y xdotool"
                echo ""
                log_info "Continuing without xdotool — the plugin will install but won't send keystrokes."
            fi
        else
            log_warning "Could not determine package manager. Install xdotool manually."
        fi
    else
        log_success "xdotool found"
    fi
fi

###############################################################################
# 2. Clone to temp directory
###############################################################################

TEMP_DIR=$(mktemp -d)
log_info "Cloning repository to ${TEMP_DIR}..."

if ! git clone --depth 1 "$REPO_URL" "$TEMP_DIR/auto-claude-resume" 2>&1; then
    log_error "Failed to clone repository."
    rm -rf "$TEMP_DIR"
    exit 1
fi
log_success "Repository cloned"

###############################################################################
# 3. Run install.sh non-interactively
###############################################################################

INSTALL_SCRIPT="${TEMP_DIR}/auto-claude-resume/install.sh"
chmod +x "$INSTALL_SCRIPT"

log_info "Running installer..."

# Pipe "n" to skip the systemd/launchd service prompt (user can set it up later)
echo "n" | bash "$INSTALL_SCRIPT" 2>&1

###############################################################################
# 4. Clean up
###############################################################################

log_info "Cleaning up temp files..."
rm -rf "$TEMP_DIR"
log_success "Temp directory removed"

###############################################################################
# 5. Verify installation
###############################################################################

echo ""
log_info "Verifying installation..."

ERRORS=0

# Check hook file
if [[ -f "$HOME/.claude/hooks/rate-limit-hook.js" ]]; then
    log_success "Stop hook installed"
else
    log_error "Stop hook not found at ~/.claude/hooks/rate-limit-hook.js"
    ERRORS=$((ERRORS + 1))
fi

# Check daemon file
if [[ -f "$HOME/.claude/auto-resume/auto-resume-daemon.js" ]]; then
    log_success "Daemon installed"
else
    log_error "Daemon not found at ~/.claude/auto-resume/auto-resume-daemon.js"
    ERRORS=$((ERRORS + 1))
fi

# Check ensure-daemon-running
if [[ -f "$HOME/.claude/auto-resume/ensure-daemon-running.js" ]]; then
    log_success "SessionStart hook helper installed"
else
    log_error "ensure-daemon-running.js not found"
    ERRORS=$((ERRORS + 1))
fi

# Check settings.json hooks
if [[ -f "$HOME/.claude/settings.json" ]]; then
    if grep -q "rate-limit-hook" "$HOME/.claude/settings.json"; then
        log_success "Stop hook registered in settings.json"
    else
        log_warning "Stop hook not found in settings.json"
        ERRORS=$((ERRORS + 1))
    fi
    if grep -q "ensure-daemon-running" "$HOME/.claude/settings.json"; then
        log_success "SessionStart hook registered in settings.json"
    else
        log_warning "SessionStart hook not found in settings.json"
        ERRORS=$((ERRORS + 1))
    fi
else
    log_error "~/.claude/settings.json not found"
    ERRORS=$((ERRORS + 1))
fi

echo ""
if [[ "$ERRORS" -eq 0 ]]; then
    echo -e "${GREEN}  ╔═══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}  ║               Installation complete!                         ║${NC}"
    echo -e "${GREEN}  ╚═══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo "  The daemon will start automatically the next time you open Claude Code."
    echo ""
    echo "  To start it now:"
    echo "    node ~/.claude/auto-resume/auto-resume-daemon.js start"
    echo ""
    echo "  To verify it's running:"
    echo "    node ~/.claude/auto-resume/auto-resume-daemon.js status"
    echo ""
else
    log_warning "Installation completed with $ERRORS warning(s). Check messages above."
fi
