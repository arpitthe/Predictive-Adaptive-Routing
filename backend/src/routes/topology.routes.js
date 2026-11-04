import express from "express";
import { getNetworkTopology } from "../controllers/topology.controller.js";

const router = express.Router();

router.get("/", getNetworkTopology);

export default router;