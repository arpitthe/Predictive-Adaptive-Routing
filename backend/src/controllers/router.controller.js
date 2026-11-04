import NetworkRouter from "../models/NetworkRouter.js";
import NetworkLink from "../models/NetworkLink.js";

// Create a router
export const createRouter = async (req, res) => {
  try {
    const { routerId, name, ipAddress, status, location } = req.body;

    const router = await NetworkRouter.create({
      routerId,
      name,
      ipAddress,
      status,
      location,
    });

    res.status(201).json({
      success: true,
      message: "Router created successfully",
      data: router,
    });
  } catch (error) {
    res.status(error.code === 11000 ? 409 : 400).json({
      success: false,
      message:
        error.code === 11000
          ? "Router ID already exists"
          : error.message,
    });
  }
};

// Get all routers
export const getAllRouters = async (req, res) => {
  try {
    const routers = await NetworkRouter.find().sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: routers.length,
      data: routers,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Get router by MongoDB ID
export const getRouterById = async (req, res) => {
  try {
    const router = await NetworkRouter.findById(req.params.id);

    if (!router) {
      return res.status(404).json({
        success: false,
        message: "Router not found",
      });
    }

    res.status(200).json({
      success: true,
      data: router,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: "Invalid router ID",
    });
  }
};

// Update router
export const updateRouter = async (req, res) => {
  try {
    const router = await NetworkRouter.findByIdAndUpdate(
      req.params.id,
      req.body,
      {
        new: true,
        runValidators: true,
      }
    );

    if (!router) {
      return res.status(404).json({
        success: false,
        message: "Router not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Router updated successfully",
      data: router,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

// Delete router
export const deleteRouter = async (req, res) => {
  try {
    const router = await NetworkRouter.findById(req.params.id);

    if (!router) {
      return res.status(404).json({
        success: false,
        message: "Router not found",
      });
    }

    const connectedLinks = await NetworkLink.exists({
      $or: [
        { sourceRouter: router._id },
        { destinationRouter: router._id },
      ],
    });

    if (connectedLinks) {
      return res.status(409).json({
        success: false,
        message: "Cannot delete router while network links reference it",
      });
    }

    await router.deleteOne();

    res.status(200).json({
      success: true,
      message: "Router deleted successfully",
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};