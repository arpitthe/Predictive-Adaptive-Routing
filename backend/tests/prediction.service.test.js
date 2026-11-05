/**
 * prediction.service.test.js
 *
 * Unit and integration tests for prediction.service.js.
 *
 * Test Scenarios Covered:
 *  1. Successful single prediction request (mocked axios)
 *  2. Successful batch request with 2 links — verify order preservation
 *  3. ML service unavailable (ECONNREFUSED) → checkHealth returns { available: false, ... }
 *  4. Request timeout (ETIMEDOUT) → classifies error as timeout, never silently returns 0
 *  5. Invalid response structure (missing predicted_utilization_percent) → validation error
 *  6. Missing link field in batch response item → error isolation / fallback key
 *  7. One invalid link in batch (status: "error") → other links succeed, failed link marked as error
 *  8. Failed prediction does NOT become 0 cost → verify HIGH_PENALTY_COST > 0
 *  9. Correct percentage units — buildMlPayload preserves 0–100 scale, not 0–1
 * 10. Routing cost mapping — predictedUtilizationPct=65 -> risk=HIGH, cost=107.5
 * 11. Insufficient history (< 6 observations) → validateTelemetryHistory rejects with reason and counts
 * 12. Fallback identification — passes allow_fallback query flag and captures model name
 *
 * Execution status: WRITTEN BUT NOT EXECUTED (per execution rules).
 */

import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import axios from "axios";
import {
  checkHealth,
  predictSingle,
  predictBatch,
  getRoutingCost,
  buildMlPayload,
  validateTelemetryHistory,
  HIGH_PENALTY_COST,
  REQUIRED_OBSERVATIONS,
} from "../src/services/prediction.service.js";

describe("Prediction Service Unit Tests", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ML_SERVICE_URL = "http://127.0.0.1:8000";
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // 1. Successful single prediction request
  // -------------------------------------------------------------------------
  it("Scenario 1: should return prediction data on successful single prediction", async () => {
    const mockResponse = {
      data: {
        status: "ok",
        link: "R1-R2",
        predicted_utilization_percent: 42.5,
        model: "amazon/chronos-2",
        device: "cuda",
      },
    };

    jest.spyOn(axios, "post").mockResolvedValueOnce(mockResponse);

    const payload = {
      link: "R1-R2",
      link_index: 1,
      capacity_kbps: 100000,
      traffic_kbps: 42000,
      utilization_pct: 42.0,
      util_lag_1: 41.5,
      util_lag_2: 41.0,
      util_lag_3: 40.5,
      util_lag_4: 40.0,
      util_lag_5: 39.5,
    };

    const result = await predictSingle(payload);

    expect(axios.post).toHaveBeenCalledWith(
      "http://127.0.0.1:8000/predict",
      payload,
      expect.objectContaining({ timeout: 120000 })
    );
    expect(result.status).toBe("ok");
    expect(result.predicted_utilization_percent).toBe(42.5);
    expect(result.model).toBe("amazon/chronos-2");
  });

  // -------------------------------------------------------------------------
  // 2. Successful batch request with 2 links — verify order preservation
  // -------------------------------------------------------------------------
  it("Scenario 2: should preserve order and map links correctly in batch prediction", async () => {
    const mockBatchResponse = {
      data: [
        {
          status: "ok",
          link: "R1-R2",
          predicted_utilization_percent: 45.0,
          model: "amazon/chronos-2",
        },
        {
          status: "ok",
          link: "R2-R3",
          predicted_utilization_percent: 75.0,
          model: "amazon/chronos-2",
        },
      ],
    };

    jest.spyOn(axios, "post").mockResolvedValueOnce(mockBatchResponse);

    const payloads = [
      { link: "R1-R2", utilization_pct: 40.0 },
      { link: "R2-R3", utilization_pct: 70.0 },
    ];

    const resultMap = await predictBatch(payloads);

    expect(resultMap.size).toBe(2);
    expect(resultMap.has("R1-R2")).toBe(true);
    expect(resultMap.has("R2-R3")).toBe(true);
    expect(resultMap.get("R1-R2").predicted_utilization_percent).toBe(45.0);
    expect(resultMap.get("R2-R3").predicted_utilization_percent).toBe(75.0);
  });

  // -------------------------------------------------------------------------
  // 3. ML service unavailable (ECONNREFUSED)
  // -------------------------------------------------------------------------
  it("Scenario 3: should report available=false when ML service connection is refused", async () => {
    const connError = new Error("connect ECONNREFUSED 127.0.0.1:8000");
    connError.code = "ECONNREFUSED";

    jest.spyOn(axios, "get").mockRejectedValueOnce(connError);

    const health = await checkHealth();

    expect(health.available).toBe(false);
    expect(health.modelLoaded).toBe(false);
    expect(health.error).toContain("ECONNREFUSED");
  });

  // -------------------------------------------------------------------------
  // 4. Request timeout (ETIMEDOUT) → appropriate classified error, not 0 cost
  // -------------------------------------------------------------------------
  it("Scenario 4: should classify timeout error and never return 0 cost", async () => {
    const timeoutError = new Error("timeout of 120000ms exceeded");
    timeoutError.code = "ETIMEDOUT";

    jest.spyOn(axios, "post").mockRejectedValueOnce(timeoutError);

    await expect(predictSingle({ link: "R1-R2" })).rejects.toMatchObject({
      category: "timeout",
      message: expect.stringContaining("timed out"),
    });
  });

  // -------------------------------------------------------------------------
  // 5. Invalid response structure (missing predicted_utilization_percent)
  // -------------------------------------------------------------------------
  it("Scenario 5: should reject response lacking valid predicted_utilization_percent", async () => {
    const invalidResponse = {
      data: {
        status: "ok",
        link: "R1-R2",
        // missing predicted_utilization_percent
      },
    };

    jest.spyOn(axios, "post").mockResolvedValueOnce(invalidResponse);

    await expect(predictSingle({ link: "R1-R2" })).rejects.toMatchObject({
      category: "ml_validation",
      message: expect.stringContaining("predicted_utilization_percent"),
    });
  });

  // -------------------------------------------------------------------------
  // 6. Missing link field in batch response item → error isolation
  // -------------------------------------------------------------------------
  it("Scenario 6: should isolate and correlate batch response item lacking link field", async () => {
    const mockBatchResponse = {
      data: [
        {
          status: "ok",
          // link omitted in response
          predicted_utilization_percent: 55.0,
        },
      ],
    };

    jest.spyOn(axios, "post").mockResolvedValueOnce(mockBatchResponse);

    const payloads = [{ link: "R3-R4", utilization_pct: 50.0 }];
    const resultMap = await predictBatch(payloads);

    expect(resultMap.has("R3-R4")).toBe(true);
    expect(resultMap.get("R3-R4").predicted_utilization_percent).toBe(55.0);
  });

  // -------------------------------------------------------------------------
  // 7. One invalid link in batch (status: "error") → others succeed
  // -------------------------------------------------------------------------
  it("Scenario 7: should allow valid link to succeed when another link errors out in batch", async () => {
    const mockBatchResponse = {
      data: [
        {
          status: "ok",
          link: "R1-R2",
          predicted_utilization_percent: 33.0,
        },
        {
          status: "error",
          link: "R2-R3",
          error: "NaN in context window",
        },
      ],
    };

    jest.spyOn(axios, "post").mockResolvedValueOnce(mockBatchResponse);

    const payloads = [
      { link: "R1-R2", utilization_pct: 30.0 },
      { link: "R2-R3", utilization_pct: 80.0 },
    ];

    const resultMap = await predictBatch(payloads);

    expect(resultMap.get("R1-R2").status).toBe("ok");
    expect(resultMap.get("R1-R2").predicted_utilization_percent).toBe(33.0);

    expect(resultMap.get("R2-R3").status).toBe("error");
    expect(resultMap.get("R2-R3").error).toBe("NaN in context window");
  });

  // -------------------------------------------------------------------------
  // 8. Failed prediction NOT becoming 0 cost — verify penalty > 0
  // -------------------------------------------------------------------------
  it("Scenario 8: HIGH_PENALTY_COST must be strictly positive and substantially punitive", () => {
    expect(HIGH_PENALTY_COST).toBeGreaterThan(0);
    expect(HIGH_PENALTY_COST).toBeGreaterThanOrEqual(200); // Exceeds normal routing cost ceiling
    expect(HIGH_PENALTY_COST).toBe(500);
  });

  // -------------------------------------------------------------------------
  // 9. Correct percentage units — batch payload has 0–100 values, not 0–1
  // -------------------------------------------------------------------------
  it("Scenario 9: buildMlPayload should preserve 0-100 percentage values without scaling to 0-1", () => {
    const mockLink = {
      linkId: "L1",
      bandwidthMbps: 100,
      sourceRouter: { routerId: "R1" },
      destinationRouter: { routerId: "R2" },
    };

    const baseTime = new Date("2026-11-05T00:00:00Z").getTime();
    const history = [
      { utilizationPct: 20.0, measuredAt: new Date(baseTime) },
      { utilizationPct: 25.0, measuredAt: new Date(baseTime + 5 * 60000) },
      { utilizationPct: 30.0, measuredAt: new Date(baseTime + 10 * 60000) },
      { utilizationPct: 35.0, measuredAt: new Date(baseTime + 15 * 60000) },
      { utilizationPct: 40.0, measuredAt: new Date(baseTime + 20 * 60000) },
      { utilizationPct: 45.0, measuredAt: new Date(baseTime + 25 * 60000) },
    ];

    const payload = buildMlPayload(mockLink, history, 1);

    expect(payload.link).toBe("R1-R2");
    expect(payload.link_index).toBe(1);
    expect(payload.utilization_pct).toBe(45.0);
    expect(payload.util_lag_1).toBe(40.0);
    expect(payload.util_lag_2).toBe(35.0);
    expect(payload.util_lag_3).toBe(30.0);
    expect(payload.util_lag_4).toBe(25.0);
    expect(payload.util_lag_5).toBe(20.0);

    // Verify values are not compressed to 0.20, 0.45, etc.
    expect(payload.utilization_pct).toBeGreaterThan(1.0);
  });

  // -------------------------------------------------------------------------
  // 10. Routing cost mapping — predictedUtilizationPct=65 → risk=HIGH, cost=107.5
  // -------------------------------------------------------------------------
  it("Scenario 10: getRoutingCost should map predictedUtilizationPct=65 to HIGH risk and exact cost", async () => {
    const mockCostResponse = {
      data: {
        predicted_cost: 107.5,
        risk: "HIGH",
        predicted_utilization: 65.0,
      },
    };

    jest.spyOn(axios, "post").mockResolvedValueOnce(mockCostResponse);

    const costResult = await getRoutingCost(65.0, "L1", 60.0);

    expect(axios.post).toHaveBeenCalledWith(
      "http://127.0.0.1:8000/routing-cost",
      {
        predicted_utilization_percent: 65.0,
        current_metrics: {
          link: "L1",
          utilization_pct: 60.0,
        },
      },
      expect.objectContaining({ timeout: 15000 })
    );

    expect(costResult.cost).toBe(107.5);
    expect(costResult.risk).toBe("HIGH");
  });

  // -------------------------------------------------------------------------
  // 11. Insufficient history (5 obs) → rejects with availableObservations: 5
  // -------------------------------------------------------------------------
  it("Scenario 11: validateTelemetryHistory rejects when fewer than 6 observations exist", () => {
    const baseTime = new Date("2026-11-05T00:00:00Z").getTime();
    const shortHistory = [
      { utilizationPct: 10.0, measuredAt: new Date(baseTime) },
      { utilizationPct: 15.0, measuredAt: new Date(baseTime + 5 * 60000) },
      { utilizationPct: 20.0, measuredAt: new Date(baseTime + 10 * 60000) },
      { utilizationPct: 25.0, measuredAt: new Date(baseTime + 15 * 60000) },
      { utilizationPct: 30.0, measuredAt: new Date(baseTime + 20 * 60000) },
    ];

    const validation = validateTelemetryHistory(shortHistory);

    expect(validation.valid).toBe(false);
    expect(validation.reason).toBe("INSUFFICIENT_HISTORY");
    expect(validation.details.required).toBe(REQUIRED_OBSERVATIONS);
    expect(validation.details.available).toBe(5);
  });

  // -------------------------------------------------------------------------
  // 12. Fallback identification — response includes model when fallback enabled
  // -------------------------------------------------------------------------
  it("Scenario 12: predictSingle with allowFallback=true requests fallback and returns fallback model info", async () => {
    const mockFallbackResponse = {
      data: {
        status: "ok",
        link: "R1-R2",
        predicted_utilization_percent: 50.0,
        model: "Moving Average (fallback)",
      },
    };

    jest.spyOn(axios, "post").mockResolvedValueOnce(mockFallbackResponse);

    const payload = { link: "R1-R2", utilization_pct: 50.0 };
    const result = await predictSingle(payload, { allowFallback: true });

    expect(axios.post).toHaveBeenCalledWith(
      "http://127.0.0.1:8000/predict?allow_fallback=true",
      payload,
      expect.any(Object)
    );

    expect(result.model).toBe("Moving Average (fallback)");
    expect(result.predicted_utilization_percent).toBe(50.0);
  });
});

