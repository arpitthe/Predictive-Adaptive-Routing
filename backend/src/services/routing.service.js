
import axios from "axios";

import NetworkLink from "../models/NetworkLink.js";

const getBackendUrl = () =>
  `http://127.0.0.1:${process.env.PORT || 5001}`;

const getMlServiceUrl = () =>
  (process.env.ML_SERVICE_URL || "http://127.0.0.1:8000").replace(
    /\/+$/,
    ""
  );

// Get Chronos-2 prediction and calculate the corresponding routing cost.
const getLinkRoutingCost = async (link) => {
  const backendUrl = getBackendUrl();
  const mlUrl = getMlServiceUrl();

  const predictionResponse = await axios.post(
    `${backendUrl}/api/predictions/${encodeURIComponent(link.linkId)}`,
    {},
    { timeout: 130000 }
  );

  const prediction = predictionResponse.data.prediction;

  const costResponse = await axios.post(
    `${mlUrl}/routing-cost`,
    {
      predicted_utilization_percent:
        prediction.predicted_utilization_percent,
      current_metrics: {
        link: link.linkId,
        utilization_pct: link.utilizationPct,
      },
    },
    { timeout: 15000 }
  );

  return {
    linkId: link.linkId,
    predictedUtilizationPct:
      prediction.predicted_utilization_percent,
    congestionRisk: costResponse.data.risk,
    cost: costResponse.data.predicted_cost,
    latencyMs: link.latencyMs,
    predictionModel: prediction.model,
  };
};

// Dijkstra's algorithm over the active network topology.
const findShortestPath = (routers, links, sourceId, destinationId) => {
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

    // The initial simulator treats links as bidirectional.
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

    for (const neighbor of adjacency.get(current) || []) {
      if (visited.has(neighbor.routerId)) {
        continue;
      }

      const candidateDistance =
        distances.get(current) + neighbor.cost;

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

export const calculateBestRoute = async (sourceId, destinationId) => {
  const [routers, links] = await Promise.all([
    (await import("../models/NetworkRouter.js")).default.find({
      status: "active",
    }).sort({ routerId: 1 }),

    NetworkLink.find({ status: "active" })
      .populate("sourceRouter", "routerId name")
      .populate("destinationRouter", "routerId name")
      .sort({ linkId: 1 }),
  ]);

  const routerIds = new Set(routers.map((router) => router.routerId));

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

  // Every active link must have a valid forecast before route selection.
  const costResults = await Promise.all(
    usableLinks.map(async (link) => {
      const result = await getLinkRoutingCost(link);
      return { link, result };
    })
  );

  const routingLinks = costResults.map(({ link, result }) => ({
    ...result,
    sourceRouter: link.sourceRouter,
    destinationRouter: link.destinationRouter,
    routingCost: result.cost,
  }));

  const bestPath = findShortestPath(
    routers,
    routingLinks,
    sourceId,
    destinationId
  );

  if (!bestPath) {
    throw new Error("No connected path exists between these routers.");
  }

  return {
    sourceRouter: sourceId,
    destinationRouter: destinationId,
    routerPath: bestPath.routerPath,
    linkPath: bestPath.linkPath,
    totalCost: bestPath.totalCost,
    evaluatedLinks: routingLinks.map((link) => ({
      linkId: link.linkId,
      predictedUtilizationPct: link.predictedUtilizationPct,
      congestionRisk: link.congestionRisk,
      routingCost: link.routingCost,
    })),
    algorithm: "Dijkstra",
    routingPolicy: "Chronos-2 predictive utilization cost",
  };
};
