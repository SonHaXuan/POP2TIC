/**
 * RESTful API Server for Privacy Compliance Evaluation
 * Provides HTTP endpoints for privacy evaluation, preference management, and benchmarking
 *
 * SGX Support: Can use Intel SGX enclave for secure privacy evaluation
 * Set SGX_ENABLED=true in .env to enable
 */

import dotenv from "dotenv";
dotenv.config();
import express from "express";
import cors from "cors";
import "../services/mongoose.js";
import Models from "../models/index.js";
import Helpers from "../helpers/index.js";
import md5 from "md5";
import moment from "moment";

const app = express();
const PORT = process.env.PORT || 3000;
const SERVICE_ID = process.env.SERVICE_ID || "default";

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`[${SERVICE_ID}] ${req.method} ${req.path}`);
  next();
});

/**
 * Health check endpoint
 */
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "healthy",
    service: SERVICE_ID,
    timestamp: new Date().toISOString(),
  });
});

/**
 * API Info endpoint
 */
app.get("/", (req, res) => {
  res.json({
    name: "Privacy Compliance Evaluation API",
    version: "1.0.0",
    service: SERVICE_ID,
    endpoints: {
      health: "GET /health",
      evaluate: "POST /api/evaluate",
      users: "GET /api/users",
      createUser: "POST /api/users",
      updatePreferences: "PUT /api/users/:userId/preferences",
      apps: "GET /api/apps",
      createApp: "POST /api/apps",
      getPolicy: "GET /api/policy",
      updatePolicy: "PUT /api/policy",
      cacheStats: "GET /api/cache/stats",
      clearCache: "DELETE /api/cache",
    },
  });
});

/**
 * POST /api/evaluate
 * Evaluate privacy compliance between app and user
 */
app.post("/api/evaluate", async (req, res) => {
  try {
    const { appId, userId } = req.body;

    if (!appId || !userId) {
      return res.status(400).json({
        error: "Missing required fields: appId, userId",
      });
    }

    const app = await Models.App.findById(appId);
    const user = await Models.User.findById(userId);

    if (!app) {
      return res.status(404).json({ error: "App not found" });
    }

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const startTime = process.hrtime.bigint();

    // Get policy for cache key (must fetch before cache check for version)
    const policy = await Models.PrivacyPolicy.findOne();
    if (!policy) {
      return res.status(404).json({
        error: "Privacy policy not found. Initialize database first.",
      });
    }

    // Check cache - policy version included to invalidate on policy updates
    const hashValue = md5(
      md5(JSON.stringify(app)) +
        "-" +
        md5(JSON.stringify(user.privacyPreference)) +
        "-" +
        md5(policy.version)
    );

    const cachedResult = await Models.EvaluateHash.findOne({
      userId: user.id.toString(),
      hash: hashValue,
      createdAt: {
        $gte: moment()
          .utc()
          .subtract(Number(user.privacyPreference.timeofRetention), "second"),
      },
    });

    let result;
    let cacheHit = false;
    let usingSGX = false;

    if (cachedResult) {
      result = cachedResult.result;
      cacheHit = true;
    } else {
      // Use SGX enclave if enabled, otherwise fall back to JavaScript
      if (process.env.SGX_ENABLED === "true") {
        try {
          const sgxModule = await import("../sgx/index.js");
          const sgxEvaluator = sgxModule.default;
          const isSGXAvailable = sgxModule.isSGXAvailable();

          if (isSGXAvailable) {
            const isAccepted = await sgxEvaluator.evaluate(app, user, policy);
            result = isAccepted ? "grant" : "deny";
            usingSGX = true;
            console.log(`[${SERVICE_ID}] Evaluation performed in SGX enclave`);
          } else {
            throw new Error("SGX not initialized");
          }
        } catch (sgxError) {
          console.warn(`[${SERVICE_ID}] SGX evaluation failed, falling back to JS:`, sgxError.message);
          const isAccepted = await Helpers.PrivacyPreference.evaluate(app, user);
          result = isAccepted ? "grant" : "deny";
        }
      } else {
        const isAccepted = await Helpers.PrivacyPreference.evaluate(app, user);
        result = isAccepted ? "grant" : "deny";
      }

      // Store in cache
      await Models.EvaluateHash.create({
        userId: user.id.toString(),
        hash: hashValue,
        result,
      });
    }

    const endTime = process.hrtime.bigint();
    const latencyMs = Number(endTime - startTime) / 1_000_000;

    res.json({
      result,
      latencyMs: latencyMs.toFixed(3),
      cacheHit,
      usingSGX,
      service: SERVICE_ID,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Evaluation error:", error);
    res.status(500).json({
      error: "Evaluation failed",
      message: error.message,
    });
  }
});

/**
 * GET /api/users
 * List all users
 */
app.get("/api/users", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const skip = parseInt(req.query.skip) || 0;

    const users = await Models.User.find().limit(limit).skip(skip);
    const total = await Models.User.countDocuments();

    res.json({
      users,
      total,
      limit,
      skip,
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to fetch users",
      message: error.message,
    });
  }
});

/**
 * GET /api/users/:userId
 * Get specific user
 */
app.get("/api/users/:userId", async (req, res) => {
  try {
    const user = await Models.User.findById(req.params.userId);

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json(user);
  } catch (error) {
    res.status(500).json({
      error: "Failed to fetch user",
      message: error.message,
    });
  }
});

/**
 * POST /api/users
 * Create new user with privacy preferences
 */
app.post("/api/users", async (req, res) => {
  try {
    const { fullName, privacyPreference } = req.body;

    if (!privacyPreference) {
      return res.status(400).json({
        error: "Missing required field: privacyPreference",
      });
    }

    const user = await Models.User.create({
      fullName,
      privacyPreference,
    });

    res.status(201).json(user);
  } catch (error) {
    res.status(500).json({
      error: "Failed to create user",
      message: error.message,
    });
  }
});

/**
 * PUT /api/users/:userId/preferences
 * Update user privacy preferences
 */
app.put("/api/users/:userId/preferences", async (req, res) => {
  try {
    const { privacyPreference } = req.body;

    if (!privacyPreference) {
      return res.status(400).json({
        error: "Missing required field: privacyPreference",
      });
    }

    const user = await Models.User.findByIdAndUpdate(
      req.params.userId,
      { privacyPreference },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Invalidate cache for this user
    await Models.EvaluateHash.deleteMany({ userId: user.id.toString() });

    res.json(user);
  } catch (error) {
    res.status(500).json({
      error: "Failed to update preferences",
      message: error.message,
    });
  }
});

/**
 * GET /api/apps
 * List all apps
 */
app.get("/api/apps", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const skip = parseInt(req.query.skip) || 0;

    const apps = await Models.App.find().limit(limit).skip(skip);
    const total = await Models.App.countDocuments();

    res.json({
      apps,
      total,
      limit,
      skip,
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to fetch apps",
      message: error.message,
    });
  }
});

/**
 * GET /api/apps/:appId
 * Get specific app
 */
app.get("/api/apps/:appId", async (req, res) => {
  try {
    const app = await Models.App.findById(req.params.appId);

    if (!app) {
      return res.status(404).json({ error: "App not found" });
    }

    res.json(app);
  } catch (error) {
    res.status(500).json({
      error: "Failed to fetch app",
      message: error.message,
    });
  }
});

/**
 * POST /api/apps
 * Create new app
 */
app.post("/api/apps", async (req, res) => {
  try {
    const { name, attributes, purposes, timeofRetention } = req.body;

    if (!name || !attributes || !purposes) {
      return res.status(400).json({
        error: "Missing required fields: name, attributes, purposes",
      });
    }

    const app = await Models.App.create({
      name,
      attributes,
      purposes,
      timeofRetention,
    });

    res.status(201).json(app);
  } catch (error) {
    res.status(500).json({
      error: "Failed to create app",
      message: error.message,
    });
  }
});

/**
 * GET /api/policy
 * Get privacy policy (attributes and purposes hierarchy)
 */
app.get("/api/policy", async (req, res) => {
  try {
    const policy = await Models.PrivacyPolicy.findOne();

    if (!policy) {
      return res.status(404).json({
        error: "Privacy policy not found. Initialize database first.",
      });
    }

    res.json(policy);
  } catch (error) {
    res.status(500).json({
      error: "Failed to fetch policy",
      message: error.message,
    });
  }
});

/**
 * PUT /api/policy
 * Update privacy policy and increment version (invalidates all cache entries)
 */
app.put("/api/policy", async (req, res) => {
  try {
    const { attributes, purposes } = req.body;

    if (!attributes || !purposes) {
      return res.status(400).json({
        error: "Missing required fields: attributes, purposes",
      });
    }

    // Find existing policy or create new one
    let policy = await Models.PrivacyPolicy.findOne();

    if (policy) {
      // Update existing policy with new version (invalidates cache)
      policy = await Models.PrivacyPolicy.findOneAndUpdate(
        {},
        {
          attributes,
          purposes,
          version: Date.now().toString(),
        },
        { new: true }
      );
    } else {
      // Create new policy
      policy = await Models.PrivacyPolicy.create({
        attributes,
        purposes,
        version: Date.now().toString(),
      });
    }

    res.json({
      message: "Privacy policy updated successfully",
      policy,
      note: "Cache invalidated due to policy version change",
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to update policy",
      message: error.message,
    });
  }
});

/**
 * GET /api/cache/stats
 * Get cache statistics
 */
app.get("/api/cache/stats", async (req, res) => {
  try {
    const totalEntries = await Models.EvaluateHash.countDocuments();
    const grantCount = await Models.EvaluateHash.countDocuments({ result: "grant" });
    const denyCount = await Models.EvaluateHash.countDocuments({ result: "deny" });

    // Get cache age distribution
    const now = moment().utc();
    const last1Hour = await Models.EvaluateHash.countDocuments({
      createdAt: { $gte: now.clone().subtract(1, "hour") },
    });
    const last24Hours = await Models.EvaluateHash.countDocuments({
      createdAt: { $gte: now.clone().subtract(24, "hours") },
    });

    res.json({
      totalEntries,
      grantCount,
      denyCount,
      cacheAgeDistribution: {
        last1Hour,
        last24Hours,
      },
      service: SERVICE_ID,
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to fetch cache stats",
      message: error.message,
    });
  }
});

/**
 * DELETE /api/cache
 * Clear cache (for testing/benchmarking)
 */
app.delete("/api/cache", async (req, res) => {
  try {
    const result = await Models.EvaluateHash.deleteMany({});

    res.json({
      message: "Cache cleared successfully",
      deletedCount: result.deletedCount,
      service: SERVICE_ID,
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to clear cache",
      message: error.message,
    });
  }
});

/**
 * 404 handler
 */
app.use((req, res) => {
  res.status(404).json({
    error: "Endpoint not found",
    path: req.path,
  });
});

/**
 * Error handler
 */
app.use((err, req, res, next) => {
  console.error("Server error:", err);
  res.status(500).json({
    error: "Internal server error",
    message: err.message,
  });
});

/**
 * Start server
 */
app.listen(PORT, () => {
  console.log(`\n=== Privacy Compliance API Server ===`);
  console.log(`Service ID: ${SERVICE_ID}`);
  console.log(`Server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`API docs: http://localhost:${PORT}/`);
  console.log(`=====================================\n`);
});

export default app;