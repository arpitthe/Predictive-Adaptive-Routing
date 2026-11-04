import mongoose from "mongoose";

const telemetrySchema = new mongoose.Schema(
  {
    link: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "NetworkLink",
      required: true,
      index: true,
    },

    linkId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    utilizationPct: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },

    throughputMbps: {
      type: Number,
      min: 0,
      default: null,
    },

    packetLossPct: {
      type: Number,
      min: 0,
      max: 100,
      default: null,
    },

    source: {
      type: String,
      enum: ["manual", "simulator", "gns3"],
      default: "manual",
    },

    measuredAt: {
      type: Date,
      default: Date.now,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

// Efficient chronological history queries
telemetrySchema.index({ link: 1, measuredAt: -1 });

const Telemetry = mongoose.model("Telemetry", telemetrySchema);

export default Telemetry;