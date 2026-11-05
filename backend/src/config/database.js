import mongoose from "mongoose";

/**
 * Connect to MongoDB when STORAGE_MODE is "mongodb".
 * When STORAGE_MODE is "memory", skips connection and logs information.
 */
const connectDB = async () => {
  if (process.env.STORAGE_MODE === "memory") {
    console.log("[Database] In-memory mode active (skipping MongoDB connection).");
    return;
  }

  const mongoUri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/predictive_routing";

  try {
    await mongoose.connect(mongoUri);
    console.log("[Database] MongoDB connected successfully.");
  } catch (error) {
    console.error("[Database] MongoDB connection failed:", error.message);
    console.error("[Database] To run without MongoDB, set STORAGE_MODE=memory in your .env file.");
    process.exit(1);
  }
};

export default connectDB;
