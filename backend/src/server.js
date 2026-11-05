import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";

import connectDB from "./config/database.js";
import { initStorage, getStorageMode } from "./storage/index.js";

import healthRoutes from "./routes/health.routes.js";
import routerRoutes from "./routes/router.routes.js";
import linkRoutes from "./routes/link.routes.js";
import topologyRoutes from "./routes/topology.routes.js";
import telemetryRoutes from "./routes/telemetry.routes.js";
import predictionRoutes from "./routes/prediction.routes.js";
import routingRoutes from "./routes/routing.routes.js";
import gns3Routes from "./routes/gns3.routes.js";
import demoRoutes from "./routes/demo.routes.js";

dotenv.config();

const app = express();

// Configurable CORS origins (comma-separated in env, or wildcard *)
const corsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map((o) => o.trim())
  : "*";

// Middleware
app.use(helmet());
app.use(cors({ origin: corsOrigins }));
app.use(express.json({ limit: "2mb" }));
app.use(morgan("dev"));

// Root endpoint
app.get("/", (req, res) => {
  res.status(200).json({
    message: "Predictive Adaptive Routing API",
    status: "online",
    storageMode: getStorageMode(),
  });
});

// API routes
app.use("/api/health", healthRoutes);
app.use("/api/routers", routerRoutes);
app.use("/api/links", linkRoutes);
app.use("/api/topology", topologyRoutes);
app.use("/api/telemetry", telemetryRoutes);
app.use("/api/predictions", predictionRoutes);
app.use("/api/routing", routingRoutes);
app.use("/api/gns3", gns3Routes);
app.use("/api/demo", demoRoutes);

// Not found handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
});

// Server configuration
const PORT = process.env.PORT || 5001;

// Start server
const startServer = async () => {
  try {
    const storageInfo = await initStorage(connectDB);

    app.listen(PORT, () => {
      console.log("-----------------------------------------");
      console.log("PREDICTIVE ADAPTIVE ROUTING BACKEND");
      console.log("-----------------------------------------");
      console.log(`Server:       http://localhost:${PORT}`);
      console.log(`Storage Mode: ${storageInfo.mode.toUpperCase()}`);
      console.log(`Health:       http://localhost:${PORT}/api/health`);
      console.log(`Routers:      http://localhost:${PORT}/api/routers`);
      console.log(`Links:        http://localhost:${PORT}/api/links`);
      console.log(`Topology:     http://localhost:${PORT}/api/topology`);
      console.log(`Telemetry:    http://localhost:${PORT}/api/telemetry`);
      console.log(`Predictions:  http://localhost:${PORT}/api/predictions`);
      console.log(`Routing:      http://localhost:${PORT}/api/routing`);
      console.log(`GNS3:         http://localhost:${PORT}/api/gns3/status`);
      console.log(`Demo API:     http://localhost:${PORT}/api/demo/state`);
      console.log("-----------------------------------------");
    });
  } catch (error) {
    console.error("Server startup failed:", error.message);
    process.exit(1);
  }
};

startServer();
