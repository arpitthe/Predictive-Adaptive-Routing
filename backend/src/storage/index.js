/**
 * index.js (Storage Gateway)
 *
 * Central coordinator for application storage abstraction.
 * Determines whether the backend runs against the in-memory store
 * (STORAGE_MODE=memory) or MongoDB (STORAGE_MODE=mongodb).
 */

import { memoryStore } from "./memoryStore.js";
import { seedDemoData, advanceReplayStep } from "./demoData.js";

/**
 * Returns current storage mode ("memory" or "mongodb").
 * Defaults to "memory" if STORAGE_MODE is explicitly set to "memory",
 * otherwise "mongodb".
 *
 * @returns {"memory"|"mongodb"}
 */
export const getStorageMode = () => {
  return process.env.STORAGE_MODE === "memory" ? "memory" : "mongodb";
};

/**
 * Check if the application is currently running in in-memory mode.
 *
 * @returns {boolean}
 */
export const isMemoryMode = () => {
  return getStorageMode() === "memory";
};

/**
 * Initialize storage subsystem based on configured STORAGE_MODE.
 *
 * In memory mode:
 * - Skips MongoDB connection entirely.
 * - Seeds deterministic demo topology and telemetry unless SEED_DEMO_DATA=false.
 *
 * In mongodb mode:
 * - Connects to MongoDB via Mongoose.
 *
 * @param {Function} [connectMongoFn] - Optional reference to connectDB()
 * @returns {Promise<{ mode: string, initialized: boolean, seedSummary?: object }>}
 */
export const initStorage = async (connectMongoFn) => {
  const mode = getStorageMode();

  if (mode === "memory") {
    console.log("[Storage] In-memory storage mode active (MongoDB not required).");

    const shouldSeed = process.env.SEED_DEMO_DATA !== "false";
    let seedSummary = null;

    if (shouldSeed) {
      seedSummary = await seedDemoData({ clearExisting: true });
      console.log(
        `[Storage] Seeded demo topology: ${seedSummary.routerCount} routers, ` +
          `${seedSummary.linkCount} links, ${seedSummary.telemetryCount} telemetry observations.`
      );
    }

    return {
      mode: "memory",
      initialized: true,
      seedSummary,
    };
  }

  // MongoDB mode
  if (typeof connectMongoFn === "function") {
    await connectMongoFn();
  } else {
    const { default: connectDB } = await import("../config/database.js");
    await connectDB();
  }

  return {
    mode: "mongodb",
    initialized: true,
  };
};

/**
 * Get current diagnostic statistics from storage layer.
 *
 * @returns {Promise<object>}
 */
export const getStorageStatus = async () => {
  const mode = getStorageMode();

  if (mode === "memory") {
    return {
      mode: "memory",
      status: "ready",
      routerCount: memoryStore.routersMap.size,
      linkCount: memoryStore.linksMap.size,
      telemetryCount: memoryStore.telemetryGlobal.length,
      decisionCount: memoryStore.decisionsMap.size,
      database: "not_required",
    };
  }

  const { default: mongoose } = await import("mongoose");
  const isConnected = mongoose.connection.readyState === 1;

  return {
    mode: "mongodb",
    status: isConnected ? "connected" : "disconnected",
    database: isConnected ? "connected" : "disconnected",
  };
};

export { memoryStore, seedDemoData, advanceReplayStep };

