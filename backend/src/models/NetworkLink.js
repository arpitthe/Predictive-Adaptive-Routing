
import mongoose from "mongoose";

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

const NetworkLink = mongoose.model("NetworkLink", networkLinkSchema);

export default NetworkLink;
