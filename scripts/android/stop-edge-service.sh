#!/data/data/com.termux/files/usr/bin/bash

# POP2TIC Android Edge Node Stop Script

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Configuration
POP2TIC_DIR="${HOME}/POP2TIC"
PID_FILE="${POP2TIC_DIR}/edge.pid"
LOG_FILE="${POP2TIC_DIR}/logs/edge.log"

echo -e "${YELLOW}=== Stopping POP2TIC Edge Node ===${NC}\n"

# Check if PID file exists
if [ ! -f "$PID_FILE" ]; then
    echo -e "${YELLOW}No PID file found at $PID_FILE${NC}"
    echo "Edge node may not be running"

    # Try to find process by name
    PIDS=$(pgrep -f "edge-server.js" || true)
    if [ -n "$PIDS" ]; then
        echo "Found edge-server.js processes: $PIDS"
        read -p "Kill them? (y/n) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            echo "$PIDS" | xargs kill
            echo -e "${GREEN}Processes killed${NC}"
        fi
    fi
    exit 0
fi

# Read PID
PID=$(cat "$PID_FILE" 2>/dev/null || echo "")

if [ -z "$PID" ]; then
    echo -e "${RED}Error: Could not read PID from file${NC}"
    rm -f "$PID_FILE"
    exit 1
fi

# Check if process is running
if ps -p "$PID" > /dev/null 2>&1; then
    echo "Stopping edge node (PID: $PID)..."

    # Try graceful shutdown first
    kill "$PID" 2>/dev/null || true

    # Wait up to 5 seconds
    for i in {1..10}; do
        if ! ps -p "$PID" > /dev/null 2>&1; then
            echo -e "${GREEN}✓ Edge node stopped gracefully${NC}"
            rm -f "$PID_FILE"
            break
        fi
        sleep 0.5
    done

    # Force kill if still running
    if ps -p "$PID" > /dev/null 2>&1; then
        echo "Process still running, forcing..."
        kill -9 "$PID" 2>/dev/null || true
        sleep 1
        if ! ps -p "$PID" > /dev/null 2>&1; then
            echo -e "${YELLOW}⚠ Edge node force killed${NC}"
            rm -f "$PID_FILE"
        else
            echo -e "${RED}✗ Failed to kill process${NC}"
            exit 1
        fi
    fi
else
    echo -e "${YELLOW}Process $PID not running (cleaning up PID file)${NC}"
    rm -f "$PID_FILE"
fi

# Release locks
echo ""
echo "Releasing system locks..."

if command -v termux-wake-unlock &> /dev/null; then
    termux-wake-unlock
    echo -e "${GREEN}✓ Wake lock released${NC}"
fi

if command -v termux-wifi-lock &> /dev/null; then
    termux-wifi-lock disable
    echo -e "${GREEN}✓ WiFi lock released${NC}"
fi

echo ""
echo -e "${GREEN}=== Edge Node Stopped ===${NC}"
