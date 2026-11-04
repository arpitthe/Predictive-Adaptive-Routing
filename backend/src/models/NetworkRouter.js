import mongoose from "mongoose";

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

const NetworkRouter = mongoose.model(
  "NetworkRouter",
  networkRouterSchema
);

export default NetworkRouter;