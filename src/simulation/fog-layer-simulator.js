/**
 * Fog Layer Simulator
 * Simulates IoT → Edge → Fog → Cloud hierarchical architecture
 * with realistic network latency modeling
 *
 * SGX Support: Fog nodes can use SGX enclave for local privacy evaluation
 */

import axios from "axios";
import NetworkLatency from "./network-latency-simulator.js";

// SGX Evaluator (optional, loaded dynamically)
let sgxEvaluator = null;
let sgxAvailable = false;

async function initSGX() {
  if (process.env.SGX_ENABLED === "true") {
    try {
      const sgxModule = await import("../sgx/index.js");
      sgxEvaluator = sgxModule.default;
      sgxAvailable = sgxModule.isSGXAvailable();
      if (sgxAvailable) {
        console.log("[FogSimulator] SGX enclave support loaded for fog nodes");
      }
    } catch (error) {
      console.warn("[FogSimulator] SGX support unavailable:", error.message);
    }
  }
}

// Auto-initialize SGX on module load
initSGX().catch(() => {});

/**
 * IoT Device Layer
 * Represents smart devices, sensors, wearables
 * with realistic hardware constraints
 */
class IoTDevice {
  constructor(deviceId, type = "sensor") {
    this.deviceId = deviceId;
    this.type = type;
    this.edgeNodeUrl = null;

    // Hardware specifications based on device type
    this.hardware = this.getHardwareSpec(type);

    // Current resource usage
    this.currentCpu = 0;        // Current CPU usage (%)
    this.currentMemory = 0;     // Current memory usage (MB)
    this.batteryLevel = 100;    // Battery level (%)
    this.requestCount = 0;      // Total requests sent
  }

  /**
   * Get hardware specifications based on device type
   */
  getHardwareSpec(type) {
    const specs = {
      sensor: {
        cpu: { cores: 1, mhz: 240 },           // ESP32-like
        memory: { ram: 0.5, storage: 4 },      // 512KB RAM, 4MB Flash
        power: { battery: 2000, idle: 0.5, active: 150 },  // mAh, mW
        network: "WiFi 2.4GHz",
        maxRequestsPerSec: 10
      },
      camera: {
        cpu: { cores: 2, mhz: 1200 },          // Raspberry Pi Zero-like
        memory: { ram: 512, storage: 8000 },   // 512MB RAM, 8GB storage
        power: { battery: 5000, idle: 100, active: 500 },
        network: "WiFi 5GHz",
        maxRequestsPerSec: 5
      },
      wearable: {
        cpu: { cores: 1, mhz: 120 },           // Ultra low-power MCU
        memory: { ram: 0.256, storage: 1 },    // 256KB RAM, 1MB Flash
        power: { battery: 300, idle: 0.1, active: 50 },
        network: "Bluetooth LE",
        maxRequestsPerSec: 2
      },
      "smart-home": {
        cpu: { cores: 1, mhz: 160 },           // ESP8266-like
        memory: { ram: 0.08, storage: 1 },     // 80KB RAM, 1MB Flash
        power: { battery: 1000, idle: 0.8, active: 80 },
        network: "Zigbee",
        maxRequestsPerSec: 5
      }
    };
    return specs[type] || specs.sensor;
  }

  /**
   * Connect to an Edge Node
   */
  connectToEdge(edgeNodeUrl) {
    this.edgeNodeUrl = edgeNodeUrl;
  }

  /**
   * Send privacy evaluation request through fog hierarchy
   * with hardware constraint checks
   */
  async sendRequest(appId, userId) {
    if (!this.edgeNodeUrl) {
      throw new Error("IoT device not connected to edge node");
    }

    // Check hardware constraints
    if (this.batteryLevel < 5) {
      throw new Error(`${this.deviceId}: Battery critically low (${this.batteryLevel}%)`);
    }

    if (this.currentMemory > this.hardware.memory.ram * 0.9) {
      throw new Error(`${this.deviceId}: Memory exhausted (${this.currentMemory.toFixed(2)}/${this.hardware.memory.ram} MB)`);
    }

    const startTime = process.hrtime.bigint();

    // Simulate resource consumption
    this.currentCpu = Math.min(100, 20 + Math.random() * 30);  // 20-50% CPU usage
    this.currentMemory = Math.min(
      this.hardware.memory.ram,
      0.05 + Math.random() * 0.1  // 50-150KB for request
    );

    // Battery drain (active power consumption)
    const requestDurationSec = 0.01; // ~10ms request
    const powerConsumption = this.hardware.power.active * requestDurationSec / 3600; // mWh
    const batteryDrain = (powerConsumption / this.hardware.power.battery) * 100;
    this.batteryLevel = Math.max(0, this.batteryLevel - batteryDrain);

    this.requestCount++;

    // Step 1: IoT → Edge (simulated network delay)
    const iotEdgeLatency = await NetworkLatency.iotToEdge();

    // Step 2: Forward to Edge Node
    const edgeResponse = await axios.post(
      `${this.edgeNodeUrl}/edge/evaluate`,
      {
        appId,
        userId,
        deviceId: this.deviceId,
      }
    );

    // Release resources after request
    this.currentCpu = 0;
    this.currentMemory = 0;

    const endTime = process.hrtime.bigint();
    const totalLatency = Number(endTime - startTime) / 1_000_000;

    return {
      ...edgeResponse.data,
      iotEdgeLatency: parseFloat(iotEdgeLatency.toFixed(3)),
      totalLatency: parseFloat(totalLatency.toFixed(3)),
      deviceId: this.deviceId,
      deviceHardware: {
        batteryLevel: parseFloat(this.batteryLevel.toFixed(2)),
        requestCount: this.requestCount
      }
    };
  }

  /**
   * Get device statistics
   */
  getStats() {
    return {
      deviceId: this.deviceId,
      type: this.type,
      hardware: this.hardware,
      currentState: {
        batteryLevel: parseFloat(this.batteryLevel.toFixed(2)),
        currentCpu: this.currentCpu,
        currentMemory: this.currentMemory,
        requestCount: this.requestCount
      },
      estimatedBatteryLife: this.estimateBatteryLife()
    };
  }

  /**
   * Estimate remaining battery life in hours
   */
  estimateBatteryLife() {
    if (this.requestCount === 0) return Infinity;

    const avgPowerPerRequest = this.hardware.power.active * 0.01 / 3600; // mWh per request
    const remainingCapacity = (this.batteryLevel / 100) * this.hardware.power.battery;
    const estimatedRemainingRequests = remainingCapacity / avgPowerPerRequest;

    // Assume 1 request per minute
    const hoursRemaining = estimatedRemainingRequests / 60;
    return parseFloat(hoursRemaining.toFixed(2));
  }

  /**
   * Recharge battery to full
   */
  recharge() {
    this.batteryLevel = 100;
    console.log(`${this.deviceId}: Battery recharged to 100%`);
  }
}

/**
 * Edge Node Layer
 * Lightweight processing at the network edge (gateway, router)
 */
class EdgeNode {
  constructor(nodeId, fogNodeUrl) {
    this.nodeId = nodeId;
    this.fogNodeUrl = fogNodeUrl;
    this.localCache = new Map();
  }

  /**
   * Process request from IoT device
   * Forward to Fog layer with simulated latency
   */
  async processRequest(appId, userId, deviceId) {
    const startTime = process.hrtime.bigint();

    // Check local cache (edge caching for ultra-low latency)
    const cacheKey = `${appId}-${userId}`;
    if (this.localCache.has(cacheKey)) {
      const cached = this.localCache.get(cacheKey);
      const endTime = process.hrtime.bigint();
      return {
        ...cached,
        edgeCacheHit: true,
        edgeLatency: Number(endTime - startTime) / 1_000_000,
      };
    }

    // Step 1: Edge → Fog (simulated network delay)
    const edgeFogLatency = await NetworkLatency.edgeToFog();

    // Step 2: Forward to Fog Node
    const fogResponse = await axios.post(`${this.fogNodeUrl}/fog/evaluate`, {
      appId,
      userId,
      deviceId,
      edgeNodeId: this.nodeId,
    });

    const endTime = process.hrtime.bigint();
    const edgeLatency = Number(endTime - startTime) / 1_000_000;

    // Cache result at edge
    this.localCache.set(cacheKey, fogResponse.data);

    return {
      ...fogResponse.data,
      edgeFogLatency: parseFloat(edgeFogLatency.toFixed(3)),
      edgeLatency: parseFloat(edgeLatency.toFixed(3)),
      edgeCacheHit: false,
      edgeNodeId: this.nodeId,
    };
  }

  clearCache() {
    this.localCache.clear();
  }
}

/**
 * Fog Node Layer
 * More powerful than edge, provides privacy evaluation
 * Coordinates with cloud for policy storage
 *
 * SGX Support: Can perform local privacy evaluation using SGX enclave
 */
class FogNode {
  constructor(nodeId, cloudUrl) {
    this.nodeId = nodeId;
    this.cloudUrl = cloudUrl;
    this.useLocalSGX = sgxAvailable; // Use SGX for local evaluation if available
  }

  /**
   * Perform local privacy evaluation using SGX enclave
   * @param {Object} app - Application data
   * @param {Object} user - User data with privacy preferences
   * @param {Object} policy - Privacy policy data
   * @returns {Promise<{result: string, usingSGX: boolean}>}
   */
  async localSGXEvaluate(app, user, policy) {
    if (!sgxEvaluator || !sgxAvailable) {
      throw new Error("SGX not available");
    }

    const isAccepted = await sgxEvaluator.evaluate(app, user, policy);
    return {
      result: isAccepted ? "grant" : "deny",
      usingSGX: true,
    };
  }

  /**
   * Process request from Edge node
   * Perform privacy evaluation with cloud database access
   *
   * @param {string} appId - Application ID
   * @param {string} userId - User ID
   * @param {string} deviceId - Device ID
   * @param {string} edgeNodeId - Edge node ID
   * @param {Object} appData - Optional app data for local SGX evaluation
   * @param {Object} userData - Optional user data for local SGX evaluation
   * @param {Object} policyData - Optional policy data for local SGX evaluation
   * @param {number} bypassFlag - Bypass flag (0=skip evaluation, 1=normal evaluation)
   *
   * If SGX is enabled and policy data is cached locally, evaluates in the enclave.
   * Otherwise, calls the cloud API (which may also use SGX).
   */
  async processRequest(appId, userId, deviceId, edgeNodeId, appData = null, userData = null, policyData = null, bypassFlag = 1) {
    const startTime = process.hrtime.bigint();

    // Bypass flag: skip evaluation entirely (for timing measurement)
    if (bypassFlag === 0) {
      const endTime = process.hrtime.bigint();
      const fogLatency = Number(endTime - startTime) / 1_000_000;
      return {
        result: "bypass",
        bypassFlag: 0,
        fogLatency: parseFloat(fogLatency.toFixed(3)),
        fogNodeId: this.nodeId,
        edgeNodeId,
        deviceId,
        bypassMode: true,
      };
    }

    // Try local SGX evaluation if enabled and data is provided
    if (this.useLocalSGX && appData && userData && policyData) {
      try {
        const evalStart = process.hrtime.bigint();
        const localResult = await this.localSGXEvaluate(appData, userData, policyData);
        const evalEnd = process.hrtime.bigint();
        const evalTime = Number(evalEnd - evalStart) / 1_000_000;

        const endTime = process.hrtime.bigint();
        const fogLatency = Number(endTime - startTime) / 1_000_000;

        return {
          result: localResult.result,
          usingSGX: localResult.usingSGX,
          fogLatency: parseFloat(fogLatency.toFixed(3)),
          fogEvaluationTime: parseFloat(evalTime.toFixed(3)),
          fogNodeId: this.nodeId,
          edgeNodeId,
          deviceId,
          localEvaluation: true,
        };
      } catch (sgxError) {
        console.warn(`[FogNode ${this.nodeId}] Local SGX evaluation failed:`, sgxError.message);
        // Fall through to cloud API call
      }
    }

    // Step 1: Fog → Cloud (simulated network delay)
    const fogCloudLatency = await NetworkLatency.fogToCloud();

    // Step 2: Call cloud privacy evaluation API
    const cloudResponse = await axios.post(`${this.cloudUrl}/api/evaluate`, {
      appId,
      userId,
    });

    const endTime = process.hrtime.bigint();
    const fogLatency = Number(endTime - startTime) / 1_000_000;

    return {
      ...cloudResponse.data,
      fogCloudLatency: parseFloat(fogCloudLatency.toFixed(3)),
      fogLatency: parseFloat(fogLatency.toFixed(3)),
      fogNodeId: this.nodeId,
      edgeNodeId,
      deviceId,
      localEvaluation: false,
    };
  }
}

/**
 * Fog Computing Simulator
 * Orchestrates IoT → Edge → Fog → Cloud hierarchy
 */
class FogComputingSimulator {
  constructor(cloudUrl, edgeServerUrl) {
    this.cloudUrl = cloudUrl;
    this.edgeServerUrl = edgeServerUrl;
    this.iotDevices = [];
    this.edgeNodes = [];
    this.fogNodes = [];
  }

  /**
   * Initialize fog computing infrastructure
   */
  async initialize(numIoTDevices = 10, numEdgeNodes = 3, numFogNodes = 2) {
    console.log("\n=== Initializing Fog Computing Simulator ===");

    // Create Fog Nodes
    for (let i = 0; i < numFogNodes; i++) {
      const fogNode = new FogNode(`fog-${i}`, this.cloudUrl);
      this.fogNodes.push(fogNode);
    }
    console.log(`✓ Created ${numFogNodes} fog nodes`);

    // Create Edge Nodes (each connects to a fog node)
    for (let i = 0; i < numEdgeNodes; i++) {
      const fogNode = this.fogNodes[i % numFogNodes];
      const edgeNode = new EdgeNode(
        `edge-${i}`,
        `${this.edgeServerUrl}?fogNodeId=${fogNode.nodeId}`
      );
      // Store fog node reference for routing
      edgeNode.fogNode = fogNode;
      this.edgeNodes.push(edgeNode);
    }
    console.log(`✓ Created ${numEdgeNodes} edge nodes`);

    // Create IoT Devices (each connects to an edge node)
    const deviceTypes = ["sensor", "camera", "wearable", "smart-home"];
    for (let i = 0; i < numIoTDevices; i++) {
      const type = deviceTypes[i % deviceTypes.length];
      const device = new IoTDevice(`iot-${type}-${i}`, type);
      const edgeNode = this.edgeNodes[i % numEdgeNodes];
      device.connectToEdge(`${this.edgeServerUrl}?edgeNodeId=${edgeNode.nodeId}`);
      // Store edge node reference for routing
      device.edgeNode = edgeNode;
      this.iotDevices.push(device);
    }
    console.log(`✓ Created ${numIoTDevices} IoT devices`);

    console.log("=== Fog Computing Simulator Ready ===\n");
  }

  /**
   * Simulate a request through the complete hierarchy
   * IoT → Edge → Fog → Cloud
   *
   * @param {number} deviceIndex - Index of IoT device
   * @param {string} appId - Application ID
   * @param {string} userId - User ID
   * @param {Object} appData - Optional app data for local SGX evaluation
   * @param {Object} userData - Optional user data for local SGX evaluation
   * @param {Object} policyData - Optional policy data for local SGX evaluation
   * @param {number} bypassFlag - Bypass flag (0=skip evaluation, 1=normal evaluation)
   * @param {boolean} forceCacheMiss - Force edge cache miss for testing
   */
  async simulateRequest(deviceIndex, appId, userId, appData = null, userData = null, policyData = null, bypassFlag = 1, forceCacheMiss = false) {
    if (deviceIndex >= this.iotDevices.length) {
      throw new Error(`Device index ${deviceIndex} out of range`);
    }

    const device = this.iotDevices[deviceIndex];
    const edgeNode = device.edgeNode;
    const fogNode = edgeNode.fogNode;

    const startTime = process.hrtime.bigint();

    // Simulate IoT → Edge latency
    const iotEdgeLatency = await NetworkLatency.iotToEdge();

    // Edge processing
    const edgeStartTime = process.hrtime.bigint();
    const edgeCacheKey = `${appId}-${userId}`;
    let edgeCacheHit = false;
    let edgeResult;

    if (edgeNode.localCache.has(edgeCacheKey) && !forceCacheMiss) {
      edgeResult = edgeNode.localCache.get(edgeCacheKey);
      edgeCacheHit = true;
    } else {
      // Simulate Edge → Fog latency
      const edgeFogLatency = await NetworkLatency.edgeToFog();

      // Fog processing - use local SGX if available and data is provided
      const fogResponse = await fogNode.processRequest(
        appId,
        userId,
        device.deviceId,
        edgeNode.nodeId,
        appData,
        userData,
        policyData,
        bypassFlag
      );

      edgeResult = {
        ...fogResponse,
        edgeFogLatency: parseFloat(edgeFogLatency.toFixed(3)),
      };

      // Cache at edge (only cache successful results)
      if (edgeResult.result) {
        edgeNode.localCache.set(edgeCacheKey, edgeResult);
      }
    }

    const edgeEndTime = process.hrtime.bigint();
    const edgeProcessingTime = Number(edgeEndTime - edgeStartTime) / 1_000_000;

    const endTime = process.hrtime.bigint();
    const totalLatency = Number(endTime - startTime) / 1_000_000;

    return {
      ...edgeResult,
      iotEdgeLatency: parseFloat(iotEdgeLatency.toFixed(3)),
      edgeProcessingTime: parseFloat(edgeProcessingTime.toFixed(3)),
      edgeCacheHit,
      totalLatency: parseFloat(totalLatency.toFixed(3)),
      deviceId: device.deviceId,
      edgeNodeId: edgeNode.nodeId,
    };
  }

  /**
   * Clear all edge caches
   */
  clearCaches() {
    this.edgeNodes.forEach((edge) => edge.clearCache());
  }

  /**
   * Get simulator statistics
   */
  getStats() {
    return {
      iotDevices: this.iotDevices.length,
      edgeNodes: this.edgeNodes.length,
      fogNodes: this.fogNodes.length,
      edgeCacheSize: this.edgeNodes.reduce(
        (sum, edge) => sum + edge.localCache.size,
        0
      ),
    };
  }
}

export default FogComputingSimulator;
export { IoTDevice, EdgeNode, FogNode };
