import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const IDEMPOTENCY_TTL_MS = Number(
  process.env.WEBHOOK_IDEMPOTENCY_TTL_MS ?? `${60 * 60 * 1000}`,
);
const seenIdempotencyKeys = new Map<string, number>();

type SlackWebhookPayload = {
  type?: string;
  challenge?: string;
  event?: {
    type?: string;
    user?: string;
    channel?: string;
    text?: string;
    ts?: string;
  };
  [key: string]: unknown;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function asString(value: unknown): string {
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

function pruneSeenKeys(now: number): void {
  for (const [key, seenAt] of seenIdempotencyKeys.entries()) {
    if (now - seenAt > IDEMPOTENCY_TTL_MS) {
      seenIdempotencyKeys.delete(key);
    }
  }
}

function registerIdempotencyKey(key: string): {
  accepted: boolean;
  duplicate: boolean;
} {
  const now = Date.now();
  pruneSeenKeys(now);

  if (seenIdempotencyKeys.has(key)) {
    return {
      accepted: false,
      duplicate: true,
    };
  }

  seenIdempotencyKeys.set(key, now);

  return {
    accepted: true,
    duplicate: false,
  };
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

function normalizeInputBody(
  body: SlackWebhookPayload,
): Record<string, unknown> {
  const root = asRecord(body);
  const nestedBody = toRecord(root.body);

  if (Object.keys(nestedBody).length > 0) {
    return nestedBody;
  }

  return root;
}

function normalizeEvent(rawEvent: string): string {
  const normalized = rawEvent
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return normalized || "unknown";
}

export async function GET(request: NextRequest) {
  const requestId = crypto.randomUUID();
  console.info(
    `[Webhook][Slack] GET hit requestId=${requestId} path=${request.nextUrl.pathname}`,
  );

  return NextResponse.json(
    {
      success: true,
      source: "slack",
      method: "GET",
      requestId,
      message: "Slack webhook route is active",
      receivedAt: new Date().toISOString(),
    },
    { status: 200 },
  );
}

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const raw = await request.text();

  console.log("========== RAW REQUEST ==========");
  console.log(raw);
  console.log("========== HEADERS ==========");
  request.headers.forEach((value, key) => {
    console.log(key, ":", value);
  });

  let parsed: SlackWebhookPayload | null = null;
  try {
    parsed = asRecord(JSON.parse(raw));
  } catch {
    console.log("JSON PARSE FAILED");
  }

  console.log("========== PARSED ==========");
  console.log(parsed);

  if (
    request.nextUrl.searchParams.get("debug") === "1" ||
    request.headers.get("x-webhook-debug") === "1"
  ) {
    return NextResponse.json({
      debug: true,
      raw,
      parsed,
    });
  }

  const parsedBody = parsed ?? {};

  // body?.body ?? body ?? {}
  const data = normalizeInputBody(parsedBody);
  const type = asString(data.type) || "unknown";
  const eventBody = asRecord(data.event);
  const eventUser = asString(eventBody.user);
  const eventChannel = asString(eventBody.channel);
  const challenge =
    asString(asRecord(parsedBody).challenge) || asString(data.challenge);

  console.info(
    `[Webhook][Slack] hit requestId=${requestId} type=${type} path=${request.nextUrl.pathname}`,
  );
  console.info("[Webhook][Slack] payload", parsedBody);

  if (challenge) {
    return NextResponse.json({ challenge }, { status: 200 });
  }

  const eventType =
    asString(eventBody.type) || asString(data.type) || "unknown";
  const eventTs =
    asString(eventBody.ts) || asString(data.ts) || Date.now().toString();
  const idempotencyKey = `slack:${eventTs}`;
  const enqueueResult = registerIdempotencyKey(idempotencyKey);

  const normalized = {
    source: "slack",
    event: `slack.${normalizeEvent(eventType)}`,
    data: {
      text: asString(eventBody.text) || asString(data.text),
      user: eventUser || asString(data.user) || "unknown-user",
      channel: eventChannel || asString(data.channel) || "unknown-channel",
      ts: eventTs,
    },
  };

  if (!eventUser || !eventChannel) {
    console.warn(
      `[Webhook][Slack] event.user or event.channel missing in payload requestId=${requestId}`,
    );
  }

  console.info(
    `[Webhook][Slack] key=${idempotencyKey} accepted=${enqueueResult.accepted} duplicate=${enqueueResult.duplicate}`,
  );
  console.info("[Webhook][Slack] normalized", normalized);

  return NextResponse.json(
    {
      success: true,
      accepted: enqueueResult.accepted,
      duplicate: enqueueResult.duplicate,
      normalized,
    },
    { status: 202 },
  );
}
