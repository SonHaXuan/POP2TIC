#!/data/data/com.termux/files/usr/bin/bash

# POP2TIC Android Edge Node Status Check Script

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
POP2TIC_DIR="${HOME}/POP2TIC"
PID_FILE="${POP2TIC_DIR}/edge.pid"
PORT="${PORT:-4000}"

echo -e "${BLUE}=== POP2TIC Edge Node Status ===${NC}\n"

# Check if PID file exists
if [ ! -f "$PID_FILE" ]; then
    echo -e "${RED}Status: Not running${NC}"
    echo "No PID file found"
    echo ""
    echo "Start with: ./scripts/android/start-edge-service.sh"
    exit 0
fi

# Read PID
PID=$(cat "$PID_FILE" 2>/dev/null || echo "")

if [ -z "$PID" ]; then
    echo -e "${RED}Status: Error${NC}"
    echo "Could not read PID from file"
    exit 1
fi

# Check if process is running
if ps -p "$PID" > /dev/null 2>&1; then
    echo -e "${GREEN}Status: Running${NC}"
    echo "PID: $PID"

    # Get process info
    echo ""
    echo "Process Information:"
    ps -p "$PID" -o pid,ppid,%cpu,%mem,etime,cmd

    # Get memory info
    if [ -f "/proc/$PID/status" ]; then
        echo ""
        echo "Memory Usage:"
        grep -E "VmSize|VmRSS|VmPeak|Threads" "/proc/$PID/status" | \
            sed 's/^[[:space:]]*/  /'
    fi

    # Get device IP
    echo ""
    echo "Network:"
    DEVICE_IP=$(ip addr show wlan0 2>/dev/null | grep 'inet ' | awk '{print $2}' | cut -d/ -f1)
    if [ -z "$DEVICE_IP" ]; then
        DEVICE_IP=$(termux-ifconfig 2>/dev/null | grep 'inet ' | awk '{print $2}' | cut -d: -f2 | head -1)
    fi

    if [ -n "$DEVICE_IP" ]; then
        echo "  IP: $DEVICE_IP"
        echo "  Health: http://$DEVICE_IP:$PORT/health"
        echo "  Cache: http://$DEVICE_IP:$PORT/edge/cache/stats"
    fi

    # Check health endpoint
    echo ""
    echo "Health Check:"
    if command -v curl &> /dev/null; then
        HEALTH=$(curl -s "http://localhost:$PORT/health" 2>/dev/null || echo "")
        if [ -n "$HEALTH" ]; then
            STATUS=$(echo "$HEALTH" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
            if [ "$STATUS" = "healthy" ]; then
                echo -e "  ${GREEN}✓ Service is healthy${NC}"
            else
                echo -e "  ${YELLOW}⚠ Service status: $STATUS${NC}"
            fi
        else
            echo -e "  ${RED}✗ Health check failed${NC}"
        fi
    else
        echo "  (curl not available)"
    fi

    # Show recent logs
    if [ -f "$POP2TIC_DIR/logs/edge.log" ]; then
        echo ""
        echo "Recent Logs:"
        tail -n 5 "$POP2TIC_DIR/logs/edge.log" | sed 's/^/  /'
    fi

else
    echo -e "${RED}Status: Not running${NC}"
    echo "Stale PID file found (PID: $PID)"
    echo ""
    echo "Cleaning up PID file..."
    rm -f "$PID_FILE"
    echo ""
    echo "Start with: ./scripts/android/start-edge-service.sh"
fi

echo ""
