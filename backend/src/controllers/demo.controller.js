/**
 * demo.controller.js
 *
 * Controller endpoints for the database-free demonstration controller.
 */

import {
  getFullDemoState,
  initializeDemoState,
  stepDemoState,
} from "../services/demo.service.js";

export const getState = async (req, res) => {
  try {
    const state = await getFullDemoState();
    res.status(200).json({
      success: true,
      data: state,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const initialize = async (req, res) => {
  try {
    const state = await initializeDemoState();
    res.status(200).json({
      success: true,
      message: "Demonstration network initialized successfully.",
      data: state,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const step = async (req, res) => {
  try {
    const state = await stepDemoState();
    res.status(200).json({
      success: true,
      message: `Advanced to ${state.stageTitle}`,
      data: state,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const reset = async (req, res) => {
  try {
    const state = await initializeDemoState();
    res.status(200).json({
      success: true,
      message: "Demonstration network reset to baseline.",
      data: state,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const run = async (req, res) => {
  try {
    // Step through to Stage 5 where the route change occurs
    await initializeDemoState();
    await stepDemoState(); // Stage 2
    await stepDemoState(); // Stage 3
    const finalState = await stepDemoState(); // Stage 4/5 Reroute
    res.status(200).json({
      success: true,
      message: "Executed Predictive Congestion Avoidance demonstration flow.",
      data: finalState,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

