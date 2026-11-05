import express from "express";
import {
  getState,
  initialize,
  step,
  reset,
  run,
} from "../controllers/demo.controller.js";

const router = express.Router();

router.get("/state", getState);
router.post("/initialize", initialize);
router.post("/step", step);
router.post("/reset", reset);
router.post("/run", run);

export default router;

