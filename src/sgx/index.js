/**
 * SGX Privacy Evaluator - Node.js Wrapper
 *
 * Provides a JavaScript interface to the SGX enclave for secure
 * privacy compliance evaluation.
 */

import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let addon = null;
let enclaveInitialized = false;

/**
 * SGX Privacy Evaluator Class
 */
class SGXPrivacyEvaluator {
  constructor() {
    this.initialized = false;
  }

  /**
   * Initialize the SGX enclave
   * Must be called before any evaluation
   */
  async initialize() {
    if (this.initialized) {
      return true;
    }

    try {
      // Try to load the native addon
      const addonPath = path.join(__dirname, "build", "Release", "sgx-addon.node");
      addon = require(addonPath);

      // Initialize enclave
      const success = addon.initializeEnclave();
      if (success) {
        this.initialized = true;
        enclaveInitialized = true;
        console.log("[SGX] Enclave initialized successfully");
        return true;
      } else {
        console.error("[SGX] Failed to initialize enclave");
        return false;
      }
    } catch (error) {
      console.error("[SGX] Failed to load native addon:", error.message);
      console.error("[SGX] Make sure to run: npm run build-sgx");
      return false;
    }
  }

  /**
   * Evaluate privacy compliance using SGX enclave
   * @param {Object} app - Application data (attributes, purposes, timeofRetention)
   * @param {Object} user - User object with privacyPreference
   * @param {Object} policy - Privacy policy with hierarchical attributes and purposes
   * @returns {Promise<boolean>} - true if granted, false if denied
   */
  async evaluate(app, user, policy) {
    if (!this.initialized) {
      const initialized = await this.initialize();
      if (!initialized) {
        throw new Error("SGX enclave not initialized");
      }
    }

    if (!addon) {
      throw new Error("Native addon not loaded");
    }

    try {
      // 1. Serialize objects to JSON strings
      const appJson = JSON.stringify(app);
      const userJson = JSON.stringify(user.privacyPreference);
      const policyJson = JSON.stringify(policy);

      // 2. Call into enclave via native addon
      const result = addon.evaluatePrivacy(appJson, userJson, policyJson);

      if (!result.success) {
        throw new Error(`Enclave evaluation failed with code: ${result.code}`);
      }

      // 3. Return result as boolean
      return result.result === "grant";
    } catch (error) {
      console.error("[SGX] Evaluation error:", error.message);
      throw error;
    }
  }

  /**
   * Destroy the SGX enclave and free resources
   */
  destroy() {
    if (addon && this.initialized) {
      addon.destroyEnclave();
      this.initialized = false;
      enclaveInitialized = false;
      console.log("[SGX] Enclave destroyed");
    }
  }
}

/**
 * Create singleton instance
 */
const sgxEvaluator = new SGXPrivacyEvaluator();

/**
 * Auto-initialize if SGX is enabled
 */
async function autoInit() {
  const sgxEnabled = process.env.SGX_ENABLED === "true";
  if (sgxEnabled && !enclaveInitialized) {
    await sgxEvaluator.initialize();
  }
}

// Auto-initialize on module load
autoInit().catch((err) => {
  console.warn("[SGX] Auto-initialization failed:", err.message);
});

/**
 * Check if SGX is available and initialized
 */
export function isSGXAvailable() {
  return enclaveInitialized && sgxEvaluator.initialized;
}

/**
 * Get the SGX evaluator instance
 */
export default sgxEvaluator;

/**
 * Export for direct use
 */
export { SGXPrivacyEvaluator };
