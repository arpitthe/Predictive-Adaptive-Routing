import express from "express";

import {
  createLink,
  getAllLinks,
  getLinkById,
  updateLink,
  deleteLink,
} from "../controllers/link.controller.js";

const router = express.Router();

router.post("/", createLink);
router.get("/", getAllLinks);
router.get("/:id", getLinkById);
router.put("/:id", updateLink);
router.delete("/:id", deleteLink);

export default router;