/**
 * Edge-to-Fog Timing Benchmark
 *
 * Measures timing for multiple scenarios:
 * 1. Bypass mode (bypassFlag=0) - Skip evaluation entirely
 * 2. Cache hit - Edge cache lookup (cached result returned)
 * 3. Cache miss (Cloud API) - Full nested set node comparison at cloud level
 * 4. Cache miss (Local SGX) - SGX evaluation at fog node with pre-fetched data
 * 5. Cache miss (Cloud SGX) - SGX evaluation at cloud API
 *
 * Run: npx babel-watch src/benchmarks/edge-fog-timing-benchmark.js
 * Run with SGX: SGX_ENABLED=true npm run edge-fog-timing
 */

import dotenv from "dotenv";
dotenv.config();

import "../services/mongoose.js";
import Models from "../models/index.js";
import FogComputingSimulator from "../simulation/fog-layer-simulator.js";
import NetworkLatency from "../simulation/network-latency-simulator.js";
import axios from "axios";

// Configuration
const CLOUD_URL = process.env.CLOUD_URL || "http://localhost:3000";
const EDGE_SERVER_URL = "http://edge-simulator"; // Virtual URL for internal simulation
const NUM_REQUESTS = 30; // Number of requests per scenario (reduced for faster testing)
const REQUEST_DELAY = 5; // ms delay between requests

const SGX_ENABLED = process.env.SGX_ENABLED === "true";

// Timing results storage
const timingResults = {
  bypass: [],
  cacheHit: [],
  cacheMissCloud: [],
  cacheMissLocalSGX: [],
  cacheMissCloudSGX: [],
};

/**
 * Helper function to add delay between requests
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Scenario 1: Bypass Mode (bypassFlag = 0)
 * Skip evaluation entirely - just return immediately
 */
async function benchmarkBypassMode(fogSimulator, deviceIndex, appId, userId) {
  console.log("\n=== Scenario 1: Bypass Mode (bypassFlag=0) ===");
  console.log("Skip evaluation entirely - minimal latency");

  const latencies = [];

  for (let i = 0; i < NUM_REQUESTS; i++) {
    const result = await fogSimulator.simulateRequest(
      deviceIndex,
      appId,
      userId,
      null, null, null,
      0  // bypassFlag = 0
    );

    // Use totalLatency for end-to-end measurement
    latencies.push(result.totalLatency);

    if ((i + 1) % 20 === 0) {
      console.log(`  Completed ${i + 1}/${NUM_REQUESTS} requests`);
    }
  }

  // Calculate statistics
  const sorted = latencies.sort((a, b) => a - b);
  const mean = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const median = sorted[Math.floor(sorted.length / 2)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const p99 = sorted[Math.floor(sorted.length * 0.99)];
  const min = sorted[0];
  const max = sorted[sorted.length - 1];

  console.log("\n--- Bypass Mode Results ---");
  console.log(`  Mean:    ${mean.toFixed(3)} ms`);
  console.log(`  Median:  ${median.toFixed(3)} ms`);
  console.log(`  P95:     ${p95.toFixed(3)} ms`);
  console.log(`  P99:     ${p99.toFixed(3)} ms`);
  console.log(`  Min:     ${min.toFixed(3)} ms`);
  console.log(`  Max:     ${max.toFixed(3)} ms`);

  return { mean, median, p95, p99, min, max };
}

/**
 * Scenario 2: Cache Hit
 * Edge cache lookup - cached result returned
 */
async function benchmarkCacheHit(fogSimulator, deviceIndex, appId, userId) {
  console.log("\n=== Scenario 2: Cache Hit ===");
  console.log("Edge cache lookup - cached result returned");

  const latencies = [];

  // First request to populate cache (cache miss)
  await fogSimulator.simulateRequest(deviceIndex, appId, userId);
  console.log("  Cache populated with first request");

  for (let i = 0; i < NUM_REQUESTS; i++) {
    const result = await fogSimulator.simulateRequest(
      deviceIndex,
      appId,
      userId
    );

    if (!result.edgeCacheHit) {
      console.warn(`  Warning: Expected cache hit but got cache miss at iteration ${i}`);
    }

    // Use totalLatency for end-to-end measurement
    latencies.push(result.totalLatency);

    if ((i + 1) % 20 === 0) {
      console.log(`  Completed ${i + 1}/${NUM_REQUESTS} requests`);
    }
  }

  // Calculate statistics
  const sorted = latencies.sort((a, b) => a - b);
  const mean = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const median = sorted[Math.floor(sorted.length / 2)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const p99 = sorted[Math.floor(sorted.length * 0.99)];
  const min = sorted[0];
  const max = sorted[sorted.length - 1];

  console.log("\n--- Cache Hit Results ---");
  console.log(`  Mean:    ${mean.toFixed(3)} ms`);
  console.log(`  Median:  ${median.toFixed(3)} ms`);
  console.log(`  P95:     ${p95.toFixed(3)} ms`);
  console.log(`  P99:     ${p99.toFixed(3)} ms`);
  console.log(`  Min:     ${min.toFixed(3)} ms`);
  console.log(`  Max:     ${max.toFixed(3)} ms`);

  return { mean, median, p95, p99, min, max };
}

/**
 * Scenario 3: Cache Miss (Cloud API - JavaScript)
 * Full nested set node comparison at cloud level (JavaScript)
 */
async function benchmarkCacheMissCloud(fogSimulator, deviceIndex, appId, userId) {
  console.log("\n=== Scenario 3: Cache Miss (Cloud API - JavaScript) ===");
  console.log("Full nested set node comparison at cloud level");

  const latencies = [];
  let errors = 0;

  for (let i = 0; i < NUM_REQUESTS; i++) {
    // Clear cache before each request to force cache miss
    fogSimulator.clearCaches();

    try {
      const result = await fogSimulator.simulateRequest(
        deviceIndex,
        appId,
        userId,
        null, null, null,
        1,  // bypassFlag = 1 (normal evaluation)
        true  // forceCacheMiss = true
      );

      if (result.edgeCacheHit) {
        console.warn(`  Warning: Expected cache miss but got cache hit at iteration ${i}`);
      }

      // Use totalLatency for end-to-end measurement
      latencies.push(result.totalLatency);

      if ((i + 1) % 10 === 0) {
        console.log(`  Completed ${i + 1}/${NUM_REQUESTS} requests`);
      }

      await delay(REQUEST_DELAY);
    } catch (error) {
      errors++;
      if (errors <= 5) {
        console.warn(`  Request ${i} failed: ${error.message}`);
      }
    }
  }

  if (errors > 0) {
    console.warn(`  Total errors: ${errors}/${NUM_REQUESTS}`);
  }

  // Calculate statistics
  const sorted = latencies.sort((a, b) => a - b);
  const mean = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const median = sorted[Math.floor(sorted.length / 2)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const p99 = sorted[Math.floor(sorted.length * 0.99)];
  const min = sorted[0];
  const max = sorted[sorted.length - 1];

  console.log("\n--- Cache Miss (Cloud JS) Results ---");
  console.log(`  Mean:    ${mean.toFixed(3)} ms`);
  console.log(`  Median:  ${median.toFixed(3)} ms`);
  console.log(`  P95:     ${p95.toFixed(3)} ms`);
  console.log(`  P99:     ${p99.toFixed(3)} ms`);
  console.log(`  Min:     ${min.toFixed(3)} ms`);
  console.log(`  Max:     ${max.toFixed(3)} ms`);
  console.log(`  Samples: ${latencies.length}/${NUM_REQUESTS} successful`);

  return { mean, median, p95, p99, min, max };
}

/**
 * Scenario 4: Cache Miss (Local SGX at Fog Node)
 * SGX evaluation at fog node with pre-fetched app/user/policy data
 * Avoids cloud roundtrip entirely
 */
async function benchmarkCacheMissLocalSGX(fogSimulator, deviceIndex, appId, userId, appData, userData, policyData) {
  console.log("\n=== Scenario 4: Cache Miss (Local SGX at Fog Node) ===");
  console.log("SGX evaluation at fog node with pre-fetched data");

  const latencies = [];
  let errors = 0;
  let sgxUsed = 0;

  for (let i = 0; i < NUM_REQUESTS; i++) {
    // Clear cache before each request to force cache miss
    fogSimulator.clearCaches();

    try {
      const result = await fogSimulator.simulateRequest(
        deviceIndex,
        appId,
        userId,
        appData, userData, policyData,  // Pre-fetched data enables local SGX
        1,  // bypassFlag = 1 (normal evaluation)
        true  // forceCacheMiss = true
      );

      if (result.usingSGX) {
        sgxUsed++;
      }

      // Use totalLatency for end-to-end measurement
      latencies.push(result.totalLatency);

      if ((i + 1) % 10 === 0) {
        console.log(`  Completed ${i + 1}/${NUM_REQUESTS} requests (SGX used: ${sgxUsed})`);
      }

      await delay(REQUEST_DELAY);
    } catch (error) {
      errors++;
      if (errors <= 5) {
        console.warn(`  Request ${i} failed: ${error.message}`);
      }
    }
  }

  if (errors > 0) {
    console.warn(`  Total errors: ${errors}/${NUM_REQUESTS}`);
  }

  // Calculate statistics
  const sorted = latencies.sort((a, b) => a - b);
  const mean = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const median = sorted[Math.floor(sorted.length / 2)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const p99 = sorted[Math.floor(sorted.length * 0.99)];
  const min = sorted[0];
  const max = sorted[sorted.length - 1];

  console.log("\n--- Cache Miss (Local SGX) Results ---");
  console.log(`  Mean:    ${mean.toFixed(3)} ms`);
  console.log(`  Median:  ${median.toFixed(3)} ms`);
  console.log(`  P95:     ${p95.toFixed(3)} ms`);
  console.log(`  P99:     ${p99.toFixed(3)} ms`);
  console.log(`  Min:     ${min.toFixed(3)} ms`);
  console.log(`  Max:     ${max.toFixed(3)} ms`);
  console.log(`  Samples: ${latencies.length}/${NUM_REQUESTS} successful`);
  console.log(`  SGX used: ${sgxUsed}/${latencies.length} evaluations`);

  return { mean, median, p95, p99, min, max, sgxUsed };
}

/**
 * Scenario 5: Cache Miss (Cloud API with SGX)
 * Cloud API evaluation using SGX enclave
 */
async function benchmarkCacheMissCloudSGX(fogSimulator, deviceIndex, appId, userId) {
  if (!SGX_ENABLED) {
    console.log("\n=== Scenario 5: Cache Miss (Cloud API with SGX) ===");
    console.log("SKIPPED: SGX not enabled. Set SGX_ENABLED=true to run this scenario.");
    return { mean: 0, median: 0, p95: 0, p99: 0, min: 0, max: 0, sgxUsed: 0 };
  }

  console.log("\n=== Scenario 5: Cache Miss (Cloud API with SGX) ===");
  console.log("Cloud API evaluation using SGX enclave");

  const latencies = [];
  let errors = 0;
  let sgxUsed = 0;

  for (let i = 0; i < NUM_REQUESTS; i++) {
    // Clear cache before each request to force cache miss
    fogSimulator.clearCaches();

    try {
      const result = await fogSimulator.simulateRequest(
        deviceIndex,
        appId,
        userId,
        null, null, null,  // No pre-fetched data, will call cloud API
        1,  // bypassFlag = 1 (normal evaluation)
        true  // forceCacheMiss = true
      );

      if (result.usingSGX) {
        sgxUsed++;
      }

      // Use totalLatency for end-to-end measurement
      latencies.push(result.totalLatency);

      if ((i + 1) % 10 === 0) {
        console.log(`  Completed ${i + 1}/${NUM_REQUESTS} requests (SGX used: ${sgxUsed})`);
      }

      await delay(REQUEST_DELAY);
    } catch (error) {
      errors++;
      if (errors <= 5) {
        console.warn(`  Request ${i} failed: ${error.message}`);
      }
    }
  }

  if (errors > 0) {
    console.warn(`  Total errors: ${errors}/${NUM_REQUESTS}`);
  }

  // Calculate statistics
  const sorted = latencies.sort((a, b) => a - b);
  const mean = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const median = sorted[Math.floor(sorted.length / 2)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const p99 = sorted[Math.floor(sorted.length * 0.99)];
  const min = sorted[0];
  const max = sorted[sorted.length - 1];

  console.log("\n--- Cache Miss (Cloud SGX) Results ---");
  console.log(`  Mean:    ${mean.toFixed(3)} ms`);
  console.log(`  Median:  ${median.toFixed(3)} ms`);
  console.log(`  P95:     ${p95.toFixed(3)} ms`);
  console.log(`  P99:     ${p99.toFixed(3)} ms`);
  console.log(`  Min:     ${min.toFixed(3)} ms`);
  console.log(`  Max:     ${max.toFixed(3)} ms`);
  console.log(`  Samples: ${latencies.length}/${NUM_REQUESTS} successful`);
  console.log(`  SGX used: ${sgxUsed}/${latencies.length} evaluations`);

  return { mean, median, p95, p99, min, max, sgxUsed };
}

/**
 * Print comparison summary
 */
function printSummary(bypassResults, cacheHitResults, cacheMissCloudResults, cacheMissLocalSGXResults, cacheMissCloudSGXResults) {
  console.log("\n" + "=".repeat(70));
  console.log("EDGE-TO-FOG TIMING SUMMARY (End-to-End Latency)");
  console.log("=".repeat(70));
  console.log(`Requests per scenario: ${NUM_REQUESTS}`);
  console.log(`SGX Enabled: ${SGX_ENABLED ? "Yes" : "No"}`);
  console.log(`Includes: IoT→Edge (~2ms) + Edge→Fog (~10ms) + Processing`);
  console.log("");

  console.log("+-------------------------------+-------------+-------------+-------------+");
  console.log("| Scenario                      | Mean (ms)   | Median (ms) | P95 (ms)    |");
  console.log("+-------------------------------+-------------+-------------+-------------+");
  console.log(`| 1. Bypass (flag=0)            | ${bypassResults.mean.toFixed(3).padStart(11)} | ${bypassResults.median.toFixed(3).padStart(11)} | ${bypassResults.p95.toFixed(3).padStart(11)} |`);
  console.log(`| 2. Cache Hit                  | ${cacheHitResults.mean.toFixed(3).padStart(11)} | ${cacheHitResults.median.toFixed(3).padStart(11)} | ${cacheHitResults.p95.toFixed(3).padStart(11)} |`);
  console.log(`| 3. Cache Miss (Cloud JS)      | ${cacheMissCloudResults.mean.toFixed(3).padStart(11)} | ${cacheMissCloudResults.median.toFixed(3).padStart(11)} | ${cacheMissCloudResults.p95.toFixed(3).padStart(11)} |`);

  if (cacheMissLocalSGXResults.mean > 0) {
    console.log(`| 4. Cache Miss (Local SGX)     | ${cacheMissLocalSGXResults.mean.toFixed(3).padStart(11)} | ${cacheMissLocalSGXResults.median.toFixed(3).padStart(11)} | ${cacheMissLocalSGXResults.p95.toFixed(3).padStart(11)} |`);
  }
  if (cacheMissCloudSGXResults.mean > 0) {
    console.log(`| 5. Cache Miss (Cloud SGX)     | ${cacheMissCloudSGXResults.mean.toFixed(3).padStart(11)} | ${cacheMissCloudSGXResults.median.toFixed(3).padStart(11)} | ${cacheMissCloudSGXResults.p95.toFixed(3).padStart(11)} |`);
  }
  console.log("+-------------------------------+-------------+-------------+-------------+");

  console.log("");
  console.log("+-------------------------------+------------------------------------------------+");
  console.log("| Scenario                      | Notes                                           |");
  console.log("+-------------------------------+------------------------------------------------+");
  console.log("| 1. Bypass (flag=0)            | Instant skip                                      |");
  console.log("| 2. Cache Hit                  | Edge cache lookup                                 |");
  console.log("| 3. Cache Miss (Cloud JS)      | Cloud API evaluation                              |");
  if (cacheMissLocalSGXResults.mean > 0) {
    const sgxNote = SGX_ENABLED && cacheMissLocalSGXResults.sgxUsed > 0
      ? `Fog node SGX (${cacheMissLocalSGXResults.sgxUsed}/${NUM_REQUESTS} used SGX)`
      : "Fog node local (SGX not available)";
    console.log(`| 4. Cache Miss (Local SGX)     | ${sgxNote.padEnd(48)} |`);
  }
  if (cacheMissCloudSGXResults.mean > 0) {
    const cloudSgxNote = SGX_ENABLED && cacheMissCloudSGXResults.sgxUsed > 0
      ? `Cloud SGX (${cacheMissCloudSGXResults.sgxUsed}/${NUM_REQUESTS} used SGX)`
      : "SGX not enabled";
    console.log(`| 5. Cache Miss (Cloud SGX)     | ${cloudSgxNote.padEnd(48)} |`);
  }
  console.log("+-------------------------------+------------------------------------------------+");

  console.log("");
  console.log("Speedup Ratios (relative to Cloud JS):");
  const baseline = cacheMissCloudResults.mean;
  console.log(`  Bypass:         ${(baseline / bypassResults.mean || 0).toFixed(2)}x faster`);
  console.log(`  Cache Hit:      ${(baseline / cacheHitResults.mean).toFixed(2)}x faster`);
  if (cacheMissLocalSGXResults.mean > 0) {
    console.log(`  Local SGX:      ${(baseline / cacheMissLocalSGXResults.mean).toFixed(2)}x faster`);
  }
  if (cacheMissCloudSGXResults.mean > 0) {
    console.log(`  Cloud SGX:      ${(baseline / cacheMissCloudSGXResults.mean).toFixed(2)}x faster`);
  }

  console.log("");
  console.log("Key Insights:");
  console.log(`  • Edge cache eliminates ~${(baseline - cacheHitResults.mean).toFixed(1)}ms per request`);
  if (cacheMissLocalSGXResults.mean > 0) {
    console.log(`  • Local SGX at fog saves ~${(cacheMissCloudResults.mean - cacheMissLocalSGXResults.mean).toFixed(1)}ms vs cloud JS`);
    console.log(`  • Local SGX is ~${((cacheMissCloudResults.mean - cacheMissLocalSGXResults.mean) / cacheMissCloudResults.mean * 100).toFixed(1)}% faster than cloud roundtrip`);
  }
  console.log("=".repeat(70));
}

/**
 * Main benchmark execution
 */
async function main() {
  console.log("\n" + "=".repeat(70));
  console.log("EDGE-TO-FOG TIMING BENCHMARK");
  console.log("=".repeat(70));
  console.log(`SGX Enabled: ${SGX_ENABLED ? "Yes" : "No"}`);

  // Check if API server is running
  try {
    await axios.get(`${CLOUD_URL}/health`);
    console.log(`\nConnected to cloud API at ${CLOUD_URL}`);
  } catch (error) {
    console.error(`\nError: Cannot connect to cloud API at ${CLOUD_URL}`);
    console.error("Please start the API server first: npm run api");
    process.exit(1);
  }

  // Get test data
  const apps = await Models.App.find().limit(1);
  const users = await Models.User.find().limit(1);
  const policy = await Models.PrivacyPolicy.findOne();

  if (apps.length === 0 || users.length === 0 || !policy) {
    console.error("\nError: No test data found in database");
    console.error("Please run test data generator first: npx babel-watch src/generators/quick-test-data.js");
    process.exit(1);
  }

  const appId = apps[0]._id.toString();
  const userId = users[0]._id.toString();
  const deviceIndex = 0;

  console.log(`  Using App ID: ${appId}`);
  console.log(`  Using User ID: ${userId}`);
  console.log(`  Using Device: iot-${deviceIndex}`);

  // Initialize fog simulator
  const fogSimulator = new FogComputingSimulator(CLOUD_URL, EDGE_SERVER_URL);
  await fogSimulator.initialize(10, 3, 2);
  console.log(`  Fog nodes: ${fogSimulator.fogNodes.length}`);
  console.log(`  Edge nodes: ${fogSimulator.edgeNodes.length}`);
  console.log(`  IoT devices: ${fogSimulator.iotDevices.length}`);

  try {
    // Run benchmarks
    const bypassResults = await benchmarkBypassMode(fogSimulator, deviceIndex, appId, userId);
    const cacheHitResults = await benchmarkCacheHit(fogSimulator, deviceIndex, appId, userId);
    const cacheMissCloudResults = await benchmarkCacheMissCloud(fogSimulator, deviceIndex, appId, userId);
    const cacheMissLocalSGXResults = await benchmarkCacheMissLocalSGX(
      fogSimulator, deviceIndex, appId, userId,
      apps[0], users[0], policy
    );
    const cacheMissCloudSGXResults = await benchmarkCacheMissCloudSGX(fogSimulator, deviceIndex, appId, userId);

    // Print summary
    printSummary(
      bypassResults,
      cacheHitResults,
      cacheMissCloudResults,
      cacheMissLocalSGXResults,
      cacheMissCloudSGXResults
    );

    console.log("\nBenchmark completed successfully!");
  } catch (error) {
    console.error("\nBenchmark failed:", error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run benchmark
main().catch(console.error);
