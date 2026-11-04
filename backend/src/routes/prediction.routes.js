
import express from "express";
import { getPredictionForLink } from "../controllers/prediction.controller.js";

const router = express.Router();

router.post("/:linkId", getPredictionForLink);

export default router;
