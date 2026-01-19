#!/bin/bash
# Fog Node Installation Script with SGX Support
# Run this script on a fresh Ubuntu/Debian system

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

INSTALL_DIR="/opt/pop2tic-fog"
SERVICE_USER="pop2tic"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

echo -e "${BLUE}=== POP2TIC Fog Node Installation ===${NC}\n"

# Check if running as root
if [ "$EUID" -eq 0 ]; then
    echo -e "${RED}✗ Please do not run this script as root${NC}"
    echo "  The script will use sudo when needed"
    exit 1
fi

# ============================================================================
# Step 1: Prerequisites
# ============================================================================
echo -e "${YELLOW}[Step 1/8] Checking prerequisites...${NC}"

if ! command -v curl &> /dev/null; then
    echo "Installing curl..."
    sudo apt-get update && sudo apt-get install -y curl
fi

echo -e "${GREEN}✓ Prerequisites check complete${NC}\n"

# ============================================================================
# Step 2: System Dependencies
# ============================================================================
echo -e "${YELLOW}[Step 2/8] Installing system dependencies...${NC}"

sudo apt-get update
sudo apt-get install -y \
    build-essential \
    cmake \
    g++ \
    git \
    libssl-dev \
    libcurl4-openssl-dev \
    pkg-config \
    python3 \
    python3-pip \
    autoconf \
    libtool \
    wget \
    software-properties-common \
    apt-transport-https

echo -e "${GREEN}✓ System dependencies installed${NC}\n"

# ============================================================================
# Step 3: Intel SGX Driver
# ============================================================================
echo -e "${YELLOW}[Step 3/8] Installing Intel SGX Driver...${NC}"

if [ ! -e /dev/sgx/enclave ] && [ ! -e /dev/sgx_enclave ]; then
    echo "Adding Intel SGX repository..."

    # Detect OS version
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        OS_VERSION="$VERSION_ID"
    fi

    # Add Intel repository (Ubuntu 22.04)
    if [[ "$ID" == "ubuntu" ]]; then
        wget -qO - https://download.01.org/intel-sgx/sgx_repo/ubuntu/intel-sgx.key | \
            sudo gpg --dearmor -o /usr/share/keyrings/intel-sgx-keyring.gpg

        echo "deb [arch=amd64 signed-by=/usr/share/keyrings/intel-sgx-keyring.gpg] \
              https://download.01.org/intel-sgx/sgx_repo/ubuntu $VERSION_ID main" | \
            sudo tee /etc/apt/sources.list.d/intel-sgx.list

        sudo apt-get update
        sudo apt-get install -y sgx-linux-dcap libsgx-enclave-common sgx-aesm-service

        # Load SGX driver
        sudo modprobe sgx 2>/dev/null || true

        echo -e "${GREEN}✓ SGX driver installed${NC}"
    else
        echo -e "${YELLOW}⚠ Not Ubuntu, please install SGX driver manually${NC}"
        echo "  See: https://github.com/intel/linux-sgx"
    fi
else
    echo -e "${GREEN}✓ SGX driver already installed${NC}"
fi

echo ""

# ============================================================================
# Step 4: Intel SGX SDK
# ============================================================================
echo -e "${YELLOW}[Step 4/8] Installing Intel SGX SDK...${NC}"

if [ ! -d /opt/intel/sgxsdk ]; then
    echo "Installing Intel SGX SDK..."

    sudo apt-get install -y sgx-sdk=2.24\*

    echo -e "${GREEN}✓ SGX SDK installed${NC}"
else
    echo -e "${GREEN}✓ SGX SDK already installed${NC}"
fi

# Source SDK environment
source /opt/intel/sgxsdk/environment 2>/dev/null || true

echo ""

# ============================================================================
# Step 5: Node.js
# ============================================================================
echo -e "${YELLOW}[Step 5/8] Installing Node.js...${NC}"

if ! command -v node &> /dev/null || [ "$(node -v | cut -d'v' -f2 | cut -d. -f1)" -lt 18 ]; then
    echo "Installing Node.js 20.x LTS..."

    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs

    echo -e "${GREEN}✓ Node.js $(node -v) installed${NC}"
else
    echo -e "${GREEN}✓ Node.js $(node -v) already installed${NC}"
fi

# ============================================================================
# Step 6: PM2 Process Manager
# ============================================================================
echo -e "${YELLOW}[Step 6/8] Installing PM2...${NC}"

if ! command -v pm2 &> /dev/null; then
    sudo npm install -g pm2
    echo -e "${GREEN}✓ PM2 installed${NC}"
else
    echo -e "${GREEN}✓ PM2 already installed${NC}"
fi

echo ""

# ============================================================================
# Step 7: Application Setup
# ============================================================================
echo -e "${YELLOW}[Step 7/8] Setting up application...${NC}"

# Create service user
if ! id "$SERVICE_USER" &>/dev/null; then
    sudo useradd -r -s /bin/false -d "$INSTALL_DIR" "$SERVICE_USER"
    echo -e "${GREEN}✓ Created service user: $SERVICE_USER${NC}"
fi

# Create installation directory
sudo mkdir -p "$INSTALL_DIR"
sudo mkdir -p "$INSTALL_DIR/logs"
sudo mkdir -p "$INSTALL_DIR/config"

# Copy application files
echo "Copying application files..."
sudo cp -r "$REPO_DIR/src" "$INSTALL_DIR/"
sudo cp "$REPO_DIR/package.json" "$INSTALL_DIR/"
sudo cp "$REPO_DIR/babel.config.json" "$INSTALL_DIR/"
sudo cp "$REPO_DIR/.eslintrc.js" "$INSTALL_DIR/" 2>/dev/null || true

# Create environment file
echo "Creating environment configuration..."
sudo tee "$INSTALL_DIR/.env" > /dev/null <<EOF
# Fog Node Configuration
NODE_TYPE=fog
SERVICE_ID=fog-node-1
PORT=5000

# Intel SGX Configuration
SGX_ENABLED=true
SGX_SDK_PATH=/opt/intel/sgxsdk

# Database Configuration
MONGODB_URL=mongodb://localhost:27017/privacy-policy
DB_POOL_SIZE=10
DB_TIMEOUT=5000

# Performance Settings
MAX_CONCURRENT_EVALUATIONS=10
EVALUATION_TIMEOUT=5000

# Cache Configuration
POLICY_CACHE_SIZE=100
USER_PREF_CACHE_SIZE=500
APP_CACHE_SIZE=200
CACHE_PRELOAD_ENABLED=true

# Monitoring
HEALTH_CHECK_INTERVAL=30000
METRICS_ENABLED=true
LOG_LEVEL=info
EOF

# Set ownership
sudo chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"

echo -e "${GREEN}✓ Application files copied${NC}"

# ============================================================================
# Step 8: Build and Start
# ============================================================================
echo -e "${YELLOW}[Step 8/8] Building application...${NC}"

cd "$INSTALL_DIR"

# Install dependencies
echo "Installing npm dependencies..."
sudo -u "$SERVICE_USER" npm install

# Build SGX enclave (if SGX is available)
if [ -d "$INSTALL_DIR/src/sgx" ] && [ -f "$INSTALL_DIR/src/sgx/build.sh" ]; then
    echo "Building SGX enclave..."
    cd "$INSTALL_DIR/src/sgx"
    chmod +x build.sh

    if sudo -u "$SERVICE_USER" ./build.sh 2>&1; then
        echo -e "${GREEN}✓ SGX enclave built successfully${NC}"
    else
        echo -e "${YELLOW}⚠ SGX enclave build failed, will use JavaScript fallback${NC}"
    fi
fi

# Build Node.js application
cd "$INSTALL_DIR"
echo "Building Node.js application..."
sudo -u "$SERVICE_USER" npm run build

# Create PM2 ecosystem file
sudo -u "$SERVICE_USER" tee "$INSTALL_DIR/ecosystem.config.js" > /dev/null <<'EOF'
module.exports = {
  apps: [
    {
      name: "pop2tic-fog",
      script: "./dist/api/server.js",
      cwd: "/opt/pop2tic-fog",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "2G",
      env: {
        NODE_ENV: "production",
        NODE_TYPE: "fog",
        PORT: 5000,
        SGX_ENABLED: "true",
      },
      error_file: "./logs/fog-error.log",
      out_file: "./logs/fog-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      merge_logs: true,
    },
  ],
};
EOF

echo -e "${GREEN}✓ Application built${NC}\n"

# ============================================================================
# Start Service
# ============================================================================
echo -e "${YELLOW}Starting Fog Node service...${NC}"

cd "$INSTALL_DIR"
sudo -u "$SERVICE_USER" pm2 start ecosystem.config.js
sudo -u "$SERVICE_USER" pm2 save

# Setup PM2 startup script
echo ""
echo -e "${YELLOW}To enable PM2 to start on boot, run:${NC}"
echo "  sudo env PATH=\$PATH:/usr/bin pm2 startup systemd -u $SERVICE_USER --hp /opt/pop2tic-fog"

echo ""
echo -e "${GREEN}=== Fog Node Installation Complete ===${NC}"
echo ""
echo "Service Status:"
sudo -u "$SERVICE_USER" pm2 status
echo ""
echo "Service URL: http://localhost:5000"
echo "Health Check: curl http://localhost:5000/health"
echo ""
echo "Useful Commands:"
echo "  View logs:    sudo -u $SERVICE_USER pm2 logs pop2tic-fog"
echo "  Restart:      sudo -u $SERVICE_USER pm2 restart pop2tic-fog"
echo "  Monitor:      sudo -u $SERVICE_USER pm2 monit"
echo "  SGX Status:   curl http://localhost:5000/fog/sgx/status"
echo ""
echo -e "${YELLOW}Next Steps:${NC}"
echo "1. Install and configure MongoDB:"
echo "   sudo apt-get install -y mongodb"
echo "   sudo systemctl start mongodb"
echo ""
echo "2. Initialize database with test data:"
echo "   cd $INSTALL_DIR && npx babel-watch src/generators/quick-test-data.js"
echo ""
echo "3. Verify SGX is working:"
echo "   curl http://localhost:5000/health | jq .sgx"
