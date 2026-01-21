#!/bin/bash

#######################################################################
# Claude Code Auto-Resume Plugin for Linux/macOS
# Automatically resumes Claude Code terminal sessions when rate limits reset.
#
# Rate limit message pattern: "You've hit your limit · resets Xpm (Timezone)"
#
# Version: 1.0.0
# Platforms: Linux, macOS
#######################################################################

set -e

# Version information
VERSION="1.0.0"

# Default values
DEFAULT_PROMPT="continue"
PROMPT="$DEFAULT_PROMPT"
WINDOW_TITLE=""
TEST_MODE=0
MONITOR_MODE=false
INTERACTIVE_MODE=false

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Print colored output
print_color() {
    local color=$1
    local message=$2
    echo -e "${color}${message}${NC}"
}

print_info() {
    print_color "$CYAN" "[INFO] $1"
}

print_success() {
    print_color "$GREEN" "[SUCCESS] $1"
}

print_warning() {
    print_color "$YELLOW" "[WARNING] $1"
}

print_error() {
    print_color "$RED" "[ERROR] $1"
}

print_debug() {
    print_color "$BLUE" "[DEBUG] $1"
}

# Show banner
show_banner() {
    echo ""
    print_color "$MAGENTA" "  ╔═══════════════════════════════════════════════════════════════╗"
    print_color "$MAGENTA" "  ║         Claude Code Auto-Resume Plugin v${VERSION}              ║"
    print_color "$MAGENTA" "  ║     Automatically resume when rate limits reset               ║"
    print_color "$MAGENTA" "  ╚═══════════════════════════════════════════════════════════════╝"
    echo ""
}

# Show help
show_help() {
    show_banner
    cat << EOF
USAGE:
    ./claude-auto-resume.sh [OPTIONS]

OPTIONS:
    -m, --monitor       Run in clipboard monitor mode
    -i, --interactive   Run in interactive mode (paste message)
    -t, --test <secs>   Test mode with simulated wait time
    -p, --prompt <text> Custom prompt to send (default: "continue")
    -w, --window <text> Window title to send keystrokes to
    -h, --help          Show this help message
    -v, --version       Show version information

EXAMPLES:
    # Interactive mode - paste rate limit message
    ./claude-auto-resume.sh -i

    # With custom prompt
    ./claude-auto-resume.sh -i -p "please continue with the task"

    # Test mode with 30 second wait
    ./claude-auto-resume.sh -t 30

    # Monitor clipboard
    ./claude-auto-resume.sh -m

HOW IT WORKS:
    1. You paste the rate limit message
    2. Script parses the reset time from messages like:
       "You've hit your limit · resets 8pm (Asia/Dhaka)"
    3. Calculates wait time until reset
    4. Automatically sends "continue" when limit resets

RATE LIMIT PATTERN:
    The script detects: "You've hit your limit · resets <time> (<timezone>)"

DEPENDENCIES:
    - Linux: xdotool (for sending keystrokes)
    - macOS: osascript (built-in)

INSTALLATION (Linux):
    sudo apt-get install xdotool    # Debian/Ubuntu
    sudo yum install xdotool        # RHEL/CentOS
    sudo pacman -S xdotool          # Arch Linux

EOF
}

# Show version
show_version() {
    echo "claude-auto-resume v${VERSION}"
    echo "Platform: $(uname -s)"
}

# Get timezone offset in hours
get_timezone_offset() {
    local tz_name=$1

    # Common timezone mappings
    case "$tz_name" in
        # Asia
        "Asia/Dhaka") echo 6 ;;
        "Asia/Kolkata") echo 5.5 ;;
        "Asia/Tokyo") echo 9 ;;
        "Asia/Shanghai") echo 8 ;;
        "Asia/Singapore") echo 8 ;;
        "Asia/Seoul") echo 9 ;;
        "Asia/Dubai") echo 4 ;;
        "Asia/Jakarta") echo 7 ;;
        "Asia/Manila") echo 8 ;;
        "Asia/Bangkok") echo 7 ;;
        "Asia/Hong_Kong") echo 8 ;;
        # Americas
        "America/New_York") echo -5 ;;
        "America/Los_Angeles") echo -8 ;;
        "America/Chicago") echo -6 ;;
        "America/Denver") echo -7 ;;
        "America/Toronto") echo -5 ;;
        "America/Vancouver") echo -8 ;;
        "America/Sao_Paulo") echo -3 ;;
        # Europe
        "Europe/London") echo 0 ;;
        "Europe/Paris") echo 1 ;;
        "Europe/Berlin") echo 1 ;;
        "Europe/Moscow") echo 3 ;;
        "Europe/Amsterdam") echo 1 ;;
        # Australia
        "Australia/Sydney") echo 11 ;;
        "Australia/Melbourne") echo 11 ;;
        "Australia/Perth") echo 8 ;;
        # Pacific
        "Pacific/Auckland") echo 13 ;;
        "Pacific/Honolulu") echo -10 ;;
        # Default
        "UTC"|"GMT") echo 0 ;;
        *)
            # Try to get from system
            if command -v date &> /dev/null; then
                local offset
                offset=$(TZ="$tz_name" date +%z 2>/dev/null | sed 's/\([+-]\)\([0-9][0-9]\)\([0-9][0-9]\)/\1\2/')
                if [ -n "$offset" ]; then
                    echo "$offset"
                else
                    # Use local timezone
                    date +%z | sed 's/\([+-]\)\([0-9][0-9]\)\([0-9][0-9]\)/\1\2/'
                fi
            else
                echo 0
            fi
            ;;
    esac
}

# Parse reset time from message
parse_reset_time() {
    local message="$1"

    # Pattern: resets Xam/pm (Timezone) or resets X:XXam/pm (Timezone)
    local time_match
    time_match=$(echo "$message" | grep -oE "resets [0-9]{1,2}(:[0-9]{2})?\s*(am|pm)\s*\([^)]+\)" | head -1)

    if [ -z "$time_match" ]; then
        return 1
    fi

    # Extract components
    local hour minute period timezone

    # Try pattern with minutes first
    if echo "$time_match" | grep -qE "resets [0-9]{1,2}:[0-9]{2}"; then
        hour=$(echo "$time_match" | sed -E 's/resets ([0-9]{1,2}):.*/\1/')
        minute=$(echo "$time_match" | sed -E 's/resets [0-9]{1,2}:([0-9]{2}).*/\1/')
    else
        hour=$(echo "$time_match" | sed -E 's/resets ([0-9]{1,2})\s*(am|pm).*/\1/')
        minute=0
    fi

    period=$(echo "$time_match" | grep -oE "(am|pm)")
    timezone=$(echo "$time_match" | sed -E 's/.*\(([^)]+)\).*/\1/')

    print_debug "Parsed: Hour=$hour, Minute=$minute, Period=$period, Timezone=$timezone"

    # Convert to 24-hour format
    if [ "$period" = "am" ]; then
        if [ "$hour" = "12" ]; then
            hour=0
        fi
    else
        if [ "$hour" != "12" ]; then
            hour=$((hour + 12))
        fi
    fi

    # Get timezone offsets
    local tz_offset local_offset offset_diff
    tz_offset=$(get_timezone_offset "$timezone")

    # Get local timezone offset
    if date --version >/dev/null 2>&1; then
        # GNU date (Linux)
        local_offset=$(date +%z | sed 's/\([+-]\)\([0-9][0-9]\)\([0-9][0-9]\)/\1\2/')
    else
        # BSD date (macOS)
        local_offset=$(date +%z | sed 's/\([+-]\)\([0-9][0-9]\)\([0-9][0-9]\)/\1\2/')
    fi

    # Calculate offset difference
    offset_diff=$(echo "$local_offset - $tz_offset" | bc 2>/dev/null || echo "0")

    # Calculate reset timestamp
    local now_timestamp reset_timestamp
    now_timestamp=$(date +%s)

    # Build reset time for today
    local today_date reset_time_str
    if date --version >/dev/null 2>&1; then
        # GNU date (Linux)
        today_date=$(date +%Y-%m-%d)
        reset_time_str="${today_date} ${hour}:${minute}:00"
        reset_timestamp=$(date -d "$reset_time_str" +%s 2>/dev/null)

        # Adjust for timezone difference
        if [ -n "$offset_diff" ] && [ "$offset_diff" != "0" ]; then
            offset_seconds=$(echo "$offset_diff * 3600" | bc 2>/dev/null || echo "0")
            reset_timestamp=$((reset_timestamp + offset_seconds))
        fi

        # If reset time has passed, add a day
        if [ "$reset_timestamp" -lt "$now_timestamp" ]; then
            reset_timestamp=$((reset_timestamp + 86400))
        fi
    else
        # BSD date (macOS)
        today_date=$(date +%Y-%m-%d)
        reset_timestamp=$(date -j -f "%Y-%m-%d %H:%M:%S" "${today_date} ${hour}:${minute}:00" +%s 2>/dev/null)

        # Adjust for timezone difference
        if [ -n "$offset_diff" ] && [ "$offset_diff" != "0" ]; then
            offset_seconds=$(echo "$offset_diff * 3600" | bc 2>/dev/null || echo "0")
            reset_timestamp=$((reset_timestamp + offset_seconds))
        fi

        # If reset time has passed, add a day
        if [ "$reset_timestamp" -lt "$now_timestamp" ]; then
            reset_timestamp=$((reset_timestamp + 86400))
        fi
    fi

    echo "$reset_timestamp"
}

# Format seconds to HH:MM:SS
format_time() {
    local seconds=$1
    if [ "$seconds" -lt 0 ]; then
        echo "00:00:00"
        return
    fi
    printf "%02d:%02d:%02d" $((seconds/3600)) $(((seconds%3600)/60)) $((seconds%60))
}

# Send keystrokes to terminal
send_keystrokes() {
    local text="$1"
    local window_title="$2"

    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS - use osascript
        if [ -n "$window_title" ]; then
            osascript -e "
                tell application \"System Events\"
                    set frontApp to first process whose frontmost is true
                    keystroke \"$text\"
                    keystroke return
                end tell
            "
        else
            osascript -e "
                tell application \"System Events\"
                    keystroke \"$text\"
                    keystroke return
                end tell
            "
        fi
    else
        # Linux - use xdotool
        if ! command -v xdotool &> /dev/null; then
            print_error "xdotool not found. Please install it:"
            print_info "  Ubuntu/Debian: sudo apt-get install xdotool"
            print_info "  RHEL/CentOS: sudo yum install xdotool"
            print_info "  Arch: sudo pacman -S xdotool"
            return 1
        fi

        if [ -n "$window_title" ]; then
            # Find window and send keystrokes
            local window_id
            window_id=$(xdotool search --name "$window_title" | head -1)
            if [ -n "$window_id" ]; then
                xdotool windowactivate "$window_id"
                sleep 0.5
            else
                print_warning "Could not find window: $window_title"
            fi
        fi

        xdotool type "$text"
        xdotool key Return
    fi

    print_success "Sent: '$text' + Enter"
}

# Wait for reset time with countdown
wait_for_reset() {
    local reset_timestamp=$1
    local prompt=$2
    local window_title=$3

    print_warning ""
    print_warning "Rate limit detected!"

    # Format reset time
    local reset_time_fmt
    if date --version >/dev/null 2>&1; then
        reset_time_fmt=$(date -d "@$reset_timestamp" "+%Y-%m-%d %H:%M:%S")
    else
        reset_time_fmt=$(date -r "$reset_timestamp" "+%Y-%m-%d %H:%M:%S")
    fi

    print_info "Reset time: $reset_time_fmt"

    local now_timestamp wait_seconds
    now_timestamp=$(date +%s)
    wait_seconds=$((reset_timestamp - now_timestamp))

    # Countdown loop
    while [ "$wait_seconds" -gt 0 ]; do
        local formatted
        formatted=$(format_time "$wait_seconds")
        printf "\r${YELLOW}[WAITING] Resuming in %s... ${NC}" "$formatted"
        sleep 1
        now_timestamp=$(date +%s)
        wait_seconds=$((reset_timestamp - now_timestamp))
    done

    printf "\r${GREEN}[READY] Reset time reached!                    ${NC}\n"
    echo ""

    # Add buffer
    sleep 5

    # Send continue prompt
    print_info "Sending resume prompt..."
    send_keystrokes "$prompt" "$window_title"

    print_success "Auto-resume completed!"
}

# Interactive mode
run_interactive() {
    print_info "Interactive mode started"
    print_info "Paste the rate limit message below (or type 'exit' to quit):"
    echo ""

    while true; do
        printf "${MAGENTA}Enter message: ${NC}"
        read -r input

        if [ "$input" = "exit" ] || [ "$input" = "quit" ]; then
            print_info "Exiting..."
            break
        fi

        local reset_timestamp
        reset_timestamp=$(parse_reset_time "$input")

        if [ -n "$reset_timestamp" ] && [ "$reset_timestamp" -gt 0 ]; then
            wait_for_reset "$reset_timestamp" "$PROMPT" "$WINDOW_TITLE"
            print_info ""
            print_info "Ready for next rate limit message (or 'exit' to quit)"
            echo ""
        else
            print_warning "Could not parse rate limit message. Expected format:"
            print_info "         'You've hit your limit · resets 8pm (Asia/Dhaka)'"
        fi
    done
}

# Clipboard monitor mode (Linux/macOS)
run_monitor() {
    print_info "Starting clipboard monitor..."
    print_info "Copy the rate limit message to clipboard to trigger auto-resume"
    print_info "Press Ctrl+C to stop monitoring"
    echo ""

    local last_clipboard=""
    local get_clipboard_cmd

    if [[ "$OSTYPE" == "darwin"* ]]; then
        get_clipboard_cmd="pbpaste"
    else
        if command -v xclip &> /dev/null; then
            get_clipboard_cmd="xclip -selection clipboard -o"
        elif command -v xsel &> /dev/null; then
            get_clipboard_cmd="xsel --clipboard --output"
        else
            print_error "No clipboard tool found. Please install xclip or xsel:"
            print_info "  Ubuntu/Debian: sudo apt-get install xclip"
            print_info "  RHEL/CentOS: sudo yum install xclip"
            return 1
        fi
    fi

    while true; do
        local current_clipboard
        current_clipboard=$(eval "$get_clipboard_cmd" 2>/dev/null || echo "")

        if [ -n "$current_clipboard" ] && [ "$current_clipboard" != "$last_clipboard" ]; then
            last_clipboard="$current_clipboard"

            local reset_timestamp
            reset_timestamp=$(parse_reset_time "$current_clipboard")

            if [ -n "$reset_timestamp" ] && [ "$reset_timestamp" -gt 0 ]; then
                wait_for_reset "$reset_timestamp" "$PROMPT" "$WINDOW_TITLE"
                print_info ""
                print_info "Continuing to monitor..."
            fi
        fi

        sleep 0.5
    done
}

# Test mode
run_test() {
    local wait_seconds=$1
    print_warning "[TEST MODE] Simulating rate limit with $wait_seconds seconds wait"

    local reset_timestamp
    reset_timestamp=$(($(date +%s) + wait_seconds))

    wait_for_reset "$reset_timestamp" "$PROMPT" "$WINDOW_TITLE"
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -m|--monitor)
            MONITOR_MODE=true
            shift
            ;;
        -i|--interactive)
            INTERACTIVE_MODE=true
            shift
            ;;
        -t|--test)
            TEST_MODE="$2"
            shift 2
            ;;
        -p|--prompt)
            PROMPT="$2"
            shift 2
            ;;
        -w|--window)
            WINDOW_TITLE="$2"
            shift 2
            ;;
        -h|--help)
            show_help
            exit 0
            ;;
        -v|--version)
            show_version
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            show_help
            exit 1
            ;;
    esac
done

# Main execution
main() {
    show_banner

    # Test mode
    if [ "$TEST_MODE" -gt 0 ]; then
        run_test "$TEST_MODE"
        exit 0
    fi

    # Monitor mode
    if [ "$MONITOR_MODE" = true ]; then
        run_monitor
        exit 0
    fi

    # Interactive mode
    if [ "$INTERACTIVE_MODE" = true ]; then
        run_interactive
        exit 0
    fi

    # Default: show menu
    print_color "$MAGENTA" "Select operation mode:"
    print_info "  1. Interactive Mode (paste message directly)"
    print_info "  2. Clipboard Monitor (copy rate limit message to trigger)"
    print_info "  3. Test Mode (simulate with 30 second wait)"
    echo ""
    printf "${MAGENTA}Enter choice (1-3): ${NC}"
    read -r choice

    case "$choice" in
        1)
            run_interactive
            ;;
        2)
            run_monitor
            ;;
        3)
            run_test 30
            ;;
        *)
            print_info "Defaulting to Interactive mode"
            run_interactive
            ;;
    esac
}

main
