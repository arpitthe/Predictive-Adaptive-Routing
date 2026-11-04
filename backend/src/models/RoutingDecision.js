
import mongoose from "mongoose";

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
          enum: ["LOW", "HIGH"],
          required: true,
        },

        routingCost: {
          type: Number,
          required: true,
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

const RoutingDecision = mongoose.model(
  "RoutingDecision",
  routingDecisionSchema
);

export default RoutingDecision;
