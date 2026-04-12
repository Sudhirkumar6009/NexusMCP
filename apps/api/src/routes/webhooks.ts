import { Router, type Request, type Response } from "express";

import { enqueueWebhookEvent } from "../services/webhook-queue.js";
import { normalizeWebhookEvent } from "../services/webhook-normalizer.js";
import {
  buildIdempotencyKey,
  verifyGitHubSignaturePlaceholder,
  verifySharedWebhookTokenPlaceholder,
} from "../services/webhook-security.js";
import {
  getAlwaysOnWorkflowConfig,
  resolveWorkflowBySource,
} from "../services/workflow-trigger.js";
import type { QueuedWebhookEvent, WebhookSource } from "../types/webhook.js";

const router = Router();

function healthResponse(source: WebhookSource) {
  return {
    success: true,
    source,
    message: `${source} webhook route is active`,
    receivedAt: new Date().toISOString(),
  };
}

function slackChallengeFromPayload(payload: unknown): string {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return "";
  }

  const root = payload as Record<string, unknown>;
  const candidates: unknown[] = [root, root.data, root.payload, root.body];

  for (const candidate of candidates) {
    if (
      !candidate ||
      typeof candidate !== "object" ||
      Array.isArray(candidate)
    ) {
      continue;
    }

    const challenge = (candidate as Record<string, unknown>).challenge;
    if (typeof challenge === "string" && challenge.trim()) {
      return challenge;
    }
  }

  return "";
}

async function handleWebhookRequest(
  source: WebhookSource,
  req: Request,
  res: Response,
): Promise<void> {
  try {
    if (!verifySharedWebhookTokenPlaceholder(req)) {
      res.status(401).json({
        success: false,
        error: "Invalid webhook token",
      });
      return;
    }

    if (source === "github" && !verifyGitHubSignaturePlaceholder(req)) {
      res.status(401).json({
        success: false,
        error: "Invalid GitHub signature",
      });
      return;
    }

    const slackChallenge =
      source === "slack" ? slackChallengeFromPayload(req.body) : "";
    if (slackChallenge) {
      console.info("[Webhook] received Slack URL verification challenge");
      res.status(200).json({
        challenge: slackChallenge,
      });
      return;
    }

    const normalized = normalizeWebhookEvent({
      source,
      payload: req.body,
      headers: req.headers,
    });

    console.info("[Webhook] normalized", {
      source: normalized.source,
      event: normalized.event,
      data: normalized.data,
    });

    const idempotencyKey = buildIdempotencyKey({
      source,
      eventType: normalized.event,
      payload: req.body,
      req,
    });

    const queuedEvent: QueuedWebhookEvent = {
      ...normalized,
      idempotencyKey,
      receivedAt: new Date().toISOString(),
    };

    console.info(
      `[Webhook] received source=${source} event=${normalized.event} key=${idempotencyKey}`,
    );

    const enqueueResult = enqueueWebhookEvent(queuedEvent);
    const targetWorkflow = resolveWorkflowBySource(source);
    const mode = getAlwaysOnWorkflowConfig();

    res.status(202).json({
      success: true,
      accepted: enqueueResult.accepted,
      duplicate: enqueueResult.duplicate,
      idempotencyKey,
      normalized: {
        source: normalized.source,
        event: normalized.event,
        data: normalized.data,
      },
      targetWorkflow,
      triggerMode: {
        alwaysOn: mode.enabled,
        plannerEnabled: mode.plannerEnabled,
      },
      queueSize: enqueueResult.queueSize,
    });
  } catch (error) {
    console.error(
      `[Webhook] failed source=${source}: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
    );

    res.status(500).json({
      success: false,
      error: "Failed to process webhook",
    });
  }
}

router.post("/github", (req, res) => {
  void handleWebhookRequest("github", req, res);
});

router.get("/github", (_req, res) => {
  res.status(200).json(healthResponse("github"));
});

router.post("/jira", (req, res) => {
  void handleWebhookRequest("jira", req, res);
});

router.get("/jira", (_req, res) => {
  res.status(200).json(healthResponse("jira"));
});

router.post("/slack", (req, res) => {
  void handleWebhookRequest("slack", req, res);
});

router.get("/slack", (_req, res) => {
  res.status(200).json(healthResponse("slack"));
});

export default router;
