/**
 * gns3.controller.js
 *
 * Controller handling GNS3 Network Emulation status, topology sync,
 * and live route application.
 */

import {
  checkGns3Status,
  getGns3Topology,
  applyRouteToGns3,
} from "../services/gns3.service.js";

export const getGns3Status = async (req, res) => {
  try {
    const status = await checkGns3Status();
    res.status(200).json({
      success: true,
      data: status,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const fetchGns3Topology = async (req, res) => {
  try {
    const topology = await getGns3Topology();
    res.status(200).json({
      success: true,
      data: topology,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

export const executeRouteInGns3 = async (req, res) => {
  try {
    const { sourceRouter, destinationRouter, routerPath, linkPath } = req.body;

    if (!sourceRouter || !destinationRouter || !Array.isArray(routerPath)) {
      return res.status(400).json({
        success: false,
        message: "sourceRouter, destinationRouter, and routerPath array are required.",
      });
    }

    const result = await applyRouteToGns3({
      sourceRouter,
      destinationRouter,
      routerPath,
      linkPath: linkPath || [],
    });

    const statusCode = result.applied ? 200 : 422;
    res.status(statusCode).json({
      success: result.applied,
      message: result.message,
      data: result,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

