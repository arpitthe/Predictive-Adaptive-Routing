import express from "express";
import {
  getGns3Status,
  fetchGns3Topology,
  executeRouteInGns3,
} from "../controllers/gns3.controller.js";

const router = express.Router();

router.get("/status", getGns3Status);
router.get("/topology", fetchGns3Topology);
router.post("/apply-route", executeRouteInGns3);

export default router;

