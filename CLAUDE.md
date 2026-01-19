# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

POP2TIC is a **privacy compliance evaluation system** for fog computing environments. It validates whether applications comply with user privacy preferences using a hierarchical policy model and hash-based edge caching for ultra-low latency performance.

**Key Innovation**: Uses the **Nested Set Model** for hierarchical attribute/purpose queries and **MD5 hash-based caching** with TTL to achieve sub-3ms privacy evaluation.

## Technology Stack

- **Backend**: Node.js with ES6 modules (`"type": "module"`), Babel transpilation
- **Database**: MongoDB with Mongoose ODM
- **API**: Express.js RESTful server
- **Caching**: MD5 hash-based with TTL via mongoose
- **Development**: `babel-watch` for hot-reloading, ESLint + Prettier
- **Security**: Intel SGX enclave support for secure privacy evaluation (optional)

## Architecture

### 4-Tier Fog Computing Model
```
IoT Devices (20) → Edge Nodes (5) → Fog Nodes (3) → Cloud (MongoDB)
   ~2.35 ms           ~10.48 ms         ~52.25 ms        ~11.43 ms
                      [Edge Cache achieves 100% hit rate]
                      Total end-to-end: ~2.36 ms
```

### Core Components

1. **Privacy Policy Hierarchy** (`src/models/privacy-policy.model.js`)
   - Stores hierarchical attributes and purposes using **Nested Set Model**
   - Each node has `left` and `right` values for efficient ancestor/descendant queries
   - Query pattern: `left: { $lte: child.left }, right: { $gte: child.right }`

2. **Privacy Evaluation** (`src/helpers/privacy-preference.helper.js`)
   - Three evaluation checks: attributes, purposes, time of retention
   - Each check validates: `allowed AND NOT except AND NOT deny`
   - Uses MongoDB aggregation for nested set lookups

3. **Hash-Based Caching** (`src/models/evaluate-hash.model.js`)
   - Cache key: `md5(md5(app) + "-" + md5(userPreferences))`
   - TTL based on user's `timeofRetention` setting
   - Checked before full evaluation for ~32x speedup

4. **Fog Layer Simulation** (`src/simulation/fog-layer-simulator.js`)
   - `IoTDevice` class: simulates sensors/cameras/wearables with battery and memory constraints
   - `EdgeNode` class: local in-memory cache at network edge
   - `FogNode` class: coordinates between edge and cloud
   - `FogComputingSimulator`: orchestrates the full hierarchy

5. **REST API** (`src/api/server.js`)
   - POST `/api/evaluate` - Main privacy compliance endpoint
   - GET/POST `/api/users` - User and preference management
   - GET/POST `/api/apps` - Application management
   - GET `/api/policy` - Privacy policy hierarchy
   - GET `/api/cache/stats` - Cache statistics

6. **Intel SGX Enclave** (`src/sgx/`)
   - **Enclave**: C++ implementation (`Enclave.cpp`) of privacy evaluation logic
   - **EDL Interface**: `PrivacyEvaluation.edl` defines enclave boundary
   - **Node.js Addon**: `App.cpp` bridges Node.js ↔ SGX enclave
   - **Wrapper**: `index.js` provides async JavaScript interface

## Intel SGX Integration

### Overview
Privacy evaluation can be performed inside Intel SGX enclaves for hardware-level security. The enclave receives pre-fetched data (app, user, policy), performs evaluation entirely within trusted memory, and returns the result.

### Architecture
```
┌─────────────────────────────────────────────────────────────┐
│                   Untrusted Memory                          │
│  Node.js (Express API)  →  MongoDB fetch  →  JSON data     │
└─────────────────────────────┬───────────────────────────────┘
                              │ ECALL
┌─────────────────────────────▼───────────────────────────────┐
│                   Trusted Memory (SGX Enclave)              │
│  • Deserialize JSON                                         │
│  • Nested Set Model evaluation (C++)                        │
│  • Return "grant" or "deny"                                │
└─────────────────────────────────────────────────────────────┘
```

### Enabling SGX
```bash
# 1. Build SGX enclave and native addon
npm run build-sgx

# 2. Enable SGX in .env
SGX_ENABLED=true

# 3. Start API with SGX
npm run sgx-api
```

### SGX Implementation Details

**Files Created:**
- `src/sgx/enclave/Edl/PrivacyEvaluation.edl` - Enclave interface definition
- `src/sgx/enclave/Enclave.h` - C++ header with evaluation functions
- `src/sgx/enclave/Enclave.cpp` - Privacy evaluation ported from JS to C++
- `src/sgx/enclave/Enclave.config.xml` - SGX enclave configuration
- `src/sgx/app/App.h` / `App.cpp` - Node.js native addon (n-api)
- `src/sgx/binding.gyp` - Build configuration
- `src/sgx/build.sh` - Build script
- `src/sgx/index.js` - JavaScript wrapper

**Data Flow:**
1. MongoDB fetches app, user, policy data (outside enclave)
2. Data serialized to JSON strings
3. Passed to enclave via ECALL `ecall_evaluate_privacy()`
4. Enclave parses JSON, performs nested set evaluation in C++
5. Result ("grant"/"deny") returned to Node.js

**Key Constraints:**
- MongoDB cannot run inside enclave (no network I/O)
- JSON parsing happens at enclave boundary
- Enclave has limited memory (EPC) - keep data structures compact
- Evaluation logic in C++ mirrors `src/helpers/privacy-preference.helper.js`

### SGX in Fog Layer
Fog nodes can perform local SGX evaluation when app/user/policy data is available:
```javascript
// Pass data for local SGX evaluation
await fogSimulator.simulateRequest(
  deviceIndex, appId, userId,
  appData, userData, policyData  // Enables local SGX at fog node
);
```

### Fallback Strategy
If SGX fails or is unavailable, automatically falls back to JavaScript evaluation. Check the `usingSGX` field in API response to confirm which method was used.

## Development Commands

### Essential Commands
```bash
# Install dependencies
npm install

# Start MongoDB (local)
mongod --dbpath ~/data/db --fork

# Generate test data (required before running benchmarks or API)
npx babel-watch src/generators/quick-test-data.js

# Start API server (port 3000)
npm run api

# Development mode with hot-reload
npm run dev
```

### Build & Production
```bash
# Transpile src/ to dist/ with Babel
npm run build

# Production (builds then runs)
npm start

# Linting (auto-fix)
npm run lint
```

### Benchmarks
```bash
# Run all latency/throughput benchmarks
npm run benchmark

# Fog layer latency simulation
npm run fog-benchmark

# Comparative baseline (no-cache, flat-hierarchy)
npm run comparative

# Security evaluation (MITM attack resistance)
npx babel-watch src/benchmarks/mitm-attack-simulation.js
```

### Docker Scaling
```bash
# 3 fog validator instances + Nginx load balancer
docker-compose -f docker-compose.scalability.yml up -d
```

## Database Setup

1. **MongoDB URL**: Set in `.env` as `MONGODB_URL` (default: `mongodb://localhost:27017/privacy-policy`)

2. **Initialize Privacy Policy**: The hierarchy must be created first
   - Run `src/index.js` or `src/generators/quick-test-data.js` to seed the policy tree
   - The policy contains nested attributes (Identifier > Name, UserId, etc.) and purposes

3. **Collections**:
   - `privacypolicies` - Hierarchical attribute/purpose definitions
   - `users` - User privacy preferences (attributes, purposes, timeofRetention)
   - `apps` - Application data requests
   - `evaluatehashes` - Cache entries with TTL

## Key Design Patterns

### Nested Set Model Queries
When checking if an app attribute is allowed by user preferences:
```javascript
// Find if any user preference attribute is an ancestor of app attribute
await Models.PrivacyPolicy.findOne({
  attributes: {
    $elemMatch: {
      _id: { $in: userAllowedAttributes },
      left: { $lte: appAttribute.left },
      right: { $gte: appAttribute.right },
    },
  },
});
```

### Cache Invalidation
- User preference updates delete all cache entries for that user
- Cache entries respect user's `timeofRetention` setting as TTL

### Fog Simulation Timing
Network latencies are simulated in `src/simulation/network-latency-simulator.js`:
- IoT → Edge: WiFi/Bluetooth (~2ms)
- Edge → Fog: LAN/Metro (~10ms)
- Fog → Cloud: WAN/Internet (~52ms)

## Code Organization

```
src/
├── models/              # Mongoose schemas (User, App, PrivacyPolicy, EvaluateHash)
├── helpers/             # Privacy evaluation logic (nested set queries)
├── services/            # Database connection (mongoose.js)
├── api/                 # Express server with REST endpoints
├── sgx/                 # Intel SGX enclave integration
│   ├── enclave/         # SGX enclave code (C++)
│   │   ├── Edl/         # EDL interface files
│   │   ├── Enclave.cpp  # Privacy evaluation in C++
│   │   ├── Enclave.h    # Header file
│   │   └── Enclave.config.xml
│   ├── app/             # Node.js native addon
│   │   ├── App.cpp      # Bridge between Node.js and SGX
│   │   └── App.h
│   ├── build.sh         # Build script
│   ├── binding.gyp      # node-gyp configuration
│   └── index.js         # JavaScript wrapper
├── benchmarks/          # Performance & security tests
│   ├── latency-benchmark.js        # Cache hit/miss, nested set queries
│   ├── throughput-benchmark.js     # Req/s capacity
│   ├── fog-layer-benchmark.js      # Full fog hierarchy simulation
│   ├── mitm-attack-simulation.js   # Security evaluation
│   └── run-all-benchmarks.js       # Run all benchmarks
├── baselines/           # Comparison implementations (no-cache, flat-hierarchy)
│   ├── comparative-benchmark.js    # Baseline comparison
│   ├── flat-hierarchy.js           # Flat hierarchy implementation
│   └── no-cache.js                  # No-cache baseline
├── simulation/          # Fog computing simulator (IoT/Edge/Fog classes)
│   ├── network-latency-simulator.js
│   └── fog-layer-simulator.js
├── generators/          # Test data creation
│   ├── quick-test-data.js          # Quick test data generator
│   └── test-data-generator.js       # Full test data generator
├── metrics/             # Metrics collector for benchmarks
├── web/                 # Web UI prototype (for benchmark visualization)
└── index.js            # Entry point for basic evaluation demo
```

## Performance Characteristics

- **Cache Hit**: ~0.44 ms mean, ~0.74 ms P95
- **Cache Miss (Full Validation)**: ~2.79 ms mean, ~4.07 ms P95
- **Throughput**: 440-500 req/s per instance
- **Fog Speedup**: 33.9x faster with edge cache vs direct IoT→Cloud
- **Security**: 91.7% protection rate against MITM attacks

## Common Pitfalls

1. **Missing test data**: Always run `npx babel-watch src/generators/quick-test-data.js` before benchmarks or API testing
2. **MongoDB not running**: API will fail silently with connection errors
3. **ES6 modules**: Use `.js` extensions in imports (e.g., `import foo from "./bar.js"`)
4. **TTL confusion**: Cache TTL is based on user's `timeofRetention` (seconds), not fixed
5. **SGX not built**: If `SGX_ENABLED=true` but `npm run build-sgx` hasn't been run, falls back to JS evaluation
6. **SGX SDK path**: Build script assumes SGX SDK at `/opt/intel/sgxsdk` - update `build.sh` if different
7. **edger8r tool**: Must be in PATH to generate EDL interface files from `.edl` definitions

## Project Files

### Root Level Files
- `package.json` - Project dependencies and scripts
- `.env` - Environment configuration (MongoDB URL, SGX_ENABLED flag)
- `babel.config.json` - Babel transpilation configuration
- `.eslintrc.js` - ESLint linting rules
- `.gitignore` - Git ignore patterns

### Git Ignore Patterns
The `.gitignore` file excludes:
- `node_modules/`, `dist/`, `build/` - Dependencies and build artifacts
- `src/sgx/build/`, `*.so`, `*.o` - SGX build artifacts
- `results/`, `benchmark_*.*` - Benchmark result files
- `.DS_Store`, `*.log` - macOS system files and logs
- `.env.local` - Local environment overrides
- Editor configs: `.vscode/`, `.idea/`, etc.

### Build Artifacts Not Committed
- `dist/` - Babel transpiled output (regenerated by `npm run build`)
- `src/sgx/build/` - SGX enclave build output
- `results/` - Benchmark results (regenerated on each run)
