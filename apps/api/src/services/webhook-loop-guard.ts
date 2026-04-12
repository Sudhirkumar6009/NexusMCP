import { createHash } from "node:crypto";

import type {
  NormalizedWebhookEvent,
  WebhookSource,
} from "../types/webhook.js";

type RememberedLoopSignal = {
  source: WebhookSource;
  signal: string;
  executionId?: string;
  stepId?: string;
  storedAt: number;
  expiresAt: number;
};

type LoopSuppressionResult = {
  suppress: boolean;
  matchedSignal?: string;
  reason?: string;
};

const LOOP_SIGNAL_TTL_MS = Number(
  process.env.WEBHOOK_LOOP_SIGNAL_TTL_MS ?? `${3 * 60 * 1000}`,
);
const LOOP_SIGNAL_CACHE_SIZE = Number(
  process.env.WEBHOOK_LOOP_SIGNAL_CACHE_SIZE ?? "2000",
);

const rememberedLoopSignals = new Map<string, RememberedLoopSignal>();

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

function normalizeSignal(signal: string): string {
  return signal.trim().toLowerCase();
}

function cacheKey(source: WebhookSource, signal: string): string {
  return `${source}:${normalizeSignal(signal)}`;
}

function normalizedTextHash(value: string): string {
  const normalized = value.trim().replace(/\s+/g, " ").toLowerCase();
  if (!normalized) {
    return "";
  }

  return createHash("sha256").update(normalized).digest("hex").slice(0, 20);
}

function pruneExpiredSignals(now = Date.now()): void {
  for (const [key, record] of rememberedLoopSignals.entries()) {
    if (record.expiresAt <= now) {
      rememberedLoopSignals.delete(key);
    }
  }
}

function enforceMaxSignalCacheSize(): void {
  const maxSize = Math.max(50, LOOP_SIGNAL_CACHE_SIZE);
  if (rememberedLoopSignals.size <= maxSize) {
    return;
  }

  const sorted = [...rememberedLoopSignals.entries()].sort(
    (a, b) => a[1].storedAt - b[1].storedAt,
  );

  const deleteCount = rememberedLoopSignals.size - maxSize;
  for (const [key] of sorted.slice(0, deleteCount)) {
    rememberedLoopSignals.delete(key);
  }
}

export function buildJiraIssueLoopSignal(issueKey: string): string {
  const normalized = issueKey.trim().toUpperCase();
  if (!normalized) {
    return "";
  }

  return `issue_key:${normalized}`;
}

export function buildSlackLoopSignals(args: {
  channel?: string;
  text?: string;
}): string[] {
  const signals: string[] = [];
  const channel = asString(args.channel).toLowerCase();
  const textHash = normalizedTextHash(asString(args.text));

  if (textHash) {
    signals.push(`text_hash:${textHash}`);

    if (channel) {
      signals.push(`channel_text_hash:${channel}:${textHash}`);
    }
  }

  return signals;
}

export function rememberOutboundWebhookSignals(args: {
  source: WebhookSource;
  signals: string[];
  executionId?: string;
  stepId?: string;
}): void {
  const now = Date.now();
  pruneExpiredSignals(now);

  const ttlMs = Math.max(30_000, LOOP_SIGNAL_TTL_MS);

  for (const signal of args.signals) {
    const normalized = normalizeSignal(signal);
    if (!normalized) {
      continue;
    }

    const key = cacheKey(args.source, normalized);
    rememberedLoopSignals.set(key, {
      source: args.source,
      signal: normalized,
      executionId: args.executionId,
      stepId: args.stepId,
      storedAt: now,
      expiresAt: now + ttlMs,
    });
  }

  enforceMaxSignalCacheSize();
}

function extractInboundSignals(event: NormalizedWebhookEvent): string[] {
  const data = asRecord(event.data);

  if (event.source === "jira") {
    const issueKey = buildJiraIssueLoopSignal(asString(data.issue_key));
    return issueKey ? [issueKey] : [];
  }

  if (event.source === "slack") {
    return buildSlackLoopSignals({
      channel: asString(data.channel),
      text: asString(data.text),
    });
  }

  if (event.source === "github") {
    const repository = asString(data.repository).toLowerCase();
    const ref = asString(data.ref).toLowerCase();

    if (!repository || !ref) {
      return [];
    }

    return [`repo_ref:${repository}:${ref}`];
  }

  return [];
}

export function rememberGithubRefLoopSignal(args: {
  repository?: string;
  ref?: string;
  executionId?: string;
  stepId?: string;
}): void {
  const repository = asString(args.repository).toLowerCase();
  const ref = asString(args.ref).toLowerCase();

  if (!repository || !ref) {
    return;
  }

  rememberOutboundWebhookSignals({
    source: "github",
    signals: [`repo_ref:${repository}:${ref}`],
    executionId: args.executionId,
    stepId: args.stepId,
  });
}

export function shouldSuppressWebhookEvent(
  event: NormalizedWebhookEvent,
): LoopSuppressionResult {
  const now = Date.now();
  pruneExpiredSignals(now);

  const inboundSignals = extractInboundSignals(event);
  for (const signal of inboundSignals) {
    const hit = rememberedLoopSignals.get(cacheKey(event.source, signal));
    if (!hit) {
      continue;
    }

    return {
      suppress: true,
      matchedSignal: signal,
      reason: `Suppressed potential workflow loop for ${event.source} signal ${signal}.`,
    };
  }

  return { suppress: false };
}
