import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

type GitHubWebhookPayload = Record<string, unknown>;

const IDEMPOTENCY_TTL_MS = Number(
  process.env.WEBHOOK_IDEMPOTENCY_TTL_MS ?? `${60 * 60 * 1000}`,
);
const seenIdempotencyKeys = new Map<string, number>();

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

function buildGitHubIdempotencyKey(request: NextRequest): string {
  const deliveryId = (request.headers.get("x-github-delivery") ?? "").trim();
  return `github:${deliveryId || Date.now().toString()}`;
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
  body: GitHubWebhookPayload,
): Record<string, unknown> {
  const root = asRecord(body);
  const nestedBody = toRecord(root.body);

  if (Object.keys(nestedBody).length > 0) {
    return nestedBody;
  }

  return root;
}

function normalizeEvent(rawEvent: string | null): string {
  const normalized = (rawEvent ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return normalized || "unknown";
}

export async function GET(request: NextRequest) {
  const requestId = crypto.randomUUID();
  console.info(
    `[Webhook][GitHub] GET hit requestId=${requestId} path=${request.nextUrl.pathname}`,
  );

  return NextResponse.json(
    {
      success: true,
      source: "github",
      method: "GET",
      requestId,
      message: "GitHub webhook route is active",
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

  let parsed: GitHubWebhookPayload | null = null;
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
  const repository = asRecord(data.repository);
  const sender = asRecord(data.sender);
  const pusher = asRecord(data.pusher);
  const senderLogin = asString(sender.login);
  const pusherName = asString(pusher.name);
  const headerEvent = request.headers.get("x-github-event");
  const fallbackEvent = asString(data.event) || asString(data.action);
  const rawEvent = normalizeEvent(headerEvent || fallbackEvent);
  const idempotencyKey = buildGitHubIdempotencyKey(request);
  const enqueueResult = registerIdempotencyKey(idempotencyKey);

  const normalized = {
    source: "github",
    event: `github.${rawEvent}`,
    data: {
      repository: asString(repository.name) || "unknown-repo",
      ref: asString(data.ref),
      before: asString(data.before),
      after: asString(data.after),
      sender: senderLogin || pusherName || "unknown-user",
      pusher: pusherName || senderLogin || "unknown-pusher",
      action: asString(data.action),
    },
  };

  if (!senderLogin && !pusherName) {
    console.warn(
      `[Webhook][GitHub] sender.login and pusher.name missing in payload requestId=${requestId}`,
    );
  }

  console.info(
    `[Webhook][GitHub] hit requestId=${requestId} event=${normalized.event} key=${idempotencyKey} accepted=${enqueueResult.accepted} duplicate=${enqueueResult.duplicate} path=${request.nextUrl.pathname}`,
  );
  console.info("[Webhook][GitHub] payload", parsedBody);
  console.info("[Webhook][GitHub] normalized", normalized);

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
