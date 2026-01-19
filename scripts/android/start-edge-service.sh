#!/data/data/com.termux/files/usr/bin/bash

# POP2TIC Android Edge Node Startup Script
# This script starts the edge node as a background service on Android

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Configuration
POP2TIC_DIR="${HOME}/POP2TIC"
LOG_FILE="${POP2TIC_DIR}/logs/edge.log"
PID_FILE="${POP2TIC_DIR}/edge.pid"
SERVICE_NAME="pop2tic-edge"

# Default values (can be overridden by environment)
NODE_TYPE="${NODE_TYPE:-edge}"
SERVICE_ID="${SERVICE_ID:-android-edge-1}"
PORT="${PORT:-4000}"
FOG_NODE_URL="${FOG_NODE_URL:-http://192.168.1.100:5000}"
CACHE_MAX_SIZE="${CACHE_MAX_SIZE:-3000}"
NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=512}"

echo -e "${GREEN}=== POP2TIC Android Edge Node ===${NC}\n"

# Check if POP2TIC directory exists
if [ ! -d "$POP2TIC_DIR" ]; then
    echo -e "${RED}Error: POP2TIC directory not found at $POP2TIC_DIR${NC}"
    echo "Please clone the repository first:"
    echo "  git clone https://github.com/your-org/POP2TIC.git ~/POP2TIC"
    exit 1
fi

# Check if built application exists
if [ ! -f "$POP2TIC_DIR/dist/edge-server.js" ]; then
    echo -e "${YELLOW}Warning: edge-server.js not found${NC}"
    echo "Building application..."
    cd "$POP2TIC_DIR"
    npm run build
fi

# Check if already running
if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE" 2>/dev/null || echo "")
    if [ -n "$PID" ] && ps -p "$PID" > /dev/null 2>&1; then
        echo -e "${YELLOW}Edge node already running (PID: $PID)${NC}"
        echo "To stop it, run: ./scripts/android/stop-edge-service.sh"
        exit 0
    else
        echo -e "${YELLOW}Stale PID file found, cleaning up...${NC}"
        rm -f "$PID_FILE"
    fi
fi

# Create logs directory
mkdir -p "$POP2TIC_DIR/logs"

# Acquire locks (if termux-api is installed)
echo "Acquiring system locks..."

if command -v termux-wake-lock &> /dev/null; then
    termux-wake-lock
    echo -e "${GREEN}✓ Wake lock acquired${NC}"
else
    echo -e "${YELLOW}⚠ termux-api not found, wake lock not acquired${NC}"
    echo "  Install with: pkg install termux-api"
fi

if command -v termux-wifi-lock &> /dev/null; then
    termux-wifi-lock enable
    echo -e "${GREEN}✓ WiFi lock acquired${NC}"
fi

# Display configuration
echo ""
echo "Configuration:"
echo "  Service ID: $SERVICE_ID"
echo "  Port: $PORT"
echo "  Fog Node: $FOG_NODE_URL"
echo "  Cache Size: $CACHE_MAX_SIZE"
echo "  Node Options: $NODE_OPTIONS"
echo ""

# Get device IP
DEVICE_IP=$(ip addr show wlan0 2>/dev/null | grep 'inet ' | awk '{print $2}' | cut -d/ -f1)
if [ -z "$DEVICE_IP" ]; then
    DEVICE_IP=$(termux-ifconfig 2>/dev/null | grep 'inet ' | awk '{print $2}' | cut -d: -f2 | head -1)
fi

if [ -n "$DEVICE_IP" ]; then
    echo "  Device IP: $DEVICE_IP"
    echo "  Health: http://$DEVICE_IP:$PORT/health"
fi

echo ""
echo "Starting edge node..."

# Export environment variables
export NODE_ENV=production
export NODE_TYPE
export SERVICE_ID
export PORT
export FOG_NODE_URL
export CACHE_MAX_SIZE
export NODE_OPTIONS

# Start edge node in background
cd "$POP2TIC_DIR"
nohup node dist/edge-server.js >> "$LOG_FILE" 2>&1 &
PID=$!

# Save PID
echo $PID > "$PID_FILE"

# Wait a moment and check if process started
sleep 2

if ps -p "$PID" > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Edge node started successfully${NC}"
    echo ""
    echo "Service Information:"
    echo "  PID: $PID"
    echo "  Log file: $LOG_FILE"
    echo "  PID file: $PID_FILE"
    echo ""

    # Show recent logs
    echo "Recent logs:"
    tail -n 5 "$LOG_FILE" 2>/dev/null || echo "  (No logs yet)"
    echo ""

    echo "Useful Commands:"
    echo "  View logs: tail -f $LOG_FILE"
    echo "  Check health: curl http://localhost:$PORT/health"
    echo "  View cache: curl http://localhost:$PORT/edge/cache/stats"
    echo "  Stop service: ./scripts/android/stop-edge-service.sh"
else
    echo -e "${RED}✗ Failed to start edge node${NC}"
    rm -f "$PID_FILE"
    echo "Check logs at: $LOG_FILE"
    exit 1
fi
