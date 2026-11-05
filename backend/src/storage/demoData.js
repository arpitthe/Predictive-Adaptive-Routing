/**
 * demoData.js
 *
 * Deterministic sample topology and telemetry data generator for
 * database-free demonstration mode (STORAGE_MODE=memory).
 *
 * Topology Specifications:
 * - 6 Routers: R1 (New York), R2 (Chicago), R3 (Atlanta), R4 (Dallas), R5 (Denver), R6 (San Jose)
 * - 8 Bidirectional Links:
 *     Conventional Primary Path: R1 -> R2 -> R4 -> R6 (Links L1-2, L2-4, L4-6)
 *     Predictive Alternative Path: R1 -> R3 -> R5 -> R6 (Links L1-3, L3-5, L5-6)
 *     Cross Links: L2-5 (R2-R5), L3-4 (R3-R4)
 * - Bottleneck Link: L2-4 (Chicago -> Dallas)
 *     Initial 6-step history: [28.0, 32.0, 36.0, 40.0, 44.0, 48.0]%
 */

import { memoryStore } from "./memoryStore.js";

// ---------------------------------------------------------------------------
// Topology Definitions
// ---------------------------------------------------------------------------

export const DEMO_ROUTERS = [
  { routerId: "R1", name: "New York Core Router", ipAddress: "10.0.1.1", location: "New York, NY" },
  { routerId: "R2", name: "Chicago Core Router", ipAddress: "10.0.2.1", location: "Chicago, IL" },
  { routerId: "R3", name: "Atlanta Core Router", ipAddress: "10.0.3.1", location: "Atlanta, GA" },
  { routerId: "R4", name: "Dallas Core Router", ipAddress: "10.0.4.1", location: "Dallas, TX" },
  { routerId: "R5", name: "Denver Core Router", ipAddress: "10.0.5.1", location: "Denver, CO" },
  { routerId: "R6", name: "San Jose Core Router", ipAddress: "10.0.6.1", location: "San Jose, CA" },
];

export const DEMO_LINKS = [
  // Primary Conventional Route Links (R1 -> R2 -> R4 -> R6)
  { linkId: "L1-2", src: "R1", dst: "R2", bandwidthMbps: 1000, latencyMs: 10, mlLinkIndex: 1, baseUtil: 32.0 },
  { linkId: "L2-4", src: "R2", dst: "R4", bandwidthMbps: 1000, latencyMs: 12, mlLinkIndex: 2, baseUtil: 48.0 }, // Bottleneck!
  { linkId: "L4-6", src: "R4", dst: "R6", bandwidthMbps: 1000, latencyMs: 15, mlLinkIndex: 3, baseUtil: 35.0 },

  // Predictive Alternative Route Links (R1 -> R3 -> R5 -> R6)
  { linkId: "L1-3", src: "R1", dst: "R3", bandwidthMbps: 1000, latencyMs: 14, mlLinkIndex: 4, baseUtil: 25.0 },
  { linkId: "L3-5", src: "R3", dst: "R5", bandwidthMbps: 1000, latencyMs: 18, mlLinkIndex: 5, baseUtil: 28.0 },
  { linkId: "L5-6", src: "R5", dst: "R6", bandwidthMbps: 1000, latencyMs: 16, mlLinkIndex: 6, baseUtil: 30.0 },

  // Cross Links
  { linkId: "L2-5", src: "R2", dst: "R5", bandwidthMbps: 1000, latencyMs: 22, mlLinkIndex: 7, baseUtil: 35.0 },
  { linkId: "L3-4", src: "R3", dst: "R4", bandwidthMbps: 1000, latencyMs: 20, mlLinkIndex: 8, baseUtil: 30.0 },
];

// Initial 6-lag historical utilization sequences for all 8 links
export const INITIAL_HISTORIES = {
  // Bottleneck link L2-4: steadily climbing towards the 50% threshold
  "L2-4": [28.0, 32.0, 36.0, 40.0, 44.0, 48.0],
  // Stable baseline links
  "L1-2": [30.0, 31.0, 33.0, 31.5, 32.5, 32.0],
  "L4-6": [33.0, 34.0, 36.0, 34.5, 35.5, 35.0],
  "L1-3": [24.0, 25.0, 24.5, 26.0, 25.0, 25.0],
  "L3-5": [27.0, 28.5, 27.5, 29.0, 28.0, 28.0],
  "L5-6": [29.0, 30.5, 29.5, 31.0, 30.0, 30.0],
  "L2-5": [34.0, 35.5, 34.5, 36.0, 35.0, 35.0],
  "L3-4": [29.0, 30.0, 29.5, 31.0, 30.0, 30.0],
};

// ---------------------------------------------------------------------------
// Seeding Engine
// ---------------------------------------------------------------------------

let lastReplayTimestamp = null;

export const getReplayTimestamp = () => lastReplayTimestamp;
export const setReplayTimestamp = (ts) => { lastReplayTimestamp = ts; };

/**
 * Seed deterministic demo routers, links, and 6 historical telemetry samples per link.
 *
 * @param {object} [options]
 * @param {boolean} [options.clearExisting=true]
 * @returns {Promise<{ routerCount: number, linkCount: number, telemetryCount: number }>}
 */
export const seedDemoData = async ({ clearExisting = true } = {}) => {
  if (clearExisting) {
    memoryStore.clear();
  }

  // 1. Create Routers
  const routerDocMap = new Map();
  for (const routerDef of DEMO_ROUTERS) {
    const doc = await memoryStore.routers.create(routerDef);
    routerDocMap.set(routerDef.routerId, doc);
  }

  // 2. Create Links
  const linkDocMap = new Map();
  for (const linkDef of DEMO_LINKS) {
    const srcRouter = routerDocMap.get(linkDef.src);
    const dstRouter = routerDocMap.get(linkDef.dst);

    const doc = await memoryStore.links.create({
      linkId: linkDef.linkId,
      sourceRouter: srcRouter._id,
      destinationRouter: dstRouter._id,
      bandwidthMbps: linkDef.bandwidthMbps,
      latencyMs: linkDef.latencyMs,
      utilizationPct: linkDef.baseUtil,
      status: "active",
      mlLinkIndex: linkDef.mlLinkIndex,
    });

    linkDocMap.set(linkDef.linkId, doc);
  }

  // 3. Create 6 Historical Observations per Link (spaced exactly 5 minutes apart)
  const INTERVAL_MS = 5 * 60 * 1000;
  const now = Date.now();
  const anchorTime = Math.floor(now / INTERVAL_MS) * INTERVAL_MS;

  let totalTelemetry = 0;

  for (const linkDef of DEMO_LINKS) {
    const linkDoc = linkDocMap.get(linkDef.linkId);
    const historyVals = INITIAL_HISTORIES[linkDef.linkId] || [30, 31, 32, 33, 34, 35];

    for (let step = 0; step < historyVals.length; step += 1) {
      const stepTime = new Date(anchorTime - (historyVals.length - 1 - step) * INTERVAL_MS);
      const util = historyVals[step];
      const throughputMbps = Number(((linkDef.bandwidthMbps * util) / 100).toFixed(2));
      const packetLoss = util > 70 ? 0.05 : 0.0;

      await memoryStore.telemetry.create({
        link: linkDoc._id,
        linkId: linkDoc.linkId,
        utilizationPct: util,
        throughputMbps,
        packetLossPct: packetLoss,
        source: "demo_seed",
        measuredAt: stepTime,
      });

      totalTelemetry += 1;

      if (step === historyVals.length - 1) {
        linkDoc.utilizationPct = util;
        await linkDoc.save();
      }
    }
  }

  lastReplayTimestamp = anchorTime;

  return {
    routerCount: routerDocMap.size,
    linkCount: linkDocMap.size,
    telemetryCount: totalTelemetry,
  };
};

/**
 * Advance logical simulation time by 5 minutes.
 */
export const advanceReplayStep = async () => {
  const INTERVAL_MS = 5 * 60 * 1000;
  const nextTime = (lastReplayTimestamp || Date.now()) + INTERVAL_MS;
  lastReplayTimestamp = nextTime;
  const measuredAt = new Date(nextTime);

  const updatedLinks = [];
  const links = await memoryStore.links.find({ status: "active" });

  for (const link of links) {
    let nextUtil = link.utilizationPct;

    // If it's the bottleneck link L2-4, drive it upward
    if (link.linkId === "L2-4") {
      nextUtil = Number(Math.min(85.0, link.utilizationPct + 6.0).toFixed(1));
    } else {
      // Normal links have minor variance (+/- 1.5%)
      const delta = (Math.random() - 0.5) * 3.0;
      nextUtil = Number(Math.max(10.0, Math.min(50.0, link.utilizationPct + delta)).toFixed(1));
    }

    const throughputMbps = Number(((link.bandwidthMbps * nextUtil) / 100).toFixed(2));
    const packetLoss = nextUtil > 70 ? 0.08 : 0.0;

    await memoryStore.telemetry.create({
      link: link._id,
      linkId: link.linkId,
      utilizationPct: nextUtil,
      throughputMbps,
      packetLossPct: packetLoss,
      source: "replay",
      measuredAt,
    });

    link.utilizationPct = nextUtil;
    await link.save();

    updatedLinks.push({
      linkId: link.linkId,
      utilizationPct: nextUtil,
      measuredAt: measuredAt.toISOString(),
      source: "replay",
    });
  }

  return {
    timestamp: measuredAt.toISOString(),
    updatedLinks,
  };
};
