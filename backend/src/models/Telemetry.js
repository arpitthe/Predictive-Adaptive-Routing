import mongoose from "mongoose";
import { memoryStore } from "../storage/memoryStore.js";
import { isMemoryMode } from "../storage/index.js";

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
      enum: ["manual", "simulator", "gns3", "demo_seed", "replay"],
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

export const MongooseTelemetry =
  mongoose.models.Telemetry || mongoose.model("Telemetry", telemetrySchema);

// Storage-aware proxy: delegates to memoryStore when STORAGE_MODE=memory
const Telemetry = new Proxy(MongooseTelemetry, {
  get(target, prop, receiver) {
    if (isMemoryMode()) {
      if (prop in memoryStore.telemetry) {
        return memoryStore.telemetry[prop];
      }
    }
    return Reflect.get(target, prop, receiver);
  },
});

export default Telemetry;
