import express from "express";

import {
  createTelemetry,
  getAllTelemetry,
  getTelemetryByLink,
  stepReplay,
  reseedDemo,
} from "../controllers/telemetry.controller.js";

const router = express.Router();

router.post("/", createTelemetry);
router.get("/", getAllTelemetry);
router.get("/link/:linkId", getTelemetryByLink);

// Demonstration replay controls
router.post("/replay-step", stepReplay);
router.post("/seed", reseedDemo);

export default router;
