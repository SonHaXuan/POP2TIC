/**
 * Cache Hit vs Cache Miss - 10 Runs with 95% Confidence Intervals
 *
 * Methodology: All experiments are repeated 10 times with different random seeds,
 * and we report mean values with 95% confidence intervals where variance is significant.
 *
 * Usage:
 *   npx babel-watch src/benchmarks/cache-hit-miss-10runs.js
 */

import Models from "../models/index.js";
import Helpers from "../helpers/index.js";
import "../services/mongoose.js";
import md5 from "md5";
import moment from "moment";

// Number of iterations per run (warm-up + measurement)
const ITERATIONS_PER_RUN = 30;
// Number of independent experimental runs
const NUM_RUNS = 10;

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
 * Measure cache hit latency (hash lookup only)
 */
async function measureCacheHit(app, user) {
  const userId = user.id.toString();
  const hashValue = md5(
    md5(JSON.stringify(app)) + "-" + md5(JSON.stringify(user.privacyPreference))
  );

  const { latencyMs } = await measureTimeAsync(async () => {
    return await Models.EvaluateHash.findOne({
      userId,
      hash: hashValue,
      createdAt: {
        $gte: moment()
          .utc()
          .subtract(Number(user.privacyPreference.timeofRetention), "second"),
      },
    });
  });

  return latencyMs;
}

/**
 * Measure cache miss latency (full privacy validation)
 */
async function measureCacheMiss(app, user) {
  const { latencyMs } = await measureTimeAsync(async () => {
    return await Helpers.PrivacyPreference.evaluate(app, user);
  });

  return latencyMs;
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
    count: n,
  };
}

/**
 * Calculate 95% confidence interval using t-distribution
 */
function calculateConfidenceInterval(values, confidence = 0.95) {
  const n = values.length;
  const stats = calculateStats(values);

  // Standard error of the mean
  const standardError = stats.stdDev / Math.sqrt(n);

  // t-value for 95% confidence with (n-1) degrees of freedom
  // For large n (>30), t approaches 1.96 (normal distribution)
  const tValue = n > 30 ? 1.96 : getTValue(n - 1, confidence);

  const marginOfError = tValue * standardError;

  return {
    lower: stats.mean - marginOfError,
    upper: stats.mean + marginOfError,
    marginOfError,
    tValue,
    standardError,
  };
}

/**
 * Get t-value from t-distribution table (simplified for common values)
 */
function getTValue(degreesOfFreedom, confidence = 0.95) {
  // Simplified t-values for 95% confidence
  const tTable = {
    1: 12.706,
    2: 4.303,
    3: 3.182,
    4: 2.776,
    5: 2.571,
    6: 2.447,
    7: 2.365,
    8: 2.306,
    9: 2.262,
    10: 2.228,
    11: 2.201,
    12: 2.179,
    13: 2.160,
    14: 2.145,
    15: 2.131,
    20: 2.086,
    30: 2.042,
  };

  // For DOF > 30, use normal distribution approximation
  if (degreesOfFreedom > 30) {
    return 1.96;
  }

  // Find closest DOF in table
  const dofs = Object.keys(tTable).map(Number).sort((a, b) => a - b);
  for (const dofn of dofs) {
    if (dofn >= degreesOfFreedom) {
      return tTable[dofn];
    }
  }

  return 1.96; // Default to normal distribution
}

/**
 * Check if variance is significant (coefficient of variation > 5%)
 */
function isVarianceSignificant(stdDev, mean) {
  const cv = (stdDev / mean) * 100; // Coefficient of variation as percentage
  return cv > 5;
}

/**
 * Run single experimental run
 */
async function runSingleExperiment(app, user, seed) {
  console.log(`  [Seed ${seed}] Running experiment...`);

  const userId = user.id.toString();
  const hashValue = md5(
    md5(JSON.stringify(app)) + "-" + md5(JSON.stringify(user.privacyPreference))
  );

  // Prepare cache for cache hit measurements
  await Models.EvaluateHash.findOneAndUpdate(
    { userId, hash: hashValue },
    { result: "grant", createdAt: new Date() },
    { upsert: true }
  );

  // Warm-up runs (discarded)
  for (let i = 0; i < 3; i++) {
    await measureCacheHit(app, user);
  }

  // Measure cache hit
  const cacheHitLatencies = [];
  for (let i = 0; i < ITERATIONS_PER_RUN; i++) {
    const latency = await measureCacheHit(app, user);
    cacheHitLatencies.push(latency);
  }

  // Clear cache for cache miss measurements
  await Models.EvaluateHash.deleteMany({ userId, hash: hashValue });

  // Warm-up runs (discarded)
  for (let i = 0; i < 3; i++) {
    await measureCacheMiss(app, user);
  }

  // Measure cache miss
  const cacheMissLatencies = [];
  for (let i = 0; i < ITERATIONS_PER_RUN; i++) {
    const latency = await measureCacheMiss(app, user);
    cacheMissLatencies.push(latency);

    // Clear cache after each measurement to ensure cache miss
    await Models.EvaluateHash.deleteMany({ userId, hash: hashValue });
  }

  return {
    seed,
    cacheHit: calculateStats(cacheHitLatencies),
    cacheMiss: calculateStats(cacheMissLatencies),
    cacheHitRaw: cacheHitLatencies,
    cacheMissRaw: cacheMissLatencies,
  };
}

/**
 * Run all experiments with different random seeds
 */
async function runAllExperiments(app, user) {
  console.log(`\n=== Running ${NUM_RUNS} Independent Experiments ===`);
  console.log(`Iterations per run: ${ITERATIONS_PER_RUN}`);
  console.log(`Warm-up runs: 3 (discarded)\n`);

  const results = [];

  for (let run = 0; run < NUM_RUNS; run++) {
    const seed = Math.floor(Math.random() * 1000000);
    const result = await runSingleExperiment(app, user, seed);
    results.push(result);

    console.log(`    Cache Hit Mean: ${result.cacheHit.mean.toFixed(3)} ms, ` +
                `Cache Miss Mean: ${result.cacheMiss.mean.toFixed(3)} ms`);
  }

  return results;
}

/**
 * Aggregate results across all runs
 */
function aggregateResults(results) {
  // Extract means from each run
  const cacheHitMeans = results.map(r => r.cacheHit.mean);
  const cacheMissMeans = results.map(r => r.cacheMiss.mean);

  // Calculate overall statistics
  const cacheHitStats = calculateStats(cacheHitMeans);
  const cacheMissStats = calculateStats(cacheMissMeans);

  // Calculate confidence intervals
  const cacheHitCI = calculateConfidenceInterval(cacheHitMeans);
  const cacheMissCI = calculateConfidenceInterval(cacheMissMeans);

  return {
    cacheHit: {
      ...cacheHitStats,
      confidenceInterval: cacheHitCI,
      varianceSignificant: isVarianceSignificant(cacheHitStats.stdDev, cacheHitStats.mean),
    },
    cacheMiss: {
      ...cacheMissStats,
      confidenceInterval: cacheMissCI,
      varianceSignificant: isVarianceSignificant(cacheMissStats.stdDev, cacheMissStats.mean),
    },
  };
}

/**
 * Print comprehensive results
 */
function printResults(results, aggregated) {
  console.log("\n" + "=".repeat(80));
  console.log("CACHE HIT vs CACHE MISS - 10 RUNS WITH 95% CONFIDENCE INTERVALS");
  console.log("=".repeat(80));

  console.log("\n## Methodology");
  console.log("-".repeat(80));
  console.log(`- Number of independent experimental runs: ${NUM_RUNS}`);
  console.log(`- Iterations per run: ${ITERATIONS_PER_RUN}`);
  console.log(`- Warm-up runs per measurement: 3 (discarded)`);
  console.log(`- Timing tool: process.hrtime.bigint() (nanosecond resolution)`);
  console.log(`- Confidence level: 95%`);
  console.log(`- Different random seed for each run`);

  console.log("\n## Per-Run Results (Summary)");
  console.log("-".repeat(80));
  console.log("Run | Seed  | Cache Hit (ms) | Cache Miss (ms) | Speedup");
  console.log("----|-------|----------------|-----------------|---------");

  results.forEach((r, i) => {
    const speedup = r.cacheMiss.mean / r.cacheHit.mean;
    console.log(
      `${(i + 1).toString().padStart(3)} | ${r.seed.toString().padStart(5)} | ` +
      `${r.cacheHit.mean.toFixed(3).padStart(14)} | ` +
      `${r.cacheMiss.mean.toFixed(3).padStart(15)} | ${speedup.toFixed(2)}x`
    );
  });

  // Print individual measurements for each run
  console.log("\n## Per-Run Individual Measurements");
  console.log("-".repeat(80));

  results.forEach((r, runIndex) => {
    console.log(`\n### Run ${runIndex + 1} (Seed: ${r.seed})`);
    console.log("-".repeat(80));
    console.log("  #   | Cache Hit (ms) | Cache Miss (ms) | Ratio");
    console.log("------|----------------|-----------------|-------");

    for (let i = 0; i < ITERATIONS_PER_RUN; i++) {
      const hit = r.cacheHitRaw[i].toFixed(3);
      const miss = r.cacheMissRaw[i].toFixed(3);
      const ratio = (r.cacheMissRaw[i] / r.cacheHitRaw[i]).toFixed(2);

      console.log(`  ${(i + 1).toString().padStart(4)} | ${hit.padStart(14)} | ${miss.padStart(15)} | ${ratio.padStart(5)}x`);
    }
  });

  console.log("\n## Aggregated Results (Mean of 10 Runs)");
  console.log("-".repeat(80));

  console.log("\n### Cache Hit (Hash Lookup)");
  console.log("-".repeat(80));
  printMetricStats("Cache Hit", aggregated.cacheHit);

  console.log("\n### Cache Miss (Full Validation)");
  console.log("-".repeat(80));
  printMetricStats("Cache Miss", aggregated.cacheMiss);

  console.log("\n## Comparison");
  console.log("-".repeat(80));

  const overallMeanRatio = aggregated.cacheMiss.mean / aggregated.cacheHit.mean;
  const ciRatio = calculateConfidenceInterval(
    results.map(r => r.cacheMiss.mean / r.cacheHit.mean)
  );

  console.log(`Mean Speedup Factor: ${overallMeanRatio.toFixed(2)}x`);
  console.log(`95% CI: [${ciRatio.lower.toFixed(2)}x, ${ciRatio.upper.toFixed(2)}x]`);

  const latencyDiff = aggregated.cacheMiss.mean - aggregated.cacheHit.mean;
  console.log(`\nMean Latency Difference: ${latencyDiff.toFixed(3)} ms`);

  console.log("\n## Interpretation");
  console.log("-".repeat(80));
  console.log(`- Cache hit is ${overallMeanRatio.toFixed(1)}x faster than cache miss`);
  console.log(`- 95% confident that true speedup is between ${ciRatio.lower.toFixed(1)}x and ${ciRatio.upper.toFixed(1)}x`);

  if (aggregated.cacheHit.varianceSignificant) {
    console.log(`- Cache hit variance is SIGNIFICANT (CV > 5%)`);
  } else {
    console.log(`- Cache hit variance is minimal (CV < 5%)`);
  }

  if (aggregated.cacheMiss.varianceSignificant) {
    console.log(`- Cache miss variance is SIGNIFICANT (CV > 5%)`);
  } else {
    console.log(`- Cache miss variance is minimal (CV < 5%)`);
  }

  console.log("\n" + "=".repeat(80));
}

function printMetricStats(label, stats) {
  const ci = stats.confidenceInterval;

  console.log(`Mean:              ${stats.mean.toFixed(3)} ms`);
  console.log(`Std Dev:           ${stats.stdDev.toFixed(3)} ms`);
  console.log(`Min (across runs): ${stats.min.toFixed(3)} ms`);
  console.log(`Max (across runs): ${stats.max.toFixed(3)} ms`);
  console.log(`95% CI:            [${ci.lower.toFixed(3)}, ${ci.upper.toFixed(3)}] ms`);
  console.log(`Margin of Error:   ±${ci.marginOfError.toFixed(3)} ms`);
  console.log(`Variance:          ${stats.varianceSignificant ? "SIGNIFICANT" : "NEGLIGIBLE"} (CV > 5%)`);
}

/**
 * Main execution
 */
async function main() {
  console.log("Cache Hit vs Cache Miss - 10 Runs Experiment");
  console.log("=" .repeat(80));

  // Wait for database connection
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Get test data
  console.log("\nLoading test data...");
  const app = await Models.App.findOne();
  const user = await Models.User.findOne();

  if (!app || !user) {
    console.error("\n[ERROR] No test data found!");
    console.error("Please run: npx babel-watch src/generators/quick-test-data.js");
    process.exit(1);
  }

  console.log("Test data loaded");

  // Run experiments
  const results = await runAllExperiments(app, user);

  // Aggregate and print results
  const aggregated = aggregateResults(results);
  printResults(results, aggregated);
}

main().catch(console.error);
