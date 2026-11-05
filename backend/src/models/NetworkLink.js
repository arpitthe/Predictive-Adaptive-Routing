import mongoose from "mongoose";
import { memoryStore } from "../storage/memoryStore.js";
import { isMemoryMode } from "../storage/index.js";

const networkLinkSchema = new mongoose.Schema(
  {
    linkId: {
      type: String,
      required: [true, "Link ID is required"],
      unique: true,
      trim: true,
    },

    // Stable numeric identifier used by the ML service.
    mlLinkIndex: {
      type: Number,
      min: 1,
      max: 30,
      unique: true,
      sparse: true,
    },

    sourceRouter: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "NetworkRouter",
      required: true,
    },

    destinationRouter: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "NetworkRouter",
      required: true,
    },

    bandwidthMbps: {
      type: Number,
      required: true,
      min: 0.01,
    },

    latencyMs: {
      type: Number,
      required: true,
      min: 0,
    },

    utilizationPct: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },

    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
    },
  },
  {
    timestamps: true,
  }
);

networkLinkSchema.pre("validate", function () {
  if (
    this.sourceRouter &&
    this.destinationRouter &&
    this.sourceRouter.equals(this.destinationRouter)
  ) {
    this.invalidate(
      "destinationRouter",
      "A link cannot connect a router to itself"
    );
  }
});

export const MongooseNetworkLink =
  mongoose.models.NetworkLink ||
  mongoose.model("NetworkLink", networkLinkSchema);

// Storage-aware proxy: delegates to memoryStore when STORAGE_MODE=memory
const NetworkLink = new Proxy(MongooseNetworkLink, {
  get(target, prop, receiver) {
    if (isMemoryMode()) {
      if (prop in memoryStore.links) {
        return memoryStore.links[prop];
      }
    }
    return Reflect.get(target, prop, receiver);
  },
});

export default NetworkLink;
