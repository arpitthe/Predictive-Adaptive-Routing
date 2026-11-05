import express from "express";
import { checkHealth as checkMlHealth } from "../services/prediction.service.js";
import { getStorageStatus } from "../storage/index.js";
import { checkGns3Status } from "../services/gns3.service.js";

const router = express.Router();

router.get("/", async (req, res) => {
  const [storage, mlHealth, gns3] = await Promise.all([
    getStorageStatus(),
    checkMlHealth(),
    checkGns3Status(),
  ]);

  // In memory mode, storage is healthy by definition.
  // In mongodb mode, database connection must be active.
  const storageHealthy =
    storage.mode === "memory" ? true : storage.status === "connected";

  const isDegraded =
    !storageHealthy || !mlHealth.available || !mlHealth.modelLoaded;

  res.status(200).json({
    success: true,
    status: isDegraded ? "degraded" : "healthy",
    message: isDegraded
      ? "Predictive Adaptive Routing Backend is running in degraded mode"
      : "Predictive Adaptive Routing Backend is fully operational",
    backend: "online",
    storageMode: storage.mode,
    storage,
    mlService: mlHealth,
    gns3,
    timestamp: new Date().toISOString(),
  });
});

export default router;
