import "./config/env.js";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";

import { connectDB } from "./config/database.js";
import { configurePassport } from "./config/passport.js";
import passport from "passport";
import {
  errorHandler,
  requestLogger,
  simulateLatency,
} from "./middleware/index.js";
import workflowRoutes from "./routes/workflows.js";
import integrationRoutes from "./routes/integrations.js";
import logRoutes from "./routes/logs.js";
import settingsRoutes from "./routes/settings.js";
import authRoutes, {
  googleAuthRoutes,
  authenticateToken,
} from "./routes/auth.js";
import mcpRoutes from "./routes/mcp.js";
import {
  initPostgresStore,
  registerMcpTool,
} from "./services/postgres-store.js";
import { getAvailableMethods } from "./services/mcp.js";

const app = express();
const PORT = process.env.PORT || 3000;

const normalizeOrigin = (origin: string): string => origin.replace(/\/$/, "");
const configuredOrigins = (
  process.env.CLIENT_URLS ??
  process.env.CLIENT_URL ??
  ""
)
  .split(",")
  .map((origin) => normalizeOrigin(origin.trim()))
  .filter(Boolean);
const allowedOrigins =
  configuredOrigins.length > 0 ? configuredOrigins : ["http://localhost:5000"];

// Middleware
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(normalizeOrigin(origin))) {
        callback(null, true);
        return;
      }

      callback(new Error(`CORS origin not allowed: ${origin}`));
    },
    credentials: true,
  }),
);
app.use(express.json());
app.use(cookieParser());
app.use(requestLogger);

// Initialize Passport
configurePassport();
app.use(passport.initialize());

// Simulate realistic API latency in development
if (process.env.NODE_ENV !== "production") {
  app.use("/api", simulateLatency(50, 150));
}

// Google OAuth routes (no /api prefix)
app.use("/auth", googleAuthRoutes);

// API Routes
app.use("/api/auth", authRoutes);
app.use(
  "/api/workflows",
  authenticateToken as express.RequestHandler,
  workflowRoutes,
);
app.use(
  "/api/integrations",
  authenticateToken as express.RequestHandler,
  integrationRoutes,
);
app.use("/api/logs", authenticateToken as express.RequestHandler, logRoutes);
app.use(
  "/api/settings",
  authenticateToken as express.RequestHandler,
  settingsRoutes,
);
app.use("/api/mcp", authenticateToken as express.RequestHandler, mcpRoutes);

// Health check endpoint
app.get("/health", (_req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    version: "1.0.0",
  });
});

// API documentation endpoint
app.get("/api", (_req, res) => {
  res.json({
    name: "NexusMCP API",
    version: "1.0.0",
    endpoints: {
      auth: {
        "POST /api/auth/register": "Register new user",
        "POST /api/auth/login": "Login with email/password",
        "GET /api/auth/me": "Get current user",
        "PUT /api/auth/me": "Update profile",
        "PUT /api/auth/password": "Update password",
        "POST /api/auth/logout": "Logout",
        "POST /api/auth/gmail/token":
          "Exchange Gmail OAuth code or refresh access token",
        "POST /api/auth/gmail/send": "Send Gmail using Google OAuth token",
        "GET /auth/google": "Initiate Google OAuth",
        "GET /auth/google/gmail": "Request Gmail send scope and refresh token",
      },
      workflows: {
        "GET /api/workflows": "List all workflows",
        "POST /api/workflows": "Create a new workflow",
        "POST /api/workflows/generate": "Generate workflow from prompt",
        "POST /api/workflows/agentic-flow":
          "Generate multi-agent flow plan via Gemini-backed Python service",
      },
      integrations: {
        "GET /api/integrations": "List all integrations",
        "POST /api/integrations/:id/connect": "Connect an integration",
      },
      logs: {
        "GET /api/logs": "List audit logs",
      },
      settings: {
        "GET /api/settings": "Get settings",
        "PUT /api/settings": "Update settings",
      },
      mcp: {
        "POST /api/mcp/execute": "Execute MCP request",
        "GET /api/mcp/methods": "List available methods",
      },
    },
  });
});

// 404 handler
app.use((_req, res) => {
  res.status(404).json({
    success: false,
    error: "Not found",
  });
});

// Error handling
app.use(errorHandler);

// Start server
async function startServer() {
  try {
    let dbConnected = false;

    try {
      // Connect to MongoDB
      await connectDB();
      dbConnected = true;
    } catch (error) {
      if (process.env.NODE_ENV === "production") {
        throw error;
      }

      console.warn("MongoDB is unavailable; starting API in no-DB test mode.");
    }

    try {
      const postgresReady = await initPostgresStore();
      if (postgresReady) {
        for (const method of getAvailableMethods()) {
          const [serviceName = "system", methodName = method.method] =
            method.method.split(".");
          await registerMcpTool({
            toolId: `tool-${method.method}`,
            serviceName,
            methodName,
            schema: {
              description: method.description,
            },
          });
        }
        console.log("PostgreSQL store initialized successfully");
      } else {
        console.warn(
          "PostgreSQL credentials not configured; using in-memory fallback for persistence.",
        );
      }
    } catch (error) {
      console.warn(
        `PostgreSQL initialization failed; continuing with in-memory fallback: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    }

    const server = app.listen(PORT, () => {
      console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🚀 NexusMCP Server v1.0.0                               ║
║                                                           ║
║   Server running at: http://localhost:${PORT}              ║
║   API documentation: http://localhost:${PORT}/api          ║
║   Health check:      http://localhost:${PORT}/health       ║
║                                                           ║
║   Environment: ${(process.env.NODE_ENV || "development").padEnd(40)}║
║   MongoDB: ${(dbConnected ? "Connected" : "Unavailable").padEnd(40)}║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
      `);
    });

    server.on("error", (listenError: NodeJS.ErrnoException) => {
      if (listenError.code === "EADDRINUSE") {
        console.error(
          `Port ${PORT} is already in use. Stop the process using that port or change PORT in apps/api/.env.`,
        );
      } else {
        console.error("Server listen error:", listenError);
      }

      process.exit(1);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

startServer();

export default app;
