import mongoose from "mongoose";
import { memoryStore } from "../storage/memoryStore.js";
import { isMemoryMode } from "../storage/index.js";

const routingDecisionSchema = new mongoose.Schema(
  {
    sourceRouter: {
      type: String,
      required: true,
    },

    destinationRouter: {
      type: String,
      required: true,
    },

    routerPath: {
      type: [String],
      required: true,
    },

    linkPath: {
      type: [String],
      required: true,
    },

    totalCost: {
      type: Number,
      required: true,
      min: 0,
    },

    evaluatedLinks: [
      {
        linkId: {
          type: String,
          required: true,
        },

        predictedUtilizationPct: {
          type: Number,
          required: true,
        },

        congestionRisk: {
          type: String,
          enum: ["LOW", "HIGH", "UNKNOWN"],
          required: true,
        },

        routingCost: {
          type: Number,
          required: true,
        },

        predictionStatus: {
          type: String,
          enum: ["ok", "error", "insufficient_history"],
        },

        predictionModel: {
          type: String,
          default: null,
        },

        predictionError: {
          type: String,
          default: null,
        },
      },
    ],

    algorithm: {
      type: String,
      default: "Dijkstra",
    },

    routingPolicy: {
      type: String,
      default: "Chronos-2 predictive utilization cost",
    },
  },
  {
    timestamps: true,
  }
);

export const MongooseRoutingDecision =
  mongoose.models.RoutingDecision ||
  mongoose.model("RoutingDecision", routingDecisionSchema);

// Storage-aware proxy: delegates to memoryStore when STORAGE_MODE=memory
const RoutingDecision = new Proxy(MongooseRoutingDecision, {
  get(target, prop, receiver) {
    if (isMemoryMode()) {
      if (prop in memoryStore.decisions) {
        return memoryStore.decisions[prop];
      }
    }
    return Reflect.get(target, prop, receiver);
  },
});

export default RoutingDecision;
