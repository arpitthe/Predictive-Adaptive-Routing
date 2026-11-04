
import axios from "axios";

import NetworkLink from "../models/NetworkLink.js";
import Telemetry from "../models/Telemetry.js";

const INTERVAL_MS = 5 * 60 * 1000;
const INTERVAL_TOLERANCE_MS = 60 * 1000;
const REQUIRED_OBSERVATIONS = 6;

const getStableLinkIndex = async (link) => {
  if (link.mlLinkIndex) {
    return link.mlLinkIndex;
  }

  const latestIndexedLink = await NetworkLink.findOne({
    mlLinkIndex: { $exists: true },
  }).sort({ mlLinkIndex: -1 });

  const nextIndex = (latestIndexedLink?.mlLinkIndex || 0) + 1;

  if (nextIndex > 30) {
    throw new Error(
      "ML link index limit reached. The ML service supports indexes 1–30."
    );
  }

  link.mlLinkIndex = nextIndex;
  await link.save();

  return nextIndex;
};

const calculateTrend = (values) => {
  const count = values.length;
  const meanX = (count - 1) / 2;
  const meanY = values.reduce((sum, value) => sum + value, 0) / count;

  let numerator = 0;
  let denominator = 0;

  values.forEach((value, index) => {
    numerator += (index - meanX) * (value - meanY);
    denominator += (index - meanX) ** 2;
  });

  return denominator === 0 ? 0 : numerator / denominator;
};

export const getPredictionForLink = async (req, res) => {
  try {
    const { linkId } = req.params;

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

    const telemetry = await Telemetry.find({ link: link._id })
      .sort({ measuredAt: -1 })
      .limit(REQUIRED_OBSERVATIONS)
      .lean();

    if (telemetry.length < REQUIRED_OBSERVATIONS) {
      return res.status(422).json({
        success: false,
        message: "Insufficient telemetry history for Chronos-2.",
        requiredObservations: REQUIRED_OBSERVATIONS,
        availableObservations: telemetry.length,
        requiredIntervalMinutes: 5,
      });
    }

    // Convert newest-first database results into oldest-first history.
    const history = telemetry.reverse();

    // Verify that observations are approximately five minutes apart.
    for (let index = 1; index < history.length; index += 1) {
      const previousTime = new Date(history[index - 1].measuredAt).getTime();
      const currentTime = new Date(history[index].measuredAt).getTime();
      const difference = currentTime - previousTime;

      const minimumInterval = INTERVAL_MS - INTERVAL_TOLERANCE_MS;
      const maximumInterval = INTERVAL_MS + INTERVAL_TOLERANCE_MS;

      if (
        difference < minimumInterval ||
        difference > maximumInterval
      ) {
        return res.status(422).json({
          success: false,
          message:
            "Telemetry observations must be approximately five minutes apart.",
          requiredIntervalMinutes: 5,
          allowedToleranceSeconds: 60,
          invalidGapMinutes: Number((difference / 60000).toFixed(2)),
          history: history.map((item) => ({
            utilizationPct: item.utilizationPct,
            measuredAt: item.measuredAt,
          })),
        });
      }
    }

    const values = history.map((item) => item.utilizationPct);

    const lastThree = values.slice(-3);

    const mean = lastThree.reduce((sum, value) => sum + value, 0) / 3;

    const variance =
      lastThree.reduce(
        (sum, value) => sum + (value - mean) ** 2,
        0
      ) / 3;

    const standardDeviation = Math.sqrt(variance);

    const currentObservation = history[history.length - 1];

    const capacityKbps = link.bandwidthMbps * 1000;

    const trafficKbps =
      currentObservation.throughputMbps !== null &&
      currentObservation.throughputMbps !== undefined
        ? currentObservation.throughputMbps * 1000
        : (capacityKbps * currentObservation.utilizationPct) / 100;

    const mlLinkIndex = await getStableLinkIndex(link);

    const sourceId = link.sourceRouter?.routerId || "SOURCE";
    const destinationId =
      link.destinationRouter?.routerId || "DESTINATION";

    const mlPayload = {
      link: `${sourceId}-${destinationId}`,
      link_index: mlLinkIndex,
      capacity_kbps: capacityKbps,
      traffic_kbps: trafficKbps,

      utilization_pct: values[5],
      util_lag_1: values[4],
      util_lag_2: values[3],
      util_lag_3: values[2],
      util_lag_4: values[1],
      util_lag_5: values[0],

      util_mean_3: mean,
      util_std_3: standardDeviation,
      util_trend_3: calculateTrend(lastThree),

      timestamp: new Date(currentObservation.measuredAt).toISOString(),
    };

    const mlServiceUrl = (
      process.env.ML_SERVICE_URL || "http://127.0.0.1:8000"
    ).replace(/\/+$/, "");

    const mlResponse = await axios.post(
      `${mlServiceUrl}/predict`,
      mlPayload,
      { timeout: 120000 }
    );

    return res.status(200).json({
      success: true,
      linkId: link.linkId,
      prediction: mlResponse.data,
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

    if (error.response) {
      return res.status(502).json({
        success: false,
        message: "The ML prediction service returned an error.",
        mlServiceStatus: error.response.status,
        mlServiceError: error.response.data,
      });
    }

    if (error.code === "ECONNREFUSED" || error.code === "ETIMEDOUT") {
      return res.status(503).json({
        success: false,
        message:
          "Cannot connect to the Python ML service. Make sure FastAPI is running.",
      });
    }

    return res.status(500).json({
      success: false,
      message: error.message || "Prediction failed.",
    });
  }
};
