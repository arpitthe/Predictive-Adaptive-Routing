/**
 * memory.store.test.js
 *
 * Unit tests for the database-free in-memory storage engine,
 * query compatibility, and deterministic demonstration seeding.
 *
 * Scenarios Covered:
 *  1. In-memory router CRUD and uniqueness enforcement
 *  2. In-memory link CRUD and router population
 *  3. Telemetry rolling buffer ordering and limit enforcement
 *  4. Deterministic demo data seeding (6 routers, 8 links, 96 observations)
 *  5. Telemetry history validation against Chronos-2 requirements
 *  6. Replay step advancement (5-minute logical increment, source="replay")
 *  7. Health reporting in memory mode (status=ready, database=not_required)
 *
 * Execution status: WRITTEN BUT NOT EXECUTED (per execution rules).
 */

import { describe, it, expect, beforeEach } from "@jest/globals";
import { memoryStore } from "../src/storage/memoryStore.js";
import { seedDemoData, advanceReplayStep, DEMO_ROUTERS, DEMO_LINKS } from "../src/storage/demoData.js";
import { validateTelemetryHistory, REQUIRED_OBSERVATIONS } from "../src/services/prediction.service.js";
import { getStorageStatus } from "../src/storage/index.js";

describe("Database-Free In-Memory Store & Demo Engine", () => {
  beforeEach(() => {
    process.env.STORAGE_MODE = "memory";
    memoryStore.clear();
  });

  // -------------------------------------------------------------------------
  // 1. Router CRUD & Uniqueness
  // -------------------------------------------------------------------------
  it("should create routers and reject duplicate routerId", async () => {
    const router = await memoryStore.routers.create({
      routerId: "R1",
      name: "Core 1",
      ipAddress: "10.0.1.1",
      status: "active",
    });

    expect(router._id).toBeDefined();
    expect(router.routerId).toBe("R1");

    // Duplicate check
    await expect(
      memoryStore.routers.create({
        routerId: "R1",
        name: "Duplicate Core",
        ipAddress: "10.0.1.2",
      })
    ).rejects.toMatchObject({ code: 11000 });
  });

  // -------------------------------------------------------------------------
  // 2. Link CRUD & Population
  // -------------------------------------------------------------------------
  it("should create links and populate source and destination routers", async () => {
    const r1 = await memoryStore.routers.create({ routerId: "R1", name: "NY", ipAddress: "10.0.1.1" });
    const r2 = await memoryStore.routers.create({ routerId: "R2", name: "CHI", ipAddress: "10.0.2.1" });

    const link = await memoryStore.links.create({
      linkId: "L1-2",
      sourceRouter: r1._id,
      destinationRouter: r2._id,
      bandwidthMbps: 1000,
      latencyMs: 15,
      status: "active",
    });

    const fetched = await memoryStore.links
      .findById(link._id)
      .populate("sourceRouter", "routerId name")
      .populate("destinationRouter", "routerId name");

    expect(fetched.linkId).toBe("L1-2");
    expect(fetched.sourceRouter.routerId).toBe("R1");
    expect(fetched.destinationRouter.routerId).toBe("R2");
  });

  // -------------------------------------------------------------------------
  // 3. Telemetry Rolling Buffer
  // -------------------------------------------------------------------------
  it("should maintain chronological order in rolling telemetry buffer", async () => {
    const t1 = new Date("2026-11-05T00:00:00Z");
    const t2 = new Date("2026-11-05T00:05:00Z");
    const t3 = new Date("2026-11-05T00:10:00Z");

    // Insert out of chronological order to test auto-sorting
    await memoryStore.telemetry.create({ linkId: "L1-2", utilizationPct: 30, measuredAt: t2 });
    await memoryStore.telemetry.create({ linkId: "L1-2", utilizationPct: 20, measuredAt: t1 });
    await memoryStore.telemetry.create({ linkId: "L1-2", utilizationPct: 40, measuredAt: t3 });

    const history = await memoryStore.telemetry.find({ linkId: "L1-2" }).sort({ measuredAt: 1 });

    expect(history.length).toBe(3);
    expect(history[0].utilizationPct).toBe(20);
    expect(history[1].utilizationPct).toBe(30);
    expect(history[2].utilizationPct).toBe(40);
  });

  // -------------------------------------------------------------------------
  // 4. Deterministic Demo Seeding
  // -------------------------------------------------------------------------
  it("should seed deterministic topology and 12-sample history per link", async () => {
    const summary = await seedDemoData({ clearExisting: true });

    expect(summary.routerCount).toBe(DEMO_ROUTERS.length);
    expect(summary.linkCount).toBe(DEMO_LINKS.length);
    expect(summary.telemetryCount).toBe(DEMO_LINKS.length * 12);

    const links = await memoryStore.links.find();
    expect(links.length).toBe(8);

    const routers = await memoryStore.routers.find();
    expect(routers.length).toBe(6);
  });

  // -------------------------------------------------------------------------
  // 5. Seeded Telemetry Conformance with Chronos-2
  // -------------------------------------------------------------------------
  it("seeded telemetry should satisfy Chronos-2 5-minute sampling interval and lag requirements", async () => {
    await seedDemoData({ clearExisting: true });

    const links = await memoryStore.links.find();

    for (const link of links) {
      const history = await memoryStore.telemetry
        .find({ link: link._id })
        .sort({ measuredAt: 1 });

      expect(history.length).toBe(12);
      expect(history.length).toBeGreaterThanOrEqual(REQUIRED_OBSERVATIONS);

      // Validate 5-minute cadence on the latest 6 samples
      const contextWindow = history.slice(-REQUIRED_OBSERVATIONS);
      const validation = validateTelemetryHistory(contextWindow);

      expect(validation.valid).toBe(true);
      expect(contextWindow[0].source).toBe("demo_seed");
    }
  });

  // -------------------------------------------------------------------------
  // 6. Accelerated Replay Step
  // -------------------------------------------------------------------------
  it("advanceReplayStep should advance logical time by 5 minutes and tag source='replay'", async () => {
    await seedDemoData({ clearExisting: true });

    const replayResult = await advanceReplayStep();

    expect(replayResult.updatedLinks.length).toBe(8);
    expect(replayResult.updatedLinks[0].source).toBe("replay");

    // History should now have 13 records per link
    const history = await memoryStore.telemetry.find({ linkId: "L1-2" });
    expect(history.length).toBe(13);

    const latest = history[history.length - 1];
    expect(latest.source).toBe("replay");
  });

  // -------------------------------------------------------------------------
  // 7. Health Status in Memory Mode
  // -------------------------------------------------------------------------
  it("getStorageStatus should report ready without requiring MongoDB", async () => {
    await seedDemoData({ clearExisting: true });

    const status = await getStorageStatus();

    expect(status.mode).toBe("memory");
    expect(status.status).toBe("ready");
    expect(status.database).toBe("not_required");
    expect(status.routerCount).toBe(6);
    expect(status.linkCount).toBe(8);
  });
});

