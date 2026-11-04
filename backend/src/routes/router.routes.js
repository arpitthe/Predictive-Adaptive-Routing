import express from "express";

import {
  createRouter,
  getAllRouters,
  getRouterById,
  updateRouter,
  deleteRouter,
} from "../controllers/router.controller.js";

const router = express.Router();

router.post("/", createRouter);
router.get("/", getAllRouters);
router.get("/:id", getRouterById);
router.put("/:id", updateRouter);
router.delete("/:id", deleteRouter);

export default router;