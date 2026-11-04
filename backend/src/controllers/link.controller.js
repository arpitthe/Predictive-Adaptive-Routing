import NetworkLink from "../models/NetworkLink.js";
import NetworkRouter from "../models/NetworkRouter.js";

// Create a network link
export const createLink = async (req, res) => {
  try {
    const {
      linkId,
      sourceRouter,
      destinationRouter,
      bandwidthMbps,
      latencyMs,
      utilizationPct,
      status,
    } = req.body;

    if (sourceRouter === destinationRouter) {
      return res.status(400).json({
        success: false,
        message: "A router cannot connect to itself",
      });
    }

    const [source, destination] = await Promise.all([
      NetworkRouter.findById(sourceRouter),
      NetworkRouter.findById(destinationRouter),
    ]);

    if (!source || !destination) {
      return res.status(404).json({
        success: false,
        message: "Source or destination router does not exist",
      });
    }

    const link = await NetworkLink.create({
      linkId,
      sourceRouter,
      destinationRouter,
      bandwidthMbps,
      latencyMs,
      utilizationPct,
      status,
    });

    const populatedLink = await NetworkLink.findById(link._id)
      .populate("sourceRouter", "routerId name ipAddress")
      .populate("destinationRouter", "routerId name ipAddress");

    res.status(201).json({
      success: true,
      message: "Network link created successfully",
      data: populatedLink,
    });
  } catch (error) {
    res.status(error.code === 11000 ? 409 : 400).json({
      success: false,
      message:
        error.code === 11000
          ? "Link ID already exists"
          : error.message,
    });
  }
};

// Get all network links
export const getAllLinks = async (req, res) => {
  try {
    const links = await NetworkLink.find()
      .populate("sourceRouter", "routerId name ipAddress")
      .populate("destinationRouter", "routerId name ipAddress")
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: links.length,
      data: links,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Get link by ID
export const getLinkById = async (req, res) => {
  try {
    const link = await NetworkLink.findById(req.params.id)
      .populate("sourceRouter", "routerId name ipAddress")
      .populate("destinationRouter", "routerId name ipAddress");

    if (!link) {
      return res.status(404).json({
        success: false,
        message: "Network link not found",
      });
    }

    res.status(200).json({
      success: true,
      data: link,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: "Invalid network link ID",
    });
  }
};

// Update network link
export const updateLink = async (req, res) => {
  try {
    const allowedFields = [
      "sourceRouter",
      "destinationRouter",
      "bandwidthMbps",
      "latencyMs",
      "utilizationPct",
      "status",
    ];

    const updates = Object.fromEntries(
      Object.entries(req.body).filter(([key]) =>
        allowedFields.includes(key)
      )
    );

    const link = await NetworkLink.findById(req.params.id);

    if (!link) {
      return res.status(404).json({
        success: false,
        message: "Network link not found",
      });
    }

    const sourceId = updates.sourceRouter ?? link.sourceRouter.toString();
    const destinationId =
      updates.destinationRouter ?? link.destinationRouter.toString();

    if (sourceId === destinationId) {
      return res.status(400).json({
        success: false,
        message: "A router cannot connect to itself",
      });
    }

    if (updates.sourceRouter || updates.destinationRouter) {
      const [source, destination] = await Promise.all([
        NetworkRouter.findById(sourceId),
        NetworkRouter.findById(destinationId),
      ]);

      if (!source || !destination) {
        return res.status(404).json({
          success: false,
          message: "Source or destination router does not exist",
        });
      }
    }

    Object.assign(link, updates);
    await link.save();

    const updatedLink = await NetworkLink.findById(link._id)
      .populate("sourceRouter", "routerId name ipAddress")
      .populate("destinationRouter", "routerId name ipAddress");

    res.status(200).json({
      success: true,
      message: "Network link updated successfully",
      data: updatedLink,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

// Delete network link
export const deleteLink = async (req, res) => {
  try {
    const link = await NetworkLink.findByIdAndDelete(req.params.id);

    if (!link) {
      return res.status(404).json({
        success: false,
        message: "Network link not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Network link deleted successfully",
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};