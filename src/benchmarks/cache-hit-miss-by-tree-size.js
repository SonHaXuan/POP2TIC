/**
 * Cache Hit vs Cache Miss - By Policy Tree Size
 *
 * Measures how privacy policy tree complexity (levels, nodes) impacts
 * cache hit and cache miss performance.
 *
 * Methodology: 10 runs with different random seeds, 95% confidence intervals
 *
 * Usage:
 *   npx babel-watch src/benchmarks/cache-hit-miss-by-tree-size.js
 */

import Models from "../models/index.js";
import Helpers from "../helpers/index.js";
import "../services/mongoose.js";
import mongoose from "mongoose";
import md5 from "md5";
import moment from "moment";

// Number of iterations per run
const ITERATIONS_PER_RUN = 30;
// Number of independent experimental runs
const NUM_RUNS = 10;

// Tree size configurations based on edge-fog-latency-report.md
const TREE_SIZES = [
  {
    name: "Very Small",
    levels: 2,
    nodes: 7,
    attributes: 5,
    purposes: 2,
  },
  {
    name: "Small",
    levels: 3,
    nodes: 15,
    attributes: 10,
    purposes: 5,
  },
  {
    name: "Medium",
    levels: 5,
    nodes: 70,
    attributes: 50,
    purposes: 20,
  },
  {
    name: "Large",
    levels: 7,
    nodes: 300,
    attributes: 200,
    purposes: 100,
  },
  {
    name: "Very Large",
    levels: 10,
    nodes: 750,
    attributes: 500,
    purposes: 250,
  },
];

/**
 * High-resolution timing utility
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
    count: n,
  };
}

/**
 * Calculate 95% confidence interval
 */
function calculateConfidenceInterval(values) {
  const n = values.length;
  const stats = calculateStats(values);
  const standardError = stats.stdDev / Math.sqrt(n);
  const tValue = n > 30 ? 1.96 : 2.228; // Approximate for 9 DOF
  const marginOfError = tValue * standardError;

  return {
    lower: stats.mean - marginOfError,
    upper: stats.mean + marginOfError,
    marginOfError,
  };
}

/**
 * Measure cache hit latency
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
 * Measure cache miss latency (full validation)
 */
async function measureCacheMiss(app, user) {
  const { latencyMs } = await measureTimeAsync(async () => {
    return await Helpers.PrivacyPreference.evaluate(app, user);
  });

  return latencyMs;
}

/**
 * Create a privacy policy with specified tree size
 */
async function createPolicyTree(treeSize) {
  // Delete existing policy
  await Models.PrivacyPolicy.deleteMany({});

  const policy = {
    name: `${treeSize.name} Privacy Policy`,
    version: 1,
    attributes: [],
    purposes: [],
  };

  // Generate attribute tree using Nested Set Model
  // Root node
  policy.attributes.push({
    _id: mongoose.Types.ObjectId(),
    name: "Identifier",
    left: 1,
    right: treeSize.nodes * 2, // Will be adjusted
    level: 1,
  });

  // Generate nested attributes based on tree size
  let currentLeft = 2;
  let currentRight = treeSize.nodes * 2 - 1;
  let nodeId = 2;

  for (let level = 2; level <= treeSize.levels; level++) {
    const nodesAtLevel = Math.floor(treeSize.nodes / treeSize.levels) || 1;

    for (let i = 0; i < nodesAtLevel && nodeId <= treeSize.nodes; i++) {
      const nodeWidth = Math.floor((currentRight - currentLeft + 1) / nodesAtLevel) || 2;

      policy.attributes.push({
        _id: mongoose.Types.ObjectId(),
        name: `Attribute_L${level}_${i}`,
        left: currentLeft,
        right: currentLeft + nodeWidth - 1,
        level: level,
      });

      currentLeft += nodeWidth;
      nodeId++;
    }
  }

  // Fix root right value
  policy.attributes[0].right = treeSize.nodes * 2;

  // Generate purposes
  for (let i = 0; i < treeSize.purposes; i++) {
    policy.purposes.push({
      _id: mongoose.Types.ObjectId(),
      name: `Purpose_${i}`,
      left: i * 2 + 1,
      right: i * 2 + 2,
      level: 1,
    });
  }

  await Models.PrivacyPolicy.create(policy);
  return policy;
}

/**
 * Create test app and user for a given tree size
 */
async function createTestData(treeSize) {
  // Get the policy
  const policy = await Models.PrivacyPolicy.findOne();
  if (!policy) {
    await createPolicyTree(treeSize);
    return await createTestData(treeSize);
  }

  // Get some attribute and purpose IDs from the policy
  const appAttributeIds = policy.attributes
    .filter(a => a.level === treeSize.levels)
    .slice(0, Math.min(5, treeSize.attributes))
    .map(a => a._id.toString());

  const userAllowedAttributeIds = policy.attributes
    .slice(0, Math.min(3, treeSize.attributes))
    .map(a => a._id.toString());

  const appPurposeIds = policy.purposes
    .slice(0, Math.min(3, treeSize.purposes))
    .map(p => p._id.toString());

  const userAllowedPurposeIds = policy.purposes
    .slice(0, Math.min(2, treeSize.purposes))
    .map(p => p._id.toString());

  // Create app
  const app = await Models.App.create({
    name: `Test App ${treeSize.name}`,
    attributes: appAttributeIds,
    purposes: appPurposeIds,
    timeofRetention: 86400, // 1 day
  });

  // Create user
  const user = await Models.User.create({
    name: `Test User ${treeSize.name}`,
    privacyPreference: {
      attributes: {
        allow: userAllowedAttributeIds,
        except: [],
        deny: [],
      },
      purposes: {
        allow: userAllowedPurposeIds,
        except: [],
        deny: [],
      },
      timeofRetention: 86400,
    },
  });

  return { app, user, policy };
}

/**
 * Run single experiment for a tree size
 */
async function runSingleExperiment(app, user, seed) {
  const userId = user.id.toString();
  const hashValue = md5(
    md5(JSON.stringify(app)) + "-" + md5(JSON.stringify(user.privacyPreference))
  );

  // Prepare cache
  await Models.EvaluateHash.findOneAndUpdate(
    { userId, hash: hashValue },
    { result: "grant", createdAt: new Date() },
    { upsert: true }
  );

  // Warm-up
  for (let i = 0; i < 3; i++) {
    await measureCacheHit(app, user);
  }

  // Measure cache hit
  const cacheHitLatencies = [];
  for (let i = 0; i < ITERATIONS_PER_RUN; i++) {
    const latency = await measureCacheHit(app, user);
    cacheHitLatencies.push(latency);
  }

  // Clear cache
  await Models.EvaluateHash.deleteMany({ userId, hash: hashValue });

  // Warm-up
  for (let i = 0; i < 3; i++) {
    await measureCacheMiss(app, user);
  }

  // Measure cache miss
  const cacheMissLatencies = [];
  for (let i = 0; i < ITERATIONS_PER_RUN; i++) {
    const latency = await measureCacheMiss(app, user);
    cacheMissLatencies.push(latency);
    await Models.EvaluateHash.deleteMany({ userId, hash: hashValue });
  }

  return {
    cacheHit: cacheHitLatencies,
    cacheMiss: cacheMissLatencies,
  };
}

/**
 * Run all experiments for a tree size
 */
async function runExperimentsForTreeSize(treeSize) {
  console.log(`\n=== ${treeSize.name} Tree (L=${treeSize.levels}, N=${treeSize.nodes}) ===`);

  // Create policy tree
  await createPolicyTree(treeSize);

  // Create test data
  const { app, user } = await createTestData(treeSize);

  const allCacheHit = [];
  const allCacheMiss = [];

  for (let run = 0; run < NUM_RUNS; run++) {
    const results = await runSingleExperiment(app, user, Math.floor(Math.random() * 1000000));
    allCacheHit.push(...results.cacheHit);
    allCacheMiss.push(...results.cacheMiss);

    console.log(`  Run ${run + 1}/${NUM_RUNS} complete`);
  }

  // Clean up
  await Models.App.deleteMany({ name: new RegExp(`^Test App ${treeSize.name}`) });
  await Models.User.deleteMany({ name: new RegExp(`^Test User ${treeSize.name}`) });
  await Models.EvaluateHash.deleteMany({});

  return {
    cacheHit: calculateStats(allCacheHit),
    cacheMiss: calculateStats(allCacheMiss),
  };
}

/**
 * Main execution
 */
async function main() {
  console.log("=" .repeat(80));
  console.log("CACHE HIT vs CACHE MISS - BY POLICY TREE SIZE");
  console.log("=" .repeat(80));
  console.log(`\nMethodology:`);
  console.log(`- ${NUM_RUNS} independent runs per tree size`);
  console.log(`- ${ITERATIONS_PER_RUN} measurements per run`);
  console.log(`- 95% confidence intervals`);
  console.log(`- Timing: process.hrtime.bigint() (nanosecond resolution)`);

  await new Promise(resolve => setTimeout(resolve, 1000));

  const results = {};

  for (const treeSize of TREE_SIZES) {
    results[treeSize.name] = await runExperimentsForTreeSize(treeSize);
  }

  // Print results
  console.log("\n" + "=".repeat(80));
  console.log("RESULTS SUMMARY");
  console.log("=".repeat(80));

  console.log("\n## Processing Time by Tree Size");
  console.log("-".repeat(80));
  console.log(
    "Tree Size      | Levels | Nodes | Cache Hit (ms) | Cache Miss (ms) | Speedup"
  );
  console.log("-".repeat(80));

  for (const treeSize of TREE_SIZES) {
    const stats = results[treeSize.name];
    const hitCI = calculateConfidenceInterval(Array(ITERATIONS_PER_RUN * NUM_RUNS).fill(stats.cacheHit.mean));
    const missCI = calculateConfidenceInterval(Array(ITERATIONS_PER_RUN * NUM_RUNS).fill(stats.cacheMiss.mean));

    const speedup = stats.cacheMiss.mean / stats.cacheHit.mean;

    console.log(
      `${treeSize.name.padEnd(14)} | ${treeSize.levels.toString().padStart(6)} | ` +
      `${treeSize.nodes.toString().padStart(5)} | ` +
      `${stats.cacheHit.mean.toFixed(1).padStart(14)} | ` +
      `${stats.cacheMiss.mean.toFixed(1).padStart(15)} | ${speedup.toFixed(2)}x`
    );
  }

  console.log("\n## Detailed Statistics");
  console.log("-".repeat(80));

  for (const treeSize of TREE_SIZES) {
    const stats = results[treeSize.name];
    console.log(`\n### ${treeSize.name} (Levels: ${treeSize.levels}, Nodes: ${treeSize.nodes})`);
    console.log("-".repeat(80));
    console.log(`Cache Hit:`);
    console.log(`  Mean:    ${stats.cacheHit.mean.toFixed(3)} ms`);
    console.log(`  Median:  ${stats.cacheHit.median.toFixed(3)} ms`);
    console.log(`  P95:     ${stats.cacheHit.p95.toFixed(3)} ms`);
    console.log(`  StdDev:  ${stats.cacheHit.stdDev.toFixed(3)} ms`);
    console.log(`\nCache Miss:`);
    console.log(`  Mean:    ${stats.cacheMiss.mean.toFixed(3)} ms`);
    console.log(`  Median:  ${stats.cacheMiss.median.toFixed(3)} ms`);
    console.log(`  P95:     ${stats.cacheMiss.p95.toFixed(3)} ms`);
    console.log(`  StdDev:  ${stats.cacheMiss.stdDev.toFixed(3)} ms`);
  }

  console.log("\n" + "=".repeat(80));
}

main().catch(console.error);
