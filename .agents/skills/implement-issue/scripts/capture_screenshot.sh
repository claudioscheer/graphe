#!/usr/bin/env bash
# capture_screenshot.sh
# Capture window screenshot for Graphe Bible study desktop app.
# Supports Linux (X11 / Wayland) and Git Bash on Windows.

set -euo pipefail

OUTPUT_PATH=""
PROCESS_NAME="graphe"
WINDOW_TITLE="Graphe"
WAIT_MS=1500

usage() {
    local code="${1:-1}"
    echo "Usage: $0 -o <output_path> [-p <process_name>] [-t <window_title>] [-w <wait_ms>]"
    echo "  -o, --output   Destination PNG file path (required)"
    echo "  -p, --process  Process binary name (default: graphe)"
    echo "  -t, --title    Window title (default: Graphe)"
    echo "  -w, --wait     Wait time in milliseconds before capture (default: 1500)"
    exit "$code"
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        -o|--output)
            OUTPUT_PATH="$2"
            shift 2
            ;;
        -p|--process)
            PROCESS_NAME="$2"
            shift 2
            ;;
        -t|--title)
            WINDOW_TITLE="$2"
            shift 2
            ;;
        -w|--wait)
            WAIT_MS="$2"
            shift 2
            ;;
        -h|--help)
            usage 0
            ;;
        *)
            echo "Unknown option: $1" >&2
            usage
            ;;
    esac
done

if [[ -z "$OUTPUT_PATH" ]]; then
    echo "Error: Output path is required." >&2
    usage
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mkdir -p "$(dirname "$OUTPUT_PATH")"

# Wait specified milliseconds
sleep "$(awk "BEGIN {print $WAIT_MS / 1000}")"

OS_TYPE="$(uname -s)"
case "$OS_TYPE" in
    CYGWIN*|MINGW*|MSYS*)
        # Running under Git Bash on Windows: delegate to PowerShell script
        PS_SCRIPT="$SCRIPT_DIR/capture_screenshot.ps1"
        if command -v cygpath >/dev/null 2>&1; then
            WIN_OUT="$(cygpath -w "$OUTPUT_PATH")"
            WIN_SCRIPT="$(cygpath -w "$PS_SCRIPT")"
        else
            WIN_OUT="$OUTPUT_PATH"
            WIN_SCRIPT="$PS_SCRIPT"
        fi
        powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$WIN_SCRIPT" -OutputPath "$WIN_OUT" -ProcessName "$PROCESS_NAME" -WaitMs 400
        exit 0
        ;;
    Linux*)
        # Linux desktop capture: Wayland or X11
        if [[ -n "${WAYLAND_DISPLAY:-}" ]]; then
            # Wayland capture
            if command -v grim >/dev/null 2>&1; then
                if command -v slurp >/dev/null 2>&1; then
                    # Slurp selection or active window
                    grim "$OUTPUT_PATH"
                else
                    grim "$OUTPUT_PATH"
                fi
                echo "Screenshot saved to $OUTPUT_PATH via grim"
                exit 0
            elif command -v gnome-screenshot >/dev/null 2>&1; then
                gnome-screenshot -w -f "$OUTPUT_PATH"
                echo "Screenshot saved to $OUTPUT_PATH via gnome-screenshot"
                exit 0
            fi
        fi

        # X11 capture
        WINDOW_ID=""
        if command -v xdotool >/dev/null 2>&1; then
            WINDOW_ID="$(xdotool search --onlyvisible --class "$PROCESS_NAME" 2>/dev/null | tail -n 1 || true)"
            if [[ -z "$WINDOW_ID" ]]; then
                WINDOW_ID="$(xdotool search --onlyvisible --name "$WINDOW_TITLE" 2>/dev/null | tail -n 1 || true)"
            fi
            if [[ -n "$WINDOW_ID" ]]; then
                xdotool windowactivate --sync "$WINDOW_ID" 2>/dev/null || true
                sleep 0.3
            fi
        fi

        if [[ -z "$WINDOW_ID" ]] && command -v wmctrl >/dev/null 2>&1; then
            WINDOW_ID="$(wmctrl -l | grep -i "$WINDOW_TITLE" | awk '{print $1}' | tail -n 1 || true)"
            if [[ -n "$WINDOW_ID" ]]; then
                wmctrl -i -a "$WINDOW_ID" 2>/dev/null || true
                sleep 0.3
            fi
        fi

        # Capture using available tool
        if command -v maim >/dev/null 2>&1; then
            if [[ -n "$WINDOW_ID" ]]; then
                maim -i "$WINDOW_ID" "$OUTPUT_PATH"
            else
                maim "$OUTPUT_PATH"
            fi
            echo "Screenshot saved to $OUTPUT_PATH via maim"
            exit 0
        elif command -v import >/dev/null 2>&1; then
            if [[ -n "$WINDOW_ID" ]]; then
                import -window "$WINDOW_ID" "$OUTPUT_PATH"
            else
                import -window root "$OUTPUT_PATH"
            fi
            echo "Screenshot saved to $OUTPUT_PATH via ImageMagick import"
            exit 0
        elif command -v scrot >/dev/null 2>&1; then
            if [[ -n "$WINDOW_ID" ]]; then
                scrot -u "$OUTPUT_PATH"
            else
                scrot "$OUTPUT_PATH"
            fi
            echo "Screenshot saved to $OUTPUT_PATH via scrot"
            exit 0
        else
            echo "Error: No suitable capture tool found. Install maim, imagemagick (import), or scrot." >&2
            exit 1
        fi
        ;;
    Darwin*)
        # macOS capture
        screencapture -l"$(osascript -e "tell app \"$PROCESS_NAME\" to id of window 1" 2>/dev/null || echo "")" "$OUTPUT_PATH" 2>/dev/null || screencapture -w "$OUTPUT_PATH"
        echo "Screenshot saved to $OUTPUT_PATH via screencapture"
        exit 0
        ;;
    *)
        echo "Unsupported OS: $OS_TYPE" >&2
        exit 1
        ;;
esac
