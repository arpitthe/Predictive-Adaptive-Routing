/**
 * routing.service.js
 *
 * Orchestrates topology-wide routing cost computation and Dijkstra
 * shortest-path selection.
 *
 * Key design decisions
 * --------------------
 * - Uses a SINGLE batch call to the Python prediction service for all
 *   usable links instead of one HTTP round-trip per link (N+1 fix).
 * - Never calls its own backend's HTTP API (no self-referencing loop).
 * - Links whose prediction fails receive HIGH_PENALTY_COST so that
 *   Dijkstra avoids them without blocking the entire route computation.
 * - NaN / Infinity values are explicitly rejected before entering
 *   Dijkstra to prevent silent cost corruption.
 */

import NetworkLink from "../models/NetworkLink.js";
import Telemetry from "../models/Telemetry.js";
import {
  validateTelemetryHistory,
  buildMlPayload,
  predictBatch,
  getRoutingCost,
  HIGH_PENALTY_COST,
  REQUIRED_OBSERVATIONS,
} from "./prediction.service.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Retrieve and assign a stable 1–30 ML link index for a NetworkLink
 * document. Saves the index to the database on first assignment.
 *
 * @param {object} link  Mongoose NetworkLink document (mutable).
 * @returns {Promise<number>}
 */
const getStableLinkIndex = async (link) => {
  if (link.mlLinkIndex) {
    return link.mlLinkIndex;
  }

  const { default: NetworkLink } = await import("../models/NetworkLink.js");

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

/**
 * Fetch the most recent REQUIRED_OBSERVATIONS telemetry records for a
 * link and return them in oldest-first order.
 *
 * @param {object} link  Mongoose NetworkLink document with `_id` populated.
 * @returns {Promise<Array<object>|null>}  History array, or null if unavailable.
 */
const fetchLinkHistory = async (link) => {
  const telemetry = await Telemetry.find({ link: link._id })
    .sort({ measuredAt: -1 })
    .limit(REQUIRED_OBSERVATIONS)
    .lean();

  if (telemetry.length < REQUIRED_OBSERVATIONS) {
    return null;
  }

  // DB returns newest-first; reverse to oldest-first for the ML payload.
  return telemetry.reverse();
};

/**
 * Dijkstra's algorithm over the active network topology.
 *
 * Links are treated as bidirectional (consistent with the initial
 * simulator behaviour). Edge weights must be finite positive numbers;
 * callers are responsible for filtering invalid costs before invoking
 * this function.
 *
 * @param {Array<{routerId: string}>}                            routers
 * @param {Array<{sourceRouter: {routerId:string}, destinationRouter: {routerId:string}, linkId:string, routingCost:number}>} links
 * @param {string} sourceId
 * @param {string} destinationId
 * @returns {{ routerPath: string[], linkPath: string[], totalCost: number } | null}
 */
export const findShortestPath = (routers, links, sourceId, destinationId) => {
  const distances = new Map();
  const previous = new Map();
  const visited = new Set();
  const adjacency = new Map();

  routers.forEach((router) => {
    distances.set(router.routerId, Infinity);
    adjacency.set(router.routerId, []);
  });

  links.forEach((link) => {
    const source = link.sourceRouter.routerId;
    const destination = link.destinationRouter.routerId;

    adjacency.get(source)?.push({
      routerId: destination,
      linkId: link.linkId,
      cost: link.routingCost,
    });

    // Bidirectional treatment consistent with the original implementation.
    adjacency.get(destination)?.push({
      routerId: source,
      linkId: link.linkId,
      cost: link.routingCost,
    });
  });

  distances.set(sourceId, 0);

  while (visited.size < routers.length) {
    let current = null;
    let smallestDistance = Infinity;

    for (const [routerId, distance] of distances.entries()) {
      if (!visited.has(routerId) && distance < smallestDistance) {
        smallestDistance = distance;
        current = routerId;
      }
    }

    if (current === null || smallestDistance === Infinity) {
      break;
    }

    if (current === destinationId) {
      break;
    }

    visited.add(current);

    for (const neighbor of adjacency.get(current) ?? []) {
      if (visited.has(neighbor.routerId)) {
        continue;
      }

      const candidateDistance = distances.get(current) + neighbor.cost;

      if (candidateDistance < distances.get(neighbor.routerId)) {
        distances.set(neighbor.routerId, candidateDistance);
        previous.set(neighbor.routerId, {
          routerId: current,
          linkId: neighbor.linkId,
        });
      }
    }
  }

  if (distances.get(destinationId) === Infinity) {
    return null;
  }

  const routerPath = [destinationId];
  const linkPath = [];
  let current = destinationId;

  while (current !== sourceId) {
    const step = previous.get(current);

    if (!step) {
      return null;
    }

    linkPath.unshift(step.linkId);
    current = step.routerId;
    routerPath.unshift(current);
  }

  return {
    routerPath,
    linkPath,
    totalCost: distances.get(destinationId),
  };
};

// ---------------------------------------------------------------------------
// Exported
// ---------------------------------------------------------------------------

/**
 * Calculate the best route between two routers using Chronos-2 predicted
 * utilisation as the edge-cost metric.
 *
 * Algorithm
 * ---------
 * 1. Load all active routers and links from the database.
 * 2. Fetch the last 6 telemetry observations for every usable link in
 *    parallel (Promise.all).
 * 3. Issue a SINGLE batch prediction request for all links that have
 *    sufficient history.
 * 4. For each link obtain a routing cost from the Python /routing-cost
 *    endpoint (these calls are independent stateless requests and are
 *    issued in parallel via Promise.all).
 * 5. Links with insufficient history or failed predictions receive
 *    HIGH_PENALTY_COST so they can still participate in Dijkstra but are
 *    strongly discouraged.
 * 6. Run Dijkstra over the cost-annotated topology.
 * 7. Return the full routing decision object including per-link details.
 *
 * @param {string} sourceId
 * @param {string} destinationId
 * @returns {Promise<object>}  Routing decision payload ready for database storage.
 * @throws {Error}  Hard failures: unknown routers, no links, no path found.
 */
export const calculateBestRoute = async (sourceId, destinationId) => {
  // -------------------------------------------------------------------------
  // 1. Load topology
  // -------------------------------------------------------------------------
  const { default: NetworkRouter } = await import("../models/NetworkRouter.js");

  const [routers, links] = await Promise.all([
    NetworkRouter.find({ status: "active" }).sort({ routerId: 1 }),
    NetworkLink.find({ status: "active" })
      .populate("sourceRouter", "routerId name")
      .populate("destinationRouter", "routerId name")
      .sort({ linkId: 1 }),
  ]);

  const routerIds = new Set(routers.map((r) => r.routerId));

  if (!routerIds.has(sourceId) || !routerIds.has(destinationId)) {
    throw new Error(
      "Source or destination router does not exist or is inactive."
    );
  }

  if (sourceId === destinationId) {
    throw new Error("Source and destination routers must be different.");
  }

  const usableLinks = links.filter(
    (link) =>
      link.sourceRouter &&
      link.destinationRouter &&
      routerIds.has(link.sourceRouter.routerId) &&
      routerIds.has(link.destinationRouter.routerId)
  );

  if (usableLinks.length === 0) {
    throw new Error("No active network links are available.");
  }

  // -------------------------------------------------------------------------
  // 2. Fetch telemetry history for all links in parallel
  // -------------------------------------------------------------------------
  const historyResults = await Promise.all(
    usableLinks.map((link) => fetchLinkHistory(link))
  );

  // -------------------------------------------------------------------------
  // 3. Assign ML link indexes and build payloads for links with valid history
  // -------------------------------------------------------------------------

  // Separate links into those that have enough data and those that don't.
  const readyLinks = []; // { link, history, index }
  const unreadyLinks = []; // { link, reason }

  await Promise.all(
    usableLinks.map(async (link, i) => {
      const history = historyResults[i];

      if (!history) {
        unreadyLinks.push({
          link,
          reason: `Insufficient telemetry history (< ${REQUIRED_OBSERVATIONS} observations).`,
        });
        return;
      }

      const validation = validateTelemetryHistory(history);

      if (!validation.valid) {
        unreadyLinks.push({
          link,
          reason: `Telemetry validation failed: ${validation.reason}`,
        });
        return;
      }

      const mlLinkIndex = await getStableLinkIndex(link);
      readyLinks.push({ link, history, mlLinkIndex });
    })
  );

  // -------------------------------------------------------------------------
  // 4. Single batch ML call for all ready links
  // -------------------------------------------------------------------------

  // Map from link-string key to prediction result or penalty object.
  // We also keep an index from linkId → mlPayload link-string key for
  // cost resolution later.
  const linkIdToKey = new Map(); // linkId → "SrcRouter-DstRouter" string
  let predictionMap = new Map(); // link-string → prediction response or error

  if (readyLinks.length > 0) {
    const payloads = readyLinks.map(({ link, history, mlLinkIndex }) => {
      const payload = buildMlPayload(link, history, mlLinkIndex);
      linkIdToKey.set(link.linkId, payload.link);
      return payload;
    });

    try {
      predictionMap = await predictBatch(payloads);
    } catch (batchErr) {
      // The entire batch call failed (network down, timeout, etc.).
      // Every ready link gets the penalty cost; routing can still proceed
      // using penalty-weighted links.
      console.error(
        "[routing.service] Batch ML call failed; applying penalty costs to all links.",
        batchErr.message
      );

      for (const { link } of readyLinks) {
        const key = linkIdToKey.get(link.linkId);
        if (key) {
          predictionMap.set(key, {
            status: "error",
            error: batchErr.message,
            link: key,
          });
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // 5. Resolve routing costs (parallel /routing-cost calls for ready links)
  // -------------------------------------------------------------------------

  /**
   * @typedef {{
   *   linkId: string,
   *   sourceRouter: object,
   *   destinationRouter: object,
   *   latencyMs: number,
   *   routingCost: number,
   *   predictedUtilizationPct: number,
   *   congestionRisk: string,
   *   predictionStatus: "ok"|"error"|"insufficient_history",
   *   predictionModel: string|null,
   *   predictionError: string|null,
   * }} EvaluatedLink
   */

  const evaluatedLinks = await Promise.all(
    usableLinks.map(async (link) => {
      // Links without enough history go straight to penalty.
      const unready = unreadyLinks.find((u) => u.link.linkId === link.linkId);

      if (unready) {
        return {
          linkId: link.linkId,
          sourceRouter: link.sourceRouter,
          destinationRouter: link.destinationRouter,
          latencyMs: link.latencyMs,
          routingCost: HIGH_PENALTY_COST,
          predictedUtilizationPct: -1,
          congestionRisk: "UNKNOWN",
          predictionStatus: "insufficient_history",
          predictionModel: null,
          predictionError: unready.reason,
        };
      }

      const key = linkIdToKey.get(link.linkId);
      const prediction = key ? predictionMap.get(key) : null;

      // Prediction failed for this link.
      if (!prediction || prediction.status === "error") {
        return {
          linkId: link.linkId,
          sourceRouter: link.sourceRouter,
          destinationRouter: link.destinationRouter,
          latencyMs: link.latencyMs,
          routingCost: HIGH_PENALTY_COST,
          predictedUtilizationPct: -1,
          congestionRisk: "UNKNOWN",
          predictionStatus: "error",
          predictionModel: null,
          predictionError: prediction?.error ?? "Prediction result missing.",
        };
      }

      // Happy path: get routing cost from Python.
      try {
        const { cost, risk } = await getRoutingCost(
          prediction.predicted_utilization_percent,
          link.linkId,
          link.utilizationPct ?? null
        );

        // Paranoia guard: cost must be a finite positive number.
        const safeCost =
          Number.isFinite(cost) && cost >= 0 ? cost : HIGH_PENALTY_COST;

        return {
          linkId: link.linkId,
          sourceRouter: link.sourceRouter,
          destinationRouter: link.destinationRouter,
          latencyMs: link.latencyMs,
          routingCost: safeCost,
          predictedUtilizationPct: prediction.predicted_utilization_percent,
          congestionRisk: risk,
          predictionStatus: "ok",
          predictionModel: prediction.model ?? null,
          predictionError: null,
        };
      } catch (costErr) {
        console.error(
          `[routing.service] Routing-cost call failed for link ${link.linkId}:`,
          costErr.message
        );

        return {
          linkId: link.linkId,
          sourceRouter: link.sourceRouter,
          destinationRouter: link.destinationRouter,
          latencyMs: link.latencyMs,
          routingCost: HIGH_PENALTY_COST,
          predictedUtilizationPct: prediction.predicted_utilization_percent,
          congestionRisk: "UNKNOWN",
          predictionStatus: "error",
          predictionModel: prediction.model ?? null,
          predictionError: `Routing-cost call failed: ${costErr.message}`,
        };
      }
    })
  );

  // -------------------------------------------------------------------------
  // 6. Prepare Dijkstra input — links must have finite positive costs
  // -------------------------------------------------------------------------
  const dijkstraLinks = evaluatedLinks.map((el) => ({
    ...el,
    // Final safety net: replace any residual NaN / Infinity.
    routingCost: Number.isFinite(el.routingCost) && el.routingCost >= 0
      ? el.routingCost
      : HIGH_PENALTY_COST,
  }));

  // -------------------------------------------------------------------------
  // 7. Dijkstra
  // -------------------------------------------------------------------------
  const bestPath = findShortestPath(
    routers,
    dijkstraLinks,
    sourceId,
    destinationId
  );

  if (!bestPath) {
    throw new Error("No connected path exists between these routers.");
  }

  // -------------------------------------------------------------------------
  // 8. Build and return the routing decision
  // -------------------------------------------------------------------------
  return {
    sourceRouter: sourceId,
    destinationRouter: destinationId,
    routerPath: bestPath.routerPath,
    linkPath: bestPath.linkPath,
    totalCost: bestPath.totalCost,
    evaluatedLinks: evaluatedLinks.map((el) => ({
      linkId: el.linkId,
      predictedUtilizationPct: el.predictedUtilizationPct,
      congestionRisk: el.congestionRisk,
      routingCost: el.routingCost,
      predictionStatus: el.predictionStatus,
      predictionModel: el.predictionModel,
      predictionError: el.predictionError,
    })),
    algorithm: "Dijkstra",
    routingPolicy: "Chronos-2 predictive utilization cost",
  };
};
