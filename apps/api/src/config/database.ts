import mongoose from "mongoose";
import dns from "node:dns";

const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://localhost:27017/NexusMCP";

let isConnected = false;

function configureMongoSrvDns(): void {
  const configuredServers = process.env.MONGODB_DNS_SERVERS;
  const servers = (configuredServers || "8.8.8.8,1.1.1.1")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (servers.length === 0) {
    return;
  }

  dns.setServers(servers);
}

export async function connectDB(): Promise<void> {
  if (isConnected) {
    console.log("MongoDB already connected");
    return;
  }

  if (!MONGODB_URI) {
    throw new Error("MONGODB_URI is not defined in environment variables");
  }

  try {
    if (MONGODB_URI.startsWith("mongodb+srv://")) {
      configureMongoSrvDns();

      if (process.env.NODE_ENV !== "production") {
        const match = MONGODB_URI.match(/@([^/?]+)/);
        const host = match?.[1];

        if (host) {
          await dns.promises.resolveSrv(`_mongodb._tcp.${host}`);
        }
      }
    }

    const options = {
      bufferCommands: false,
    };

    await mongoose.connect(MONGODB_URI, options);
    isConnected = true;
    console.log("MongoDB connected successfully");
  } catch (error) {
    console.error("MongoDB connection error:", error);
    throw error;
  }
}

export async function disconnectDB(): Promise<void> {
  if (!isConnected) {
    return;
  }

  try {
    await mongoose.disconnect();
    isConnected = false;
    console.log("MongoDB disconnected");
  } catch (error) {
    console.error("MongoDB disconnection error:", error);
    throw error;
  }
}

// Handle connection events
mongoose.connection.on("connected", () => {
  console.log("Mongoose connected to MongoDB");
});

mongoose.connection.on("error", (err) => {
  console.error("Mongoose connection error:", err);
});

mongoose.connection.on("disconnected", () => {
  console.log("Mongoose disconnected");
});

// Handle app termination
process.on("SIGINT", async () => {
  await disconnectDB();
  process.exit(0);
});
