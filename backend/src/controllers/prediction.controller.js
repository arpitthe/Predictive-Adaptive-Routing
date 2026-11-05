/**
 * prediction.controller.js
 *
 * Express route handler for `POST /api/predictions/:linkId`.
 *
 * Responsibilities
 * ----------------
 * - Look up the NetworkLink document and validate its status.
 * - Fetch and validate recent telemetry history from the database.
 * - Delegate ML payload construction and prediction to prediction.service.js.
 * - Return a consistent JSON response or a well-typed error.
 *
 * This controller does NOT contain ML business logic. All ML communication
 * is centralised in prediction.service.js.
 */

import NetworkLink from "../models/NetworkLink.js";
import Telemetry from "../models/Telemetry.js";
import {
  validateTelemetryHistory,
  buildMlPayload,
  predictSingle,
  REQUIRED_OBSERVATIONS,
} from "../services/prediction.service.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Get or lazily assign a stable 1–30 ML link index for a NetworkLink.
 * Saves the index to the database on first assignment.
 *
 * @param {object} link  Mongoose NetworkLink document (mutable).
 * @returns {Promise<number>}
 */
const getStableLinkIndex = async (link) => {
  if (link.mlLinkIndex) {
    return link.mlLinkIndex;
  }

  const latestIndexedLink = await NetworkLink.findOne({
    mlLinkIndex: { $exists: true },
  }).sort({ mlLinkIndex: -1 });

  const nextIndex = (latestIndexedLink?.mlLinkIndex ?? 0) + 1;

  if (nextIndex > 30) {
    throw new Error(
      "ML link index limit reached. The ML service supports indexes 1–30."
    );
  }

  link.mlLinkIndex = nextIndex;
  await link.save();

  return nextIndex;
};

// ---------------------------------------------------------------------------
// Exported handler
// ---------------------------------------------------------------------------

/**
 * GET a Chronos-2 utilisation forecast for a single network link.
 *
 * Route: POST /api/predictions/:linkId
 *
 * Query parameters
 * ----------------
 * allow_fallback  (boolean, default false)
 *   When truthy, the Python service may fall back to the Moving Average
 *   model if Chronos-2 is unavailable. The response will indicate which
 *   model was used.
 *
 * Responses
 * ---------
 * 200  Prediction succeeded.
 * 400  Link is not active.
 * 404  Link not found.
 * 422  Insufficient or irregularly spaced telemetry.
 * 502  ML service returned an error response.
 * 503  ML service is unreachable.
 * 500  Unexpected server error.
 */
export const getPredictionForLink = async (req, res) => {
  try {
    const { linkId } = req.params;
    const allowFallback =
      req.query.allow_fallback === "true" ||
      req.query.allow_fallback === "1";

    // -----------------------------------------------------------------------
    // 1. Resolve the link
    // -----------------------------------------------------------------------
    const link = await NetworkLink.findOne({ linkId })
      .populate("sourceRouter", "routerId")
      .populate("destinationRouter", "routerId");

    if (!link) {
      return res.status(404).json({
        success: false,
        message: `Network link ${linkId} was not found.`,
      });
    }

    if (link.status !== "active") {
      return res.status(400).json({
        success: false,
        message: "Cannot predict utilization for an inactive link.",
      });
    }

    // -----------------------------------------------------------------------
    // 2. Fetch recent telemetry (newest-first from DB, then reverse)
    // -----------------------------------------------------------------------
    const telemetry = await Telemetry.find({ link: link._id })
      .sort({ measuredAt: -1 })
      .limit(REQUIRED_OBSERVATIONS)
      .lean();

    // Reverse to oldest-first before validation and payload construction.
    const history = telemetry.reverse();

    // -----------------------------------------------------------------------
    // 3. Validate telemetry
    // -----------------------------------------------------------------------
    const validation = validateTelemetryHistory(history);

    if (!validation.valid) {
      if (validation.reason === "INSUFFICIENT_HISTORY") {
        return res.status(422).json({
          success: false,
          message: "Insufficient telemetry history for Chronos-2.",
          requiredObservations: REQUIRED_OBSERVATIONS,
          availableObservations: validation.details.available,
          requiredIntervalMinutes: 5,
        });
      }

      // IRREGULAR_INTERVAL
      return res.status(422).json({
        success: false,
        message:
          "Telemetry observations must be approximately five minutes apart.",
        requiredIntervalMinutes: 5,
        allowedToleranceSeconds: 60,
        invalidGapMinutes: validation.details.actualGapMinutes,
        atIndex: validation.details.atIndex,
        history: history.map((item) => ({
          utilizationPct: item.utilizationPct,
          measuredAt: item.measuredAt,
        })),
      });
    }

    // -----------------------------------------------------------------------
    // 4. Build ML payload
    // -----------------------------------------------------------------------
    const mlLinkIndex = await getStableLinkIndex(link);
    const mlPayload = buildMlPayload(link, history, mlLinkIndex);

    const capacityKbps = (link.bandwidthMbps ?? 0) * 1000;
    const latestObs = history[history.length - 1];
    const trafficKbps =
      latestObs.throughputMbps != null
        ? latestObs.throughputMbps * 1000
        : (capacityKbps * latestObs.utilizationPct) / 100;

    // -----------------------------------------------------------------------
    // 5. Call the Python prediction service
    // -----------------------------------------------------------------------
    const prediction = await predictSingle(mlPayload, { allowFallback });

    return res.status(200).json({
      success: true,
      linkId: link.linkId,
      prediction,
      input: {
        observationsUsed: REQUIRED_OBSERVATIONS,
        intervalMinutes: 5,
        capacityKbps,
        trafficKbps,
        mlLinkIndex,
      },
    });
  } catch (error) {
    console.error("Prediction error:", error.message);

    // Errors classified by prediction.service.js
    if (error.category === "connection") {
      return res.status(503).json({
        success: false,
        message:
          "Cannot connect to the Python ML service. Make sure FastAPI is running.",
        detail: error.message,
      });
    }

    if (error.category === "timeout") {
      return res.status(503).json({
        success: false,
        message: "The ML service request timed out.",
        detail: error.message,
      });
    }

    if (error.category === "ml_server" || error.category === "ml_validation") {
      return res.status(502).json({
        success: false,
        message: "The ML prediction service returned an error.",
        mlServiceStatus: error.mlStatus ?? null,
        mlServiceError: error.mlBody ?? null,
        detail: error.message,
      });
    }

    // Unclassified (e.g. index limit exceeded, database error)
    return res.status(500).json({
      success: false,
      message: error.message || "Prediction failed.",
    });
  }
};
