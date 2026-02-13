#!/bin/bash
# Setup script to add optional tmux wrapper for Claude Code.
# This makes the auto-resume daemon 100% reliable even when the screen is locked.
#
# Usage: bash scripts/setup-tmux-alias.sh

set -e

SHELL_RC=""
if [ -f "$HOME/.zshrc" ]; then
  SHELL_RC="$HOME/.zshrc"
elif [ -f "$HOME/.bashrc" ]; then
  SHELL_RC="$HOME/.bashrc"
else
  echo "Could not find .zshrc or .bashrc"
  exit 1
fi

MARKER="# claude-tmux-auto-resume"

if grep -q "$MARKER" "$SHELL_RC" 2>/dev/null; then
  echo "tmux wrapper already installed in $SHELL_RC"
  exit 0
fi

echo ""
echo "This will add a shell function to $SHELL_RC that launches Claude Code inside tmux."
echo "This makes auto-resume 100% reliable even when the screen is locked."
echo ""
echo "The function:"
echo '  claude() { tmux new-session -A -s claude-auto -- command claude "$@"; }'
echo ""
read -p "Install? (y/N) " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
  cat >> "$SHELL_RC" << 'EOFRC'

# claude-tmux-auto-resume
# Launches Claude Code inside tmux for reliable auto-resume when screen is locked
claude() { tmux new-session -A -s claude-auto -- command claude "$@"; }
EOFRC
  echo "Installed! Restart your shell or run: source $SHELL_RC"
else
  echo "Skipped. You can run this script again any time."
fi
