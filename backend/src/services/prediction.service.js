/**
 * prediction.service.js
 *
 * Centralised interface between the Node.js backend and the Python
 * FastAPI prediction layer (Chronos-2).
 *
 * This module is the ONLY place in the backend that constructs HTTP
 * requests to ML_SERVICE_URL. No other file should import axios and
 * call the ML service directly.
 *
 * Responsibilities
 * ----------------
 * - Health-check the Python service.
 * - Build a well-formed ML payload from a link document + telemetry history.
 * - Validate telemetry history before any ML call.
 * - Issue single-link or batch prediction requests.
 * - Issue routing-cost requests.
 * - Classify and re-throw errors with enough context for callers.
 *
 * NOT responsible for
 * -------------------
 * - Dijkstra / route selection  →  routing.service.js
 * - Express request/response handling  →  controllers
 * - Database writes  →  models + controllers
 */

import axios from "axios";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Expected gap between consecutive telemetry samples (5 minutes). */
const INTERVAL_MS = 5 * 60 * 1000;

/** Permitted deviation from the nominal 5-minute interval (±60 s). */
const INTERVAL_TOLERANCE_MS = 60 * 1000;

/** Minimum number of telemetry observations required for inference. */
export const REQUIRED_OBSERVATIONS = 6;

/**
 * Routing cost assigned to any link whose prediction fails at the batch
 * stage. Must be strictly positive and large enough to make the link
 * unattractive to Dijkstra without artificially blocking the entire
 * route computation.
 *
 * Value rationale: Python routing_cost clamps normal costs to [1, 200].
 * A PENALTY of 500 is well above that ceiling, ensuring a failed link is
 * only chosen when no alternative exists.
 */
export const HIGH_PENALTY_COST = 500;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Return the ML service base URL with any trailing slashes removed.
 * Reads ML_SERVICE_URL from the environment at call time so that tests
 * can override it without reloading the module.
 *
 * @returns {string}
 */
const getMlBaseUrl = () =>
  (process.env.ML_SERVICE_URL || "http://127.0.0.1:8000").replace(/\/+$/, "");

/**
 * Read a numeric timeout from the environment, falling back to
 * `defaultMs` when the variable is absent or non-numeric.
 *
 * @param {string} envVar
 * @param {number} defaultMs
 * @returns {number}
 */
const getTimeoutMs = (envVar, defaultMs) => {
  const raw = process.env[envVar];
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultMs;
};

/**
 * Compute the linear-regression slope of a numeric array.
 * Returns 0 when the array contains fewer than two distinct x-values.
 *
 * @param {number[]} values
 * @returns {number}
 */
const calculateTrend = (values) => {
  const count = values.length;
  if (count < 2) return 0;

  const meanX = (count - 1) / 2;
  const meanY = values.reduce((sum, v) => sum + v, 0) / count;

  let numerator = 0;
  let denominator = 0;

  values.forEach((v, i) => {
    numerator += (i - meanX) * (v - meanY);
    denominator += (i - meanX) ** 2;
  });

  return denominator === 0 ? 0 : numerator / denominator;
};

/**
 * Classify an axios / network error into a human-readable category and
 * attach it to a standard Error object so callers can branch on it.
 *
 * Categories: "connection" | "timeout" | "ml_validation" | "ml_server" | "unknown"
 *
 * @param {unknown} err  Raw error thrown by axios
 * @param {string}  context  Short description of the failing operation
 * @returns {Error}
 */
const classifyError = (err, context) => {
  if (err?.code === "ECONNREFUSED" || err?.code === "ECONNRESET") {
    const e = new Error(
      `${context}: ML service is not reachable (${err.code}). ` +
        "Ensure the Python FastAPI server is running."
    );
    e.category = "connection";
    return e;
  }

  if (err?.code === "ETIMEDOUT" || err?.code === "ECONNABORTED") {
    const e = new Error(`${context}: ML service request timed out (${err.code}).`);
    e.category = "timeout";
    return e;
  }

  if (err?.response) {
    const status = err.response.status;
    const category = status >= 400 && status < 500 ? "ml_validation" : "ml_server";
    const e = new Error(
      `${context}: ML service responded with HTTP ${status}.`
    );
    e.category = category;
    e.mlStatus = status;
    e.mlBody = err.response.data;
    return e;
  }

  const e = new Error(`${context}: ${err?.message ?? String(err)}`);
  e.category = "unknown";
  return e;
};

// ---------------------------------------------------------------------------
// Exported — telemetry validation
// ---------------------------------------------------------------------------

/**
 * Validate that a telemetry history array is suitable for ML inference.
 *
 * The array must be in **oldest-first** order.
 *
 * @param {Array<{utilizationPct: number, measuredAt: Date|string}>} history
 *   Telemetry observations in chronological (oldest-first) order.
 *
 * @returns {{ valid: true } | { valid: false, reason: string, details: object }}
 */
export const validateTelemetryHistory = (history) => {
  if (!Array.isArray(history) || history.length < REQUIRED_OBSERVATIONS) {
    return {
      valid: false,
      reason: "INSUFFICIENT_HISTORY",
      details: {
        required: REQUIRED_OBSERVATIONS,
        available: Array.isArray(history) ? history.length : 0,
      },
    };
  }

  for (let i = 1; i < history.length; i += 1) {
    const prev = new Date(history[i - 1].measuredAt).getTime();
    const curr = new Date(history[i].measuredAt).getTime();
    const gap = curr - prev;

    const minGap = INTERVAL_MS - INTERVAL_TOLERANCE_MS;
    const maxGap = INTERVAL_MS + INTERVAL_TOLERANCE_MS;

    if (gap < minGap || gap > maxGap) {
      return {
        valid: false,
        reason: "IRREGULAR_INTERVAL",
        details: {
          atIndex: i,
          expectedIntervalMinutes: 5,
          toleranceSeconds: 60,
          actualGapMinutes: Number((gap / 60000).toFixed(2)),
        },
      };
    }
  }

  return { valid: true };
};

// ---------------------------------------------------------------------------
// Exported — payload construction
// ---------------------------------------------------------------------------

/**
 * Build the JSON payload that the Python `/predict` endpoint expects.
 *
 * The `history` array must already be in **oldest-first** order and must
 * have passed `validateTelemetryHistory()`.
 *
 * @param {object} link  Mongoose NetworkLink document (populated with sourceRouter / destinationRouter).
 * @param {Array<{utilizationPct: number, throughputMbps?: number, measuredAt: Date|string}>} history
 *   Telemetry observations, oldest-first, length ≥ REQUIRED_OBSERVATIONS.
 * @param {number} mlLinkIndex  Stable 1–30 ML index assigned to this link.
 * @returns {object}  PredictionRequest payload.
 */
export const buildMlPayload = (link, history, mlLinkIndex) => {
  const values = history.map((item) => item.utilizationPct);

  const lastThree = values.slice(-3);
  const mean = lastThree.reduce((sum, v) => sum + v, 0) / lastThree.length;
  const variance =
    lastThree.reduce((sum, v) => sum + (v - mean) ** 2, 0) / lastThree.length;
  const standardDeviation = Math.sqrt(variance);

  const latestObs = history[history.length - 1];
  const capacityKbps = (link.bandwidthMbps ?? 0) * 1000;
  const trafficKbps =
    latestObs.throughputMbps != null
      ? latestObs.throughputMbps * 1000
      : (capacityKbps * latestObs.utilizationPct) / 100;

  const sourceId = link.sourceRouter?.routerId ?? "SOURCE";
  const destinationId = link.destinationRouter?.routerId ?? "DESTINATION";

  return {
    link: `${sourceId}-${destinationId}`,
    link_index: mlLinkIndex,
    capacity_kbps: capacityKbps,
    traffic_kbps: trafficKbps,

    // Context window: values[0] is oldest (lag 5), values[5] is current.
    utilization_pct: values[5],
    util_lag_1: values[4],
    util_lag_2: values[3],
    util_lag_3: values[2],
    util_lag_4: values[1],
    util_lag_5: values[0],

    // Optional rolling statistics (Python schema accepts but does not require).
    util_mean_3: mean,
    util_std_3: standardDeviation,
    util_trend_3: calculateTrend(lastThree),

    timestamp: new Date(latestObs.measuredAt).toISOString(),
  };
};

// ---------------------------------------------------------------------------
// Exported — ML service communication
// ---------------------------------------------------------------------------

/**
 * Check whether the Python prediction service is reachable and has a
 * loaded model.
 *
 * Always resolves (never rejects). Callers should inspect `available`.
 *
 * @returns {Promise<{
 *   available: boolean,
 *   modelLoaded: boolean,
 *   modelId: string|null,
 *   device: string|null,
 *   error: string|null
 * }>}
 */
export const checkHealth = async () => {
  const timeoutMs = getTimeoutMs("ML_HEALTH_TIMEOUT_MS", 5000);

  try {
    const response = await axios.get(`${getMlBaseUrl()}/health`, {
      timeout: timeoutMs,
    });

    const data = response.data ?? {};
    const isHealthy = data.status === "healthy";

    return {
      available: true,
      modelLoaded: isHealthy,
      modelId: data.model ?? null,
      device: data.device ?? null,
      error: isHealthy ? null : `ML service status: ${data.status}`,
    };
  } catch (err) {
    return {
      available: false,
      modelLoaded: false,
      modelId: null,
      device: null,
      error: err?.message ?? "Unknown error",
    };
  }
};

/**
 * Request a single-link utilization forecast from the Python service.
 *
 * @param {object} mlPayload  Built by `buildMlPayload()`.
 * @param {object} [options]
 * @param {boolean} [options.allowFallback=false]  Pass `allow_fallback=true` to Python.
 * @returns {Promise<object>}  Python PredictionResponse payload.
 * @throws {Error}  Classified error (see `classifyError`).
 */
export const predictSingle = async (mlPayload, { allowFallback = false } = {}) => {
  const timeoutMs = getTimeoutMs("ML_PREDICT_TIMEOUT_MS", 120000);
  const url = `${getMlBaseUrl()}/predict${allowFallback ? "?allow_fallback=true" : ""}`;

  try {
    const response = await axios.post(url, mlPayload, { timeout: timeoutMs });
    const data = response.data;

    // Defensive check: the Python service must return predicted_utilization_percent.
    if (
      data == null ||
      typeof data.predicted_utilization_percent !== "number" ||
      !Number.isFinite(data.predicted_utilization_percent)
    ) {
      throw Object.assign(
        new Error(
          "ML service returned a response without a valid predicted_utilization_percent."
        ),
        { category: "ml_validation", mlBody: data }
      );
    }

    return data;
  } catch (err) {
    if (err.category) throw err; // already classified
    throw classifyError(err, "predictSingle");
  }
};

/**
 * Request utilization forecasts for multiple links in a single HTTP call.
 *
 * Returns a Map keyed by the `link` field (e.g. "R1-R2") from each
 * payload. Items that the Python service marks as `status: "error"` are
 * stored as `{ status: "error", error: "...", linkId }` so callers can
 * assign the HIGH_PENALTY_COST to them.
 *
 * Response order from Python is preserved and matched by position, then
 * cross-validated by the `link` field when present.
 *
 * @param {object[]} mlPayloads  Array of payloads built by `buildMlPayload()`.
 * @param {object}   [options]
 * @param {boolean}  [options.allowFallback=false]
 * @returns {Promise<Map<string, object>>}  link-string → PredictionResponse or error item.
 * @throws {Error}  Only if the entire batch request fails (not for per-item errors).
 */
export const predictBatch = async (mlPayloads, { allowFallback = false } = {}) => {
  if (mlPayloads.length === 0) {
    return new Map();
  }

  const timeoutMs = getTimeoutMs("ML_BATCH_TIMEOUT_MS", 180000);
  const url = `${getMlBaseUrl()}/predict/batch${allowFallback ? "?allow_fallback=true" : ""}`;

  let responseItems;

  try {
    const response = await axios.post(url, mlPayloads, { timeout: timeoutMs });
    responseItems = response.data;
  } catch (err) {
    throw classifyError(err, "predictBatch");
  }

  if (!Array.isArray(responseItems)) {
    throw Object.assign(
      new Error(
        "ML service batch response is not an array. " +
          `Received: ${typeof responseItems}`
      ),
      { category: "ml_server" }
    );
  }

  if (responseItems.length !== mlPayloads.length) {
    throw Object.assign(
      new Error(
        `ML service batch response length mismatch: sent ${mlPayloads.length}, ` +
          `received ${responseItems.length}.`
      ),
      { category: "ml_server" }
    );
  }

  const resultMap = new Map();

  responseItems.forEach((item, index) => {
    // Use the link field from the response when present; fall back to the
    // corresponding request payload link field for identity resolution.
    const linkKey = item?.link ?? mlPayloads[index]?.link ?? `__index_${index}`;

    if (item?.status === "error" || typeof item?.predicted_utilization_percent !== "number") {
      resultMap.set(linkKey, {
        status: "error",
        error: item?.error ?? "Missing predicted_utilization_percent in batch response item.",
        link: linkKey,
      });
    } else {
      resultMap.set(linkKey, item);
    }
  });

  return resultMap;
};

/**
 * Request the routing cost for a predicted utilisation value.
 *
 * @param {number} predictedUtilizationPct  0–100 percentage value.
 * @param {string} linkId                   Link identifier for the `current_metrics` body.
 * @param {number} [currentUtilizationPct]  Live utilisation to include in context (optional).
 * @returns {Promise<{ cost: number, risk: "LOW"|"HIGH", details: object }>}
 * @throws {Error}  Classified error.
 */
export const getRoutingCost = async (
  predictedUtilizationPct,
  linkId,
  currentUtilizationPct = null
) => {
  const timeoutMs = getTimeoutMs("ML_COST_TIMEOUT_MS", 15000);
  const url = `${getMlBaseUrl()}/routing-cost`;

  const body = {
    predicted_utilization_percent: predictedUtilizationPct,
    current_metrics: {
      link: linkId,
      ...(currentUtilizationPct != null
        ? { utilization_pct: currentUtilizationPct }
        : {}),
    },
  };

  try {
    const response = await axios.post(url, body, { timeout: timeoutMs });
    const data = response.data ?? {};

    const cost = data.predicted_cost ?? data.cost;

    if (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0) {
      throw Object.assign(
        new Error(
          `ML routing-cost response has invalid cost value: ${cost}`
        ),
        { category: "ml_validation", mlBody: data }
      );
    }

    return {
      cost,
      risk: data.risk ?? "UNKNOWN",
      details: data,
    };
  } catch (err) {
    if (err.category) throw err;
    throw classifyError(err, "getRoutingCost");
  }
};

