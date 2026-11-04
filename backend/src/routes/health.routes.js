import express from "express";

const router = express.Router();

router.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Predictive Adaptive Routing Backend is running",
    timestamp: new Date().toISOString(),
  });
});

export default router;