import type { Request } from "express";

import type { WebhookSource } from "../types/webhook.js";

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function asString(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return "";
}

function parseJsonRecord(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return asRecord(parsed);
  } catch {
    return {};
  }
}

function toRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    return parseJsonRecord(value);
  }

  return asRecord(value);
}

export function verifySharedWebhookTokenPlaceholder(req: Request): boolean {
  const expectedToken = (process.env.WEBHOOK_SHARED_TOKEN ?? "").trim();
  if (!expectedToken) {
    return true;
  }

  const tokenHeader = (req.header("x-webhook-token") ?? "").trim();
  const authorizationHeader = (req.header("authorization") ?? "").trim();
  const bearerToken = authorizationHeader.toLowerCase().startsWith("bearer ")
    ? authorizationHeader.slice(7).trim()
    : "";

  const providedToken = tokenHeader || bearerToken;
  return providedToken === expectedToken;
}

export function verifyGitHubSignaturePlaceholder(req: Request): boolean {
  const githubSecret = (process.env.GITHUB_WEBHOOK_SECRET ?? "").trim();
  if (!githubSecret) {
    return true;
  }

  const signature = (req.header("x-hub-signature-256") ?? "").trim();

  // Placeholder: require signature format when secret is configured.
  // TODO: validate HMAC using raw body and GITHUB_WEBHOOK_SECRET.
  return signature.startsWith("sha256=");
}

function providerDeliveryKey(
  source: WebhookSource,
  req: Request,
  payload: unknown,
): string {
  if (source === "github") {
    return (req.header("x-github-delivery") ?? "").trim();
  }

  if (source === "jira") {
    return (
      req.header("x-atlassian-webhook-identifier") ??
      req.header("x-request-id") ??
      ""
    ).trim();
  }

  if (source === "slack") {
    const body = toRecord(payload);
    const data = toRecord(body.data);
    const eventBody = toRecord(body.event);
    const dataEventBody = toRecord(data.event);

    return (
      asString(eventBody.ts) ||
      asString(dataEventBody.ts) ||
      asString(body.ts) ||
      asString(data.ts)
    );
  }

  return "";
}

export function buildIdempotencyKey(args: {
  source: WebhookSource;
  eventType: string;
  payload: unknown;
  req: Request;
}): string {
  const deliveryKey = providerDeliveryKey(args.source, args.req, args.payload);
  if (deliveryKey) {
    return `${args.source}:${deliveryKey}`;
  }

  return `${args.source}:${Date.now()}`;
}
