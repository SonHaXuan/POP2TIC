#!/bin/bash
# SGX Hardware Verification Script
# Run this script before deployment to verify SGX support

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}=== Intel SGX Hardware Verification ===${NC}\n"

PASS=0
FAIL=0
WARN=0

# Function to check and print result
check() {
    local name="$1"
    local command="$2"
    local expected="$3"

    echo -n "Checking $name... "

    if eval "$command" > /dev/null 2>&1; then
        if [ -n "$expected" ]; then
            result=$(eval "$command" 2>/dev/null)
            if echo "$result" | grep -q "$expected"; then
                echo -e "${GREEN}✓ PASS${NC} ($result)"
                ((PASS++))
                return 0
            fi
        fi
        echo -e "${GREEN}✓ PASS${NC}"
        ((PASS++))
        return 0
    else
        echo -e "${RED}✗ FAIL${NC}"
        ((FAIL++))
        return 1
    fi
}

# Function for warning
warn() {
    local name="$1"
    local command="$2"
    local expected="$3"

    echo -n "Checking $name... "

    if eval "$command" > /dev/null 2>&1; then
        if [ -n "$expected" ]; then
            result=$(eval "$command" 2>/dev/null)
            if echo "$result" | grep -q "$expected"; then
                echo -e "${GREEN}✓ OK${NC} ($result)"
                ((PASS++))
                return 0
            fi
        fi
        echo -e "${GREEN}✓ OK${NC}"
        ((PASS++))
        return 0
    else
        echo -e "${YELLOW}⚠ WARNING${NC}"
        ((WARN++))
        return 0
    fi
}

echo -e "${BLUE}[1] CPU and Hardware Checks${NC}"
echo "-----------------------------------"

# Check CPU vendor
echo -n "CPU Vendor: "
if grep -q "GenuineIntel" /proc/cpuinfo; then
    echo -e "${GREEN}Intel${NC}"
    ((PASS++))
else
    echo -e "${RED}Not Intel (SGX requires Intel CPU)${NC}"
    ((FAIL++))
fi

# Check CPU model
echo -n "CPU Model: "
grep -m1 "model name" /proc/cpuinfo | cut -d: -f2 | xargs
echo ""

# Check SGX CPU support
if grep -q "sgx" /proc/cpuinfo; then
    echo -e "${GREEN}✓ CPU supports Intel SGX instructions${NC}"
    ((PASS++))
else
    echo -e "${RED}✗ CPU does NOT support Intel SGX${NC}"
    echo "  SGX requires Intel 6th Generation (Skylake) or newer CPU"
    ((FAIL++))
fi

# Check CPU flags
echo ""
echo -e "${BLUE}[2] SGX Device Checks${NC}"
echo "-----------------------------------"

# Check for SGX device (newer kernels)
if [ -e /dev/sgx/enclave ] || [ -e /dev/sgx_enclave ]; then
    echo -e "${GREEN}✓ SGX device found${NC}"
    ((PASS++))

    if [ -e /dev/sgx/enclave ]; then
        echo "  Device: /dev/sgx/enclave"
        ls -l /dev/sgx/
    elif [ -e /dev/sgx_enclave ]; then
        echo "  Device: /dev/sgx_enclave"
        ls -l /dev/sgx*
    fi
else
    echo -e "${YELLOW}⚠ SGX device not found${NC}"
    echo "  Install SGX driver: sudo apt install sgx-linux-dcap"
    echo "  Or: https://github.com/intel/linux-sgx"
    ((WARN++))
fi

# Check for SGX provision device
if [ -e /dev/sgx/provision ] || [ -e /dev/sgx_provision ]; then
    echo -e "${GREEN}✓ SGX provision device found${NC}"
    ((PASS++))
else
    echo -e "${YELLOW}⚠ SGX provision device not found (optional)${NC}"
    ((WARN++))
fi

echo ""
echo -e "${BLUE}[3] Operating System Checks${NC}"
echo "-----------------------------------"

# Check OS
echo -n "OS: "
if [ -f /etc/os-release ]; then
    . /etc/os-release
    echo "$PRETTY_NAME"

    if [[ "$ID" == "ubuntu" ]]; then
        echo -e "${GREEN}✓ Ubuntu is well-supported${NC}"
        ((PASS++))
    elif [[ "$ID" == "debian" ]]; then
        echo -e "${GREEN}✓ Debian is supported${NC}"
        ((PASS++))
    else
        echo -e "${YELLOW}⚠ May need additional configuration${NC}"
        ((WARN++))
    fi
else
    echo -e "${YELLOW}Unknown OS${NC}"
    ((WARN++))
fi

# Check kernel version
KERNEL_VERSION=$(uname -r | cut -d. -f1,2)
echo "Kernel: $(uname -r)"

if [ "$(printf '5.10\n%s' "$KERNEL_VERSION" | sort -V | head -n1)" = "5.10" ]; then
    echo -e "${GREEN}✓ Kernel 5.10+ (good SGX support)${NC}"
    ((PASS++))
else
    echo -e "${YELLOW}⚠ Kernel older than 5.10 (upgrade recommended)${NC}"
    ((WARN++))
fi

echo ""
echo -e "${BLUE}[4] Software Checks${NC}"
echo "-----------------------------------"

# Check Node.js
warn "Node.js" "command -v node"
if command -v node &> /dev/null; then
    NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d. -f1)
    echo "  Version: $(node -v)"
    if [ "$NODE_VERSION" -ge 18 ]; then
        echo -e "${GREEN}  ✓ Node.js 18+${NC}"
        ((PASS++))
    else
        echo -e "${YELLOW}  ⚠ Node.js 18+ recommended${NC}"
        ((WARN++))
    fi
fi

# Check npm
warn "npm" "command -v npm"
if command -v npm &> /dev/null; then
    echo "  Version: $(npm -v)"
fi

# Check GCC
warn "GCC/G++" "command -v g++"
if command -v g++ &> /dev/null; then
    echo "  Version: $(g++ --version | head -n1)"
fi

# Check Make
warn "Make" "command -v make"

echo ""
echo -e "${BLUE}[5] Intel SGX SDK Checks${NC}"
echo "-----------------------------------"

if [ -d /opt/intel/sgxsdk ]; then
    echo -e "${GREEN}✓ Intel SGX SDK installed${NC}"
    ((PASS++))

    # Source SDK and check version
    source /opt/intel/sgxsdk/environment 2>/dev/null || true

    if [ -n "$SGX_SDK" ]; then
        echo "  SDK Path: $SGX_SDK"

        if [ -f "$SGX_SDK/bin/x64/sgx_sign" ]; then
            SGX_VERSION=$($SGX_SDK/bin/x64/sgx_sign --version 2>/dev/null | head -n1 || echo "Unknown")
            echo "  Version: $SGX_VERSION"
        fi
    fi
else
    echo -e "${YELLOW}⚠ Intel SGX SDK not found${NC}"
    echo "  Install from: https://github.com/intel/linux-sgx"
    echo "  Or: sudo apt install sgx-sdk"
    ((WARN++))
fi

echo ""
echo -e "${BLUE}[6] EPC (Enclave Page Cache) Information${NC}"
echo "-----------------------------------"

if [ -f /sys/kernel/sgx_total/epc ]; then
    EPC_BYTES=$(cat /sys/kernel/sgx_total/epc 2>/dev/null || echo "0")
    if [ "$EPC_BYTES" -gt 0 ]; then
        EPC_MB=$((EPC_BYTES / 1024 / 1024))
        echo -e "${GREEN}✓ EPC Size: ${EPC_MB} MB${NC}"
        ((PASS++))

        if [ "$EPC_MB" -ge 256 ]; then
            echo -e "${GREEN}  ✓ Server-class EPC (excellent for production)${NC}"
        elif [ "$EPC_MB" -ge 128 ]; then
            echo -e "${GREEN}  ✓ Standard EPC (good for production)${NC}"
        else
            echo -e "${YELLOW}  ⚠ Small EPC (may limit concurrent enclaves)${NC}"
        fi
    else
        echo -e "${YELLOW}⚠ EPC size unknown${NC}"
        ((WARN++))
    fi
else
    echo -e "${YELLOW}⚠ Cannot determine EPC size${NC}"
    ((WARN++))
fi

echo ""
echo -e "${BLUE}[7] BIOS/UEFI Check${NC}"
echo "-----------------------------------"
echo -e "${YELLOW}⚠ Manual verification required${NC}"
echo "  Enter BIOS/UEFI setup and verify:"
echo "  1. Intel SGX is Enabled"
echo "  2. SGX Mode is set to 'BIOS-accelerated' or 'Software-controlled'"
echo "  3. Secure Boot may be enabled (optional)"

echo ""
echo -e "${BLUE}=== Summary ===${NC}"
echo -e "${GREEN}Passed: $PASS${NC}"
echo -e "${YELLOW}Warnings: $WARN${NC}"
echo -e "${RED}Failed: $FAIL${NC}"

if [ $FAIL -eq 0 ]; then
    echo ""
    echo -e "${GREEN}✓ System is ready for SGX deployment!${NC}"
    echo ""
    echo "Next steps:"
    echo "1. Install SGX SDK (if not installed):"
    echo "   sudo apt install sgx-sdk sgx-linux-dcap"
    echo ""
    echo "2. Build the enclave:"
    echo "   cd src/sgx && ./build.sh"
    echo ""
    echo "3. Enable SGX in .env:"
    echo "   SGX_ENABLED=true"
    exit 0
else
    echo ""
    echo -e "${RED}✗ System is NOT ready for SGX deployment${NC}"
    echo "  Please resolve the failed checks above"
    exit 1
fi
