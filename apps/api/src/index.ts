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
import webhookRoutes from "./routes/webhooks.js";
import { initPostgresStore } from "./services/postgres-store.js";
import { startWebhookQueueWorker } from "./services/webhook-queue.js";
import { getAlwaysOnWorkflowConfig } from "./services/workflow-trigger.js";
import { dataStore } from "./data/store.js";

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

// Normalize accidental double slashes from external webhook URL joins.
app.use((req, res, next) => {
  const normalizedPath = req.path.replace(/\/{2,}/g, "/");
  if (normalizedPath !== req.path) {
    const query = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
    return res.redirect(307, `${normalizedPath}${query}`);
  }

  next();
});

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

// Public webhook endpoints for external event providers
app.use("/webhook", webhookRoutes);
app.use("/api/webhook", webhookRoutes);

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
  const workflowMode = getAlwaysOnWorkflowConfig();

  res.json({
    name: "NexusMCP API",
    version: "1.0.0",
    webhookRuntime: {
      alwaysOn: workflowMode.enabled,
      plannerEnabled: workflowMode.plannerEnabled,
      workflows: workflowMode.workflows,
    },
    endpoints: {
      auth: {
        "POST /api/auth/register": "Register new user",
        "POST /api/auth/login": "Login with email/password",
        "GET /api/auth/me": "Get current user",
        "PUT /api/auth/me": "Update profile",
        "POST /api/auth/change-password": "Change current user password",
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
        "GET /api/logs/step-runs": "List persisted workflow step runs",
        "GET /api/logs/stats": "Get audit log aggregates",
      },
      settings: {
        "GET /api/settings": "Get settings",
        "PUT /api/settings": "Update settings",
      },
      mcp: {
        "POST /api/mcp/execute": "Execute MCP request",
        "GET /api/mcp/methods": "List available methods",
      },
      webhooks: {
        "GET /api/webhook/github": "Webhook route health check",
        "POST /api/webhook/github": "Receive GitHub webhook event",
        "GET /api/webhook/slack": "Webhook route health check",
        "POST /api/webhook/slack": "Receive Slack webhook event",
        "POST /api/webhook/jira": "Receive Jira webhook event",
        "POST /webhook/github": "Alias route for GitHub webhook event",
        "POST /webhook/jira": "Alias route for Jira webhook event",
        "POST /webhook/slack": "Alias route for Slack webhook event",
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
    let postgresConnected = false;

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
      postgresConnected = await initPostgresStore();
      if (postgresConnected) {
        await dataStore.hydrateSharedIntegrationMemory();
      }
    } catch (error) {
      if (process.env.NODE_ENV === "production") {
        throw error;
      }

      console.warn(
        `PostgreSQL is unavailable; PostgreSQL-backed persistence disabled: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    }

    startWebhookQueueWorker();
    const workflowMode = getAlwaysOnWorkflowConfig();
    console.info(
      `[WebhookTrigger] mode alwaysOn=${workflowMode.enabled} plannerEnabled=${workflowMode.plannerEnabled} workflows=${workflowMode.workflows.join(",")}`,
    );

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
║   PostgreSQL: ${(postgresConnected ? "Connected" : "Unavailable").padEnd(39)}║
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
