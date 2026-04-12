import type {
  QueueEnqueueResult,
  QueuedWebhookEvent,
} from "../types/webhook.js";
import { triggerWorkflow } from "./workflow-trigger.js";

const QUEUE_POLL_INTERVAL_MS = Number(
  process.env.WEBHOOK_QUEUE_POLL_INTERVAL_MS ?? "250",
);
const IDEMPOTENCY_TTL_MS = Number(
  process.env.WEBHOOK_IDEMPOTENCY_TTL_MS ?? `${60 * 60 * 1000}`,
);

type QueueItem = {
  event: QueuedWebhookEvent;
  enqueuedAt: number;
};

const webhookQueue: QueueItem[] = [];
const seenIdempotencyKeys = new Map<string, number>();
let workerTimer: NodeJS.Timeout | null = null;
let isProcessing = false;

function pruneSeenKeys(now: number): void {
  for (const [key, timestamp] of seenIdempotencyKeys.entries()) {
    if (now - timestamp > IDEMPOTENCY_TTL_MS) {
      seenIdempotencyKeys.delete(key);
    }
  }
}

async function processNextQueueItem(): Promise<void> {
  if (isProcessing) {
    return;
  }

  const item = webhookQueue.shift();
  if (!item) {
    return;
  }

  isProcessing = true;

  try {
    console.info(
      `[WebhookQueue] processing idempotencyKey=${item.event.idempotencyKey} source=${item.event.source} event=${item.event.event}`,
    );

    const result = await triggerWorkflow(item.event);

    if (result.accepted) {
      console.info(
        `[WebhookQueue] workflow triggered key=${item.event.idempotencyKey} workflow=${result.workflow ?? "unknown"}`,
      );
    } else {
      console.info(
        `[WebhookQueue] event ignored key=${item.event.idempotencyKey} reason=${result.reason ?? "n/a"}`,
      );
    }
  } catch (error) {
    console.error(
      `[WebhookQueue] processing failed key=${item.event.idempotencyKey}: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
    );
  } finally {
    isProcessing = false;
  }
}

export function enqueueWebhookEvent(
  event: QueuedWebhookEvent,
): QueueEnqueueResult {
  const now = Date.now();
  pruneSeenKeys(now);

  if (seenIdempotencyKeys.has(event.idempotencyKey)) {
    console.info(
      `[WebhookQueue] duplicate event skipped key=${event.idempotencyKey}`,
    );

    return {
      accepted: false,
      duplicate: true,
      queueSize: webhookQueue.length,
      idempotencyKey: event.idempotencyKey,
    };
  }

  seenIdempotencyKeys.set(event.idempotencyKey, now);
  webhookQueue.push({
    event,
    enqueuedAt: now,
  });

  console.info(
    `[WebhookQueue] enqueued key=${event.idempotencyKey} source=${event.source} queueSize=${webhookQueue.length}`,
  );

  return {
    accepted: true,
    duplicate: false,
    queueSize: webhookQueue.length,
    idempotencyKey: event.idempotencyKey,
  };
}

export function startWebhookQueueWorker(): void {
  if (workerTimer) {
    return;
  }

  workerTimer = setInterval(() => {
    void processNextQueueItem();
  }, Math.max(50, QUEUE_POLL_INTERVAL_MS));

  console.info(
    `[WebhookQueue] worker started intervalMs=${Math.max(50, QUEUE_POLL_INTERVAL_MS)}`,
  );
}

export function stopWebhookQueueWorker(): void {
  if (!workerTimer) {
    return;
  }

  clearInterval(workerTimer);
  workerTimer = null;
  console.info("[WebhookQueue] worker stopped");
}
