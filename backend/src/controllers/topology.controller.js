import NetworkRouter from "../models/NetworkRouter.js";
import NetworkLink from "../models/NetworkLink.js";

export const getNetworkTopology = async (req, res) => {
  try {
    const [routers, links] = await Promise.all([
      NetworkRouter.find().sort({ routerId: 1 }),
      NetworkLink.find()
        .populate("sourceRouter", "routerId name ipAddress")
        .populate("destinationRouter", "routerId name ipAddress")
        .sort({ linkId: 1 }),
    ]);

    res.status(200).json({
      success: true,
      data: {
        routers,
        links,
        summary: {
          totalRouters: routers.length,
          totalLinks: links.length,
          activeRouters: routers.filter(
            (router) => router.status === "active"
          ).length,
          activeLinks: links.filter(
            (link) => link.status === "active"
          ).length,
        },
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};