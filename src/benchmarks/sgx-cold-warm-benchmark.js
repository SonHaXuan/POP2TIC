/**
 * SGX Cold Start vs Warm Start Benchmark
 *
 * Measures the performance difference between:
 * 1. Cold Start: Enclave initialization + first evaluation
 * 2. Warm Start: Subsequent evaluations (enclave already loaded)
 *
 * Usage:
 *   npx babel-watch src/benchmarks/sgx-cold-warm-benchmark.js
 */

import Models from "../models/index.js";
import sgxEvaluator from "../sgx/index.js";
import { createCollector } from "../metrics/collector.js";
import os from "os";
import { fileURLToPath } from "url";
import path from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Benchmark configuration
const WARM_START_ITERATIONS = 100;
const COLD_START_ITERATIONS = 10;

/**
 * High-resolution timing utility
 */
function measureTime(fn) {
  const startTime = process.hrtime.bigint();
  const result = fn();
  const endTime = process.hrtime.bigint();
  const latencyNs = endTime - startTime;
  return {
    result,
    latencyMs: Number(latencyNs) / 1_000_000,
  };
}

/**
 * Async high-resolution timing utility
 */
async function measureTimeAsync(fn) {
  const startTime = process.hrtime.bigint();
  const result = await fn();
  const endTime = process.hrtime.bigint();
  const latencyNs = endTime - startTime;
  return {
    result,
    latencyMs: Number(latencyNs) / 1_000_000,
  };
}

/**
 * Calculate statistics from latency array
 */
function calculateStats(latencies) {
  const sorted = [...latencies].sort((a, b) => a - b);
  const n = sorted.length;

  const sum = sorted.reduce((a, b) => a + b, 0);
  const mean = sum / n;

  const median = sorted[Math.floor(n / 2)];

  const p95 = sorted[Math.floor(n * 0.95)];
  const p99 = sorted[Math.floor(n * 0.99)];

  const variance = sorted.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const stdDev = Math.sqrt(variance);

  return {
    min: sorted[0],
    max: sorted[n - 1],
    mean,
    median,
    p95,
    p99,
    stdDev,
  };
}

/**
 * Get test data for evaluation
 */
async function getTestData() {
  const users = await Models.User.find().limit(1);
  const apps = await Models.App.find().limit(1);
  const policies = await Models.PrivacyPolicy.findOne();

  if (users.length === 0 || apps.length === 0 || !policies) {
    throw new Error("No test data found. Run: npx babel-watch src/generators/quick-test-data.js");
  }

  return {
    user: users[0],
    app: apps[0],
    policy: policies,
  };
}

/**
 * Benchmark Cold Start (Enclave Initialization + First Evaluation)
 *
 * This measures the full cold path:
 * 1. Create new SGX evaluator instance
 * 2. Initialize enclave (allocate EPC, load enclave)
 * 3. Perform first evaluation
 */
async function benchmarkColdStart(iterations, testData) {
  console.log(`\n=== Cold Start Benchmark (${iterations} iterations) ===`);
  console.log("Measuring: Enclave initialization + first evaluation");

  const latencies = [];

  for (let i = 0; i < iterations; i++) {
    // Create fresh evaluator instance each time
    const { SGXPrivacyEvaluator } = await import("../sgx/index.js");
    const freshEvaluator = new SGXPrivacyEvaluator();

    const { result, latencyMs } = await measureTimeAsync(async () => {
      // Initialize enclave (cold start)
      const initialized = await freshEvaluator.initialize();
      if (!initialized) {
        throw new Error("Failed to initialize SGX enclave");
      }

      // First evaluation
      return await freshEvaluator.evaluate(
        testData.app,
        testData.user,
        testData.policy
      );
    });

    latencies.push(latencyMs);

    // Clean up: destroy enclave after each iteration
    freshEvaluator.destroy();

    if ((i + 1) % Math.floor(iterations / 10) === 0) {
      console.log(`  Progress: ${i + 1}/${iterations} iterations`);
    }
  }

  return calculateStats(latencies);
}

/**
 * Benchmark Warm Start (Evaluation with Enclave Already Loaded)
 *
 * This measures the warm path:
 * 1. Enclave already initialized
 * 2. Only evaluation overhead (serialization + enclave call)
 */
async function benchmarkWarmStart(iterations, testData) {
  console.log(`\n=== Warm Start Benchmark (${iterations} iterations) ===`);
  console.log("Measuring: Evaluation with enclave already loaded");

  // Ensure enclave is initialized once
  const initialized = await sgxEvaluator.initialize();
  if (!initialized) {
    throw new Error("Failed to initialize SGX enclave");
  }

  // Small warm-up
  for (let i = 0; i < 5; i++) {
    await sgxEvaluator.evaluate(testData.app, testData.user, testData.policy);
  }

  const latencies = [];

  for (let i = 0; i < iterations; i++) {
    const { result, latencyMs } = await measureTimeAsync(async () => {
      return await sgxEvaluator.evaluate(
        testData.app,
        testData.user,
        testData.policy
      );
    });

    latencies.push(latencyMs);

    if ((i + 1) % Math.floor(iterations / 10) === 0) {
      console.log(`  Progress: ${i + 1}/${iterations} iterations`);
    }
  }

  return calculateStats(latencies);
}

/**
 * Benchmark JavaScript evaluation (baseline comparison)
 */
async function benchmarkJavaScriptEvaluation(iterations, testData) {
  console.log(`\n=== JavaScript Evaluation Benchmark (${iterations} iterations) ===`);
  console.log("Measuring: Plain JS evaluation without SGX");

  const { evaluatePrivacyCompliance } = await import("../helpers/privacy-preference.helper.js");

  // Small warm-up
  for (let i = 0; i < 5; i++) {
    await evaluatePrivacyCompliance(
      testData.app,
      testData.user,
      testData.policy
    );
  }

  const latencies = [];

  for (let i = 0; i < iterations; i++) {
    const { result, latencyMs } = await measureTimeAsync(async () => {
      return await evaluatePrivacyCompliance(
        testData.app,
        testData.user,
        testData.policy
      );
    });

    latencies.push(latencyMs);

    if ((i + 1) % Math.floor(iterations / 10) === 0) {
      console.log(`  Progress: ${i + 1}/${iterations} iterations`);
    }
  }

  return calculateStats(latencies);
}

/**
 * Print benchmark results
 */
function printResults(coldStartStats, warmStartStats, jsStats) {
  console.log("\n" + "=".repeat(80));
  console.log("SGX COLD START VS WARM START BENCHMARK RESULTS");
  console.log("=".repeat(80));

  console.log("\n## Cold Start (Enclave Init + First Evaluation)");
  console.log("-".repeat(80));
  console.log(`Min:      ${coldStartStats.min.toFixed(3)} ms`);
  console.log(`Mean:     ${coldStartStats.mean.toFixed(3)} ms`);
  console.log(`Median:   ${coldStartStats.median.toFixed(3)} ms`);
  console.log(`P95:      ${coldStartStats.p95.toFixed(3)} ms`);
  console.log(`P99:      ${coldStartStats.p99.toFixed(3)} ms`);
  console.log(`Max:      ${coldStartStats.max.toFixed(3)} ms`);
  console.log(`StdDev:   ${coldStartStats.stdDev.toFixed(3)} ms`);

  console.log("\n## Warm Start (Evaluation Only, Enclave Loaded)");
  console.log("-".repeat(80));
  console.log(`Min:      ${warmStartStats.min.toFixed(3)} ms`);
  console.log(`Mean:     ${warmStartStats.mean.toFixed(3)} ms`);
  console.log(`Median:   ${warmStartStats.median.toFixed(3)} ms`);
  console.log(`P95:      ${warmStartStats.p95.toFixed(3)} ms`);
  console.log(`P99:      ${warmStartStats.p99.toFixed(3)} ms`);
  console.log(`Max:      ${warmStartStats.max.toFixed(3)} ms`);
  console.log(`StdDev:   ${warmStartStats.stdDev.toFixed(3)} ms`);

  console.log("\n## JavaScript Evaluation (Baseline, No SGX)");
  console.log("-".repeat(80));
  console.log(`Min:      ${jsStats.min.toFixed(3)} ms`);
  console.log(`Mean:     ${jsStats.mean.toFixed(3)} ms`);
  console.log(`Median:   ${jsStats.median.toFixed(3)} ms`);
  console.log(`P95:      ${jsStats.p95.toFixed(3)} ms`);
  console.log(`P99:      ${jsStats.p99.toFixed(3)} ms`);
  console.log(`Max:      ${jsStats.max.toFixed(3)} ms`);
  console.log(`StdDev:   ${jsStats.stdDev.toFixed(3)} ms`);

  console.log("\n## Comparison Analysis");
  console.log("-".repeat(80));

  const coldVsWarmRatio = coldStartStats.mean / warmStartStats.mean;
  const warmVsJsRatio = warmStartStats.mean / jsStats.mean;
  const coldVsJsRatio = coldStartStats.mean / jsStats.mean;
  const coldMinusWarm = coldStartStats.mean - warmStartStats.mean;

  console.log(`Cold Start / Warm Start Ratio:     ${coldVsWarmRatio.toFixed(2)}x`);
  console.log(`Warm Start / JS Ratio:             ${warmVsJsRatio.toFixed(2)}x`);
  console.log(`Cold Start / JS Ratio:             ${coldVsJsRatio.toFixed(2)}x`);
  console.log(`Cold Start Overhead:               ${coldMinusWarm.toFixed(3)} ms`);
  console.log("");
  console.log("**Interpretation:**");
  console.log(`- Cold start is ${coldVsWarmRatio.toFixed(1)}x slower than warm start`);
  console.log(`- Initialization overhead: ~${coldMinusWarm.toFixed(1)}ms`);
  console.log(`- Warm start (SGX) vs JS: ${warmVsJsRatio.toFixed(2)}x ratio`);

  return {
    coldStart: coldStartStats,
    warmStart: warmStartStats,
    javascript: jsStats,
    comparison: {
      coldVsWarmRatio,
      warmVsJsRatio,
      coldVsJsRatio,
      coldOverheadMs: coldMinusWarm,
    },
  };
}

/**
 * Main benchmark execution
 */
async function main() {
  console.log("SGX Cold Start vs Warm Start Benchmark");
  console.log("=".repeat(80));

  // Check if SGX is available
  const sgxEnabled = process.env.SGX_ENABLED === "true";
  if (!sgxEnabled) {
    console.error("\n[ERROR] SGX is not enabled!");
    console.error("Please set SGX_ENABLED=true in .env file");
    console.error("And ensure SGX enclave is built: npm run build-sgx");
    process.exit(1);
  }

  // Connect to database
  const { connectDB } = await import("../services/mongoose.js");
  await connectDB();

  // Get test data
  console.log("\nLoading test data...");
  const testData = await getTestData();
  console.log("Test data loaded");

  // Create metrics collector
  const collector = createCollector();

  // Collect system info
  const cpus = os.cpus();
  collector.addSystemInfo({
    platform: os.platform(),
    arch: os.arch(),
    cpuModel: cpus[0].model,
    cpus: cpus.length,
    totalMemoryGB: (os.totalmem() / 1024 / 1024 / 1024).toFixed(2),
    nodeVersion: process.version,
    sgxEnabled: true,
  });

  collector.addCustomData("benchmarkType", "sgx-cold-warm-start");

  try {
    // Run benchmarks
    const coldStartStats = await benchmarkColdStart(COLD_START_ITERATIONS, testData);
    const warmStartStats = await benchmarkWarmStart(WARM_START_ITERATIONS, testData);
    const jsStats = await benchmarkJavaScriptEvaluation(WARM_START_ITERATIONS, testData);

    // Print and collect results
    const results = printResults(coldStartStats, warmStartStats, jsStats);

    collector.addCustomData("coldStart", coldStartStats);
    collector.addCustomData("warmStart", warmStartStats);
    collector.addCustomData("javascript", jsStats);
    collector.addCustomData("comparison", results.comparison);

    // Export results
    const exported = collector.export("sgx-cold-warm-start");

    console.log("\n" + "=".repeat(80));
    console.log(`Benchmark completed! Results exported to: ./results/`);
    console.log("=".repeat(80));

  } catch (error) {
    console.error("\n[ERROR] Benchmark failed:", error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
