#!/bin/bash

# SGX Privacy Evaluation Build Script
# Builds both the SGX enclave and the Node.js native addon

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== SGX Privacy Evaluation Build Script ===${NC}"

# Check if SGX SDK is installed
if [ ! -d "/opt/intel/sgxsdk" ]; then
    echo -e "${RED}Error: Intel SGX SDK not found at /opt/intel/sgxsdk${NC}"
    echo "Please install the Intel SGX SDK first."
    exit 1
fi

# Source SGX SDK environment
echo "Setting up SGX SDK environment..."
source /opt/intel/sgxsdk/environment

# Set paths
SGX_SDK=/opt/intel/sgxsdk
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="$SCRIPT_DIR/build"
ENCLAVE_DIR="$SCRIPT_DIR/enclave"
APP_DIR="$SCRIPT_DIR/app"
EDL_DIR="$ENCLAVE_DIR/Edl"

# Create build directory
mkdir -p "$BUILD_DIR"

# ============================================================================
# Step 1: Generate EDL files using edger8r
# ============================================================================
echo -e "${YELLOW}Step 1: Generating EDL interface files...${NC}"

cd "$EDL_DIR"
$SGX_SDK/bin/x64/sgx_edger8r --trusted ../PrivacyEvaluation.edl --trusted-dir "$ENCLAVE_DIR"
$SGX_SDK/bin/x64/sgx_edger8r --untrusted ../PrivacyEvaluation.edl --untrusted-dir "$APP_DIR"

if [ $? -ne 0 ]; then
    echo -e "${RED}Error: edger8r failed${NC}"
    exit 1
fi

echo -e "${GREEN}EDL files generated successfully${NC}"

# ============================================================================
# Step 2: Build the Enclave (Trusted)
# ============================================================================
echo -e "${YELLOW}Step 2: Building SGX Enclave...${NC}"

cd "$BUILD_DIR"

# Compile enclave
g++ -g -O2 -fPIC -std=c++17 \
    -I"$SGX_SDK/include" \
    -I"$ENCLAVE_DIR" \
    -I"$EDL_DIR" \
    -DENCLAVE_CODE \
    "$ENCLAVE_DIR/Enclave.cpp" \
    "$ENCLAVE_DIR/PrivacyEvaluation_t.c" \
    -o "$BUILD_DIR/enclave.o" \
    -c

if [ $? -ne 0 ]; then
    echo -e "${RED}Error: Enclave compilation failed${NC}"
    exit 1
fi

# Link enclave
g++ -g -O2 \
    "$BUILD_DIR/enclave.o" \
    -o "$BUILD_DIR/enclave.so" \
    -Wl,--no-undefined \
    -Wl,-z,noexecstack \
    -Wl,-z,relro,-z,now \
    -L"$SGX_SDK/lib64" \
    -lsgx_tstdc \
    -lsgx_tcxx \
    -lsgx_tservice \
    -lsgx_trts \
    -Wl,--version-script="$ENCLAVE_DIR/Enclave.lds"

# Generate Enclave.lds if it doesn't exist
if [ ! -f "$ENCLAVE_DIR/Enclave.lds" ]; then
    echo "Generating Enclave.lds..."
    cat > "$ENCLAVE_DIR/Enclave.lds" << 'EOF'
{
    global:
        g_global_data_sim;
        g_global_data;
        enclave_entry;
    local:
        *;
};
EOF
fi

# Sign the enclave
$SGX_SDK/bin/x64/sgx_sign sign \
    -key "$ENCLAVE_DIR/enclave_private.pem" \
    -enclave "$BUILD_DIR/enclave.so" \
    -out "$BUILD_DIR/enclave.signed.so" \
    -config "$ENCLAVE_DIR/Enclave.config.xml"

if [ $? -ne 0 ]; then
    echo -e "${YELLOW}Warning: Enclave signing with existing key failed, generating new key...${NC}"
    openssl genrsa -out "$ENCLAVE_DIR/enclave_private.pem" -3 3072
    $SGX_SDK/bin/x64/sgx_sign sign \
        -key "$ENCLAVE_DIR/enclave_private.pem" \
        -enclave "$BUILD_DIR/enclave.so" \
        -out "$BUILD_DIR/enclave.signed.so" \
        -config "$ENCLAVE_DIR/Enclave.config.xml"
fi

echo -e "${GREEN}Enclave built and signed successfully${NC}"

# ============================================================================
# Step 3: Build the Node.js Native Addon
# ============================================================================
echo -e "${YELLOW}Step 3: Building Node.js native addon...${NC}"

cd "$SCRIPT_DIR"

# Copy signed enclave to app directory (for runtime loading)
cp "$BUILD_DIR/enclave.signed.so" "$APP_DIR/enclave.signed.so"

# Build with node-gyp
npm run build-addon || node-gyp rebuild

if [ $? -ne 0 ]; then
    echo -e "${RED}Error: node-gyp build failed${NC}"
    exit 1
fi

echo -e "${GREEN}Node.js native addon built successfully${NC}"

# ============================================================================
# Done
# ============================================================================
echo -e "${GREEN}=== Build Complete ===${NC}"
echo ""
echo "Built files:"
echo "  - $BUILD_DIR/enclave.signed.so (SGX enclave)"
echo "  - build/Release/sgx-addon.node (Node.js addon)"
echo ""
echo "To use in Node.js:"
echo "  const sgx = require('./build/Release/sgx-addon.node');"
echo "  sgx.initializeEnclave();"
echo "  const result = sgx.evaluatePrivacy(appJson, userJson, policyJson);"
