import mongoose from "mongoose";
import { memoryStore } from "../storage/memoryStore.js";
import { isMemoryMode } from "../storage/index.js";

const networkRouterSchema = new mongoose.Schema(
  {
    routerId: {
      type: String,
      required: [true, "Router ID is required"],
      unique: true,
      trim: true,
    },

    name: {
      type: String,
      required: [true, "Router name is required"],
      trim: true,
    },

    ipAddress: {
      type: String,
      required: [true, "IP address is required"],
      trim: true,
    },

    status: {
      type: String,
      enum: ["active", "inactive", "maintenance"],
      default: "active",
    },

    location: {
      type: String,
      trim: true,
      default: "",
    },
  },
  {
    timestamps: true,
  }
);

export const MongooseNetworkRouter =
  mongoose.models.NetworkRouter ||
  mongoose.model("NetworkRouter", networkRouterSchema);

// Storage-aware proxy: delegates to memoryStore when STORAGE_MODE=memory
const NetworkRouter = new Proxy(MongooseNetworkRouter, {
  get(target, prop, receiver) {
    if (isMemoryMode()) {
      if (prop in memoryStore.routers) {
        return memoryStore.routers[prop];
      }
    }
    return Reflect.get(target, prop, receiver);
  },
});

export default NetworkRouter;
