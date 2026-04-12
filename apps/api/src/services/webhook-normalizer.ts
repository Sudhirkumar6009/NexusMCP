import type { IncomingHttpHeaders } from "node:http";

import type {
  NormalizedWebhookEvent,
  WebhookSource,
} from "../types/webhook.js";

const WEBHOOK_SIGNAL_KEYS = [
  "repository",
  "ref",
  "before",
  "after",
  "sender",
  "pusher",
  "action",
  "event",
  "webhookEvent",
  "issue",
  "challenge",
  "type",
];

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function asString(value: unknown, fallback = ""): string {
  if (Array.isArray(value)) {
    for (const item of value) {
      const normalized = asString(item);
      if (normalized) {
        return normalized;
      }
    }

    return fallback;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed || fallback;
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

function hasSignalKeys(value: Record<string, unknown>): boolean {
  return WEBHOOK_SIGNAL_KEYS.some((key) => key in value);
}

function unwrapPayload(payload: unknown): Record<string, unknown> {
  const root = asRecord(payload);
  if (Object.keys(root).length === 0) {
    return {};
  }

  if (hasSignalKeys(root)) {
    return root;
  }

  const nestedPayload = toRecord(root.payload);
  if (Object.keys(nestedPayload).length > 0) {
    return nestedPayload;
  }

  const nestedBody = toRecord(root.body);
  if (Object.keys(nestedBody).length > 0) {
    return nestedBody;
  }

  return root;
}

function formatEventName(source: WebhookSource, rawEvent: string): string {
  const normalized = asString(rawEvent, "unknown")
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (normalized.startsWith(`${source}.`)) {
    return normalized;
  }

  return `${source}.${normalized}`;
}

function headerAsString(headers: IncomingHttpHeaders, name: string): string {
  return asString(headers[name.toLowerCase()]);
}

function normalizeGitHubWebhook(
  payload: unknown,
  headers: IncomingHttpHeaders,
): NormalizedWebhookEvent {
  const body = unwrapPayload(payload);
  const data = toRecord(body.data);
  const repository = asRecord(body.repository);
  const dataRepository = asRecord(data.repository);
  const sender = asRecord(body.sender);
  const dataSender = asRecord(data.sender);
  const pusher = asRecord(body.pusher);
  const dataPusher = asRecord(data.pusher);

  const eventHeader = headerAsString(headers, "x-github-event");
  const fallbackEvent =
    asString(body.event) ||
    asString(data.event) ||
    asString(body.action) ||
    asString(data.action);

  const eventType = formatEventName("github", eventHeader || fallbackEvent);

  return {
    source: "github",
    event: eventType,
    data: {
      delivery_id: headerAsString(headers, "x-github-delivery"),
      repository:
        asString(repository.name) ||
        asString(repository.full_name) ||
        asString(dataRepository.name) ||
        asString(dataRepository.full_name) ||
        asString(data.repository) ||
        "unknown-repo",
      ref: asString(body.ref) || asString(data.ref),
      before: asString(body.before) || asString(data.before),
      after: asString(body.after) || asString(data.after),
      sender:
        asString(sender.login) || asString(dataSender.login) || "unknown-user",
      pusher:
        asString(pusher.name) || asString(dataPusher.name) || "unknown-pusher",
      action: asString(body.action) || asString(data.action),
    },
  };
}

function normalizeJiraWebhook(payload: unknown): NormalizedWebhookEvent {
  const body = unwrapPayload(payload);
  const issue = asRecord(body.issue);
  const fields = asRecord(issue.fields);
  const status = asRecord(fields.status);

  const rawEvent =
    asString(body.webhookEvent) ||
    asString(body.issue_event_type_name) ||
    "unknown";

  return {
    source: "jira",
    event: formatEventName("jira", rawEvent),
    data: {
      timestamp: body.timestamp ?? null,
      issue_id: asString(issue.id),
      issue_key: asString(issue.key),
      issue_title: asString(fields.summary),
      issue_status: asString(status.name),
      issue_description: asString(fields.description),
      project_key: asString(asRecord(fields.project).key),
      user: asString(asRecord(body.user).displayName),
      changelog: body.changelog ?? null,
    },
  };
}

function normalizeSlackWebhook(payload: unknown): NormalizedWebhookEvent {
  const body = unwrapPayload(payload);
  const data = toRecord(body.data);
  const eventBody = asRecord(body.event);
  const dataEventBody = asRecord(data.event);
  const challenge = asString(body.challenge) || asString(data.challenge);

  if (challenge) {
    return {
      source: "slack",
      event: "slack.url_verification",
      data: {
        challenge,
      },
    };
  }

  const slackEvent =
    asString(eventBody.type) ||
    asString(dataEventBody.type) ||
    asString(body.type) ||
    asString(data.type) ||
    asString(body.command) ||
    asString(data.command) ||
    "unknown";

  const eventType = formatEventName("slack", slackEvent);

  return {
    source: "slack",
    event: eventType,
    data: {
      text:
        asString(eventBody.text) ||
        asString(dataEventBody.text) ||
        asString(body.text) ||
        asString(data.text),
      user:
        asString(eventBody.user) ||
        asString(dataEventBody.user) ||
        asString(body.user) ||
        asString(data.user) ||
        "unknown-user",
      channel:
        asString(eventBody.channel) ||
        asString(dataEventBody.channel) ||
        asString(body.channel) ||
        asString(data.channel) ||
        "unknown-channel",
      ts: asString(eventBody.ts) || asString(dataEventBody.ts),
    },
  };
}

export function normalizeWebhookEvent(args: {
  source: WebhookSource;
  payload: unknown;
  headers: IncomingHttpHeaders;
}): NormalizedWebhookEvent {
  if (args.source === "github") {
    return normalizeGitHubWebhook(args.payload, args.headers);
  }

  if (args.source === "jira") {
    return normalizeJiraWebhook(args.payload);
  }

  if (args.source === "slack") {
    return normalizeSlackWebhook(args.payload);
  }

  throw new Error(`Unsupported webhook source: ${args.source}`);
}
