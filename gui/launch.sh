#!/bin/bash
# AutoResume GUI Dashboard Launcher - macOS/Linux
# Opens the dashboard in your default browser

echo ""
echo " ============================================"
echo "  AutoResume GUI Dashboard Launcher"
echo " ============================================"
echo ""
echo " Opening dashboard in your default browser..."
echo ""

# Get the directory of this script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Detect OS and open browser accordingly
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    open "$SCRIPT_DIR/index.html"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    # Linux
    xdg-open "$SCRIPT_DIR/index.html" 2>/dev/null || \
    sensible-browser "$SCRIPT_DIR/index.html" 2>/dev/null || \
    echo " Error: Could not detect default browser. Please open gui/index.html manually."
fi

echo " Dashboard opened!"
echo ""
echo " Note: For full functionality (WebSocket support),"
echo " serve the GUI via HTTP server:"
echo ""
echo "   cd gui"
echo "   python -m http.server 8080"
echo ""
echo " Then open: http://localhost:8080"
echo ""
