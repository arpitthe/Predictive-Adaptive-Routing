import express from "express";

import {
  createTelemetry,
  getAllTelemetry,
  getTelemetryByLink,
} from "../controllers/telemetry.controller.js";

const router = express.Router();

router.post("/", createTelemetry);

router.get("/", getAllTelemetry);

router.get("/link/:linkId", getTelemetryByLink);

export default router;