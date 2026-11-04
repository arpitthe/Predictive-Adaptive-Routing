
import express from "express";

import {
  computeRoute,
  getRoutingDecisions,
  getRoutingDecisionById,
} from "../controllers/routing.controller.js";

const router = express.Router();

router.post("/compute", computeRoute);
router.get("/decisions", getRoutingDecisions);
router.get("/decisions/:id", getRoutingDecisionById);

export default router;
