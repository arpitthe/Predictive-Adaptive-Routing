import Telemetry from "../models/Telemetry.js";
import NetworkLink from "../models/NetworkLink.js";

// Submit a new telemetry measurement
export const createTelemetry = async (req, res) => {
  try {
    const {
      linkId,
      utilizationPct,
      throughputMbps,
      packetLossPct,
      source,
      measuredAt,
    } = req.body;

    if (!linkId || utilizationPct === undefined) {
      return res.status(400).json({
        success: false,
        message: "linkId and utilizationPct are required",
      });
    }

    const utilization = Number(utilizationPct);

    if (
      !Number.isFinite(utilization) ||
      utilization < 0 ||
      utilization > 100
    ) {
      return res.status(400).json({
        success: false,
        message: "Utilization must be a number between 0 and 100",
      });
    }

    if (
      throughputMbps !== undefined &&
      throughputMbps !== null &&
      (!Number.isFinite(Number(throughputMbps)) ||
        Number(throughputMbps) < 0)
    ) {
      return res.status(400).json({
        success: false,
        message: "Throughput must be a non-negative number",
      });
    }

    if (
      packetLossPct !== undefined &&
      packetLossPct !== null &&
      (!Number.isFinite(Number(packetLossPct)) ||
        Number(packetLossPct) < 0 ||
        Number(packetLossPct) > 100)
    ) {
      return res.status(400).json({
        success: false,
        message: "Packet loss must be between 0 and 100",
      });
    }

    if (
      measuredAt !== undefined &&
      Number.isNaN(Date.parse(measuredAt))
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid measurement timestamp",
      });
    }

    const link = await NetworkLink.findOne({ linkId });

    if (!link) {
      return res.status(404).json({
        success: false,
        message: `Network link ${linkId} was not found`,
      });
    }

    if (link.status !== "active") {
      return res.status(409).json({
        success: false,
        message: "Cannot submit telemetry for an inactive link",
      });
    }

    const telemetry = await Telemetry.create({
      link: link._id,
      linkId: link.linkId,
      utilizationPct: utilization,
      throughputMbps:
        throughputMbps === undefined || throughputMbps === null
          ? null
          : Number(throughputMbps),
      packetLossPct:
        packetLossPct === undefined || packetLossPct === null
          ? null
          : Number(packetLossPct),
      source: source || "manual",
      measuredAt: measuredAt ? new Date(measuredAt) : new Date(),
    });

    // Update the current utilization on the network link
    link.utilizationPct = utilization;
    await link.save();

    res.status(201).json({
      success: true,
      message: "Telemetry recorded and network link updated successfully",
      data: {
        telemetry,
        updatedLink: {
          linkId: link.linkId,
          utilizationPct: link.utilizationPct,
        },
      },
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

// Get all telemetry measurements
export const getAllTelemetry = async (req, res) => {
  try {
    const { linkId } = req.query;

    const limit = Math.min(
      Math.max(parseInt(req.query.limit, 10) || 100, 1),
      500
    );

    const filter = {};

    if (linkId) {
      filter.linkId = linkId;
    }

    const telemetry = await Telemetry.find(filter)
      .populate("link", "linkId bandwidthMbps latencyMs")
      .sort({ measuredAt: -1 })
      .limit(limit);

    res.status(200).json({
      success: true,
      count: telemetry.length,
      data: telemetry,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Get telemetry history for a particular network link
export const getTelemetryByLink = async (req, res) => {
  try {
    const { linkId } = req.params;

    const link = await NetworkLink.findOne({ linkId });

    if (!link) {
      return res.status(404).json({
        success: false,
        message: `Network link ${linkId} was not found`,
      });
    }

    const limit = Math.min(
      Math.max(parseInt(req.query.limit, 10) || 100, 1),
      500
    );

    const telemetry = await Telemetry.find({ link: link._id })
      .sort({ measuredAt: 1 })
      .limit(limit);

    res.status(200).json({
      success: true,
      link: {
        linkId: link.linkId,
        bandwidthMbps: link.bandwidthMbps,
        currentUtilizationPct: link.utilizationPct,
      },
      count: telemetry.length,
      data: telemetry,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Advance logical replay by one 5-minute interval (Demonstration mode)
export const stepReplay = async (req, res) => {
  try {
    const { advanceReplayStep } = await import("../storage/demoData.js");
    const result = await advanceReplayStep();
    res.status(200).json({
      success: true,
      message: "Advanced replay by 5-minute logical step",
      data: result,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Reseed demo topology and telemetry (Demonstration mode)
export const reseedDemo = async (req, res) => {
  try {
    const { seedDemoData } = await import("../storage/demoData.js");
    const summary = await seedDemoData({ clearExisting: true });
    res.status(200).json({
      success: true,
      message: "Demo topology and telemetry history reseeded successfully",
      data: summary,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
