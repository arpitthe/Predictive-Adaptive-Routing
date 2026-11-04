
import mongoose from "mongoose";

import RoutingDecision from "../models/RoutingDecision.js";
import { calculateBestRoute } from "../services/routing.service.js";

export const computeRoute = async (req, res) => {
  try {
    const { sourceRouter, destinationRouter } = req.body;

    if (
      typeof sourceRouter !== "string" ||
      typeof destinationRouter !== "string" ||
      !sourceRouter.trim() ||
      !destinationRouter.trim()
    ) {
      return res.status(400).json({
        success: false,
        message:
          "sourceRouter and destinationRouter are required as router IDs.",
      });
    }

    const result = await calculateBestRoute(
      sourceRouter.trim(),
      destinationRouter.trim()
    );

    const decision = await RoutingDecision.create(result);

    return res.status(200).json({
      success: true,
      message: "Best route calculated and saved successfully.",
      decision,
    });
  } catch (error) {
    console.error("Routing computation error:", error.message);

    const status = error.response?.status === 422 ? 422
      : error.response?.status ? 502
      : error.message.includes("does not exist") ||
        error.message.includes("must be different") ||
        error.message.includes("No active") ||
        error.message.includes("No connected")
        ? 400
        : 500;

    return res.status(status).json({
      success: false,
      message: error.response?.data?.message || error.message,
      details: error.response?.data || undefined,
    });
  }
};

export const getRoutingDecisions = async (req, res) => {
  try {
    const limit = Math.min(
      Math.max(Number.parseInt(req.query.limit, 10) || 20, 1),
      100
    );

    const decisions = await RoutingDecision.find()
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return res.status(200).json({
      success: true,
      count: decisions.length,
      data: decisions,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const getRoutingDecisionById = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid routing decision ID.",
      });
    }

    const decision = await RoutingDecision.findById(req.params.id);

    if (!decision) {
      return res.status(404).json({
        success: false,
        message: "Routing decision not found.",
      });
    }

    return res.status(200).json({
      success: true,
      data: decision,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
