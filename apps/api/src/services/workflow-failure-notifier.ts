import { dataStore } from "../data/store.js";
import { processMCPRequest } from "./mcp.js";

const DEFAULT_WORKFLOW_FAILURE_EMAIL = "hetpatel7627@gmail.com";
const DEFAULT_PAYLOAD_PREVIEW_LIMIT = 6000;
const DEFAULT_EMAIL_BODY_LIMIT = 20000;

export type WorkflowFailureEmailArgs = {
  workflowId?: string;
  workflowName?: string;
  executionId?: string;
  source: string;
  stepId?: string;
  method?: string;
  triggerEvent?: string;
  query?: string;
  requestPayload?: unknown;
  responsePayload?: unknown;
  failureReason?: string;
  details?: Record<string, unknown>;
};

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function stringifyPayload(
  value: unknown,
  maxLength = DEFAULT_PAYLOAD_PREVIEW_LIMIT,
): string {
  if (value === undefined) {
    return "n/a";
  }

  if (typeof value === "string") {
    return truncateText(value, maxLength);
  }

  try {
    return truncateText(JSON.stringify(value, null, 2), maxLength);
  } catch {
    return truncateText(String(value), maxLength);
  }
}

function resolveFailureEmailRecipient(): string {
  const configured = (
    process.env.WORKFLOW_FAILURE_NOTIFY_EMAIL ??
    process.env.WORKFLOW_NOTIFY_EMAIL ??
    ""
  ).trim();

  return configured || DEFAULT_WORKFLOW_FAILURE_EMAIL;
}

function buildFailureEmailBody(args: WorkflowFailureEmailArgs): string {
  const lines: string[] = [
    "NexusMCP Workflow Failure Alert",
    "",
    `Timestamp: ${new Date().toISOString()}`,
    `Source: ${args.source}`,
    `Workflow ID: ${args.workflowId || "n/a"}`,
    `Workflow Name: ${args.workflowName || "n/a"}`,
    `Execution ID: ${args.executionId || "n/a"}`,
    `Step ID: ${args.stepId || "n/a"}`,
    `Method: ${args.method || "n/a"}`,
    `Trigger Event: ${args.triggerEvent || "n/a"}`,
    `Failure Reason: ${args.failureReason || "Unknown workflow failure"}`,
    "",
    "Query / Prompt:",
    truncateText((args.query || "n/a").trim() || "n/a", 4000),
    "",
    "Request Payload:",
    stringifyPayload(args.requestPayload),
    "",
    "Response Payload:",
    stringifyPayload(args.responsePayload),
  ];

  if (args.details && Object.keys(args.details).length > 0) {
    lines.push("", "Additional Details:", stringifyPayload(args.details));
  }

  return truncateText(lines.join("\n"), DEFAULT_EMAIL_BODY_LIMIT);
}

export async function notifyWorkflowFailureEmail(
  args: WorkflowFailureEmailArgs,
): Promise<void> {
  const recipient = resolveFailureEmailRecipient();
  const workflowLabel =
    args.workflowName || args.workflowId || "unknown-workflow";
  const subject = truncateText(
    `[NexusMCP] Workflow failure: ${workflowLabel}`,
    180,
  );
  const body = buildFailureEmailBody(args);

  try {
    const response = await processMCPRequest({
      jsonrpc: "2.0",
      id: `workflow-failure-email-${Date.now()}`,
      method: "gmail.send_email",
      params: {
        to: recipient,
        subject,
        body,
        text: body,
      },
    });

    if (response.error) {
      throw new Error(
        response.error.message || "gmail.send_email returned an error",
      );
    }

    dataStore.addLog({
      level: "info",
      service: "system",
      action: "workflow_failure_email_sent",
      message: `Workflow failure email sent to ${recipient}`,
      workflowId: args.workflowId,
      executionId: args.executionId,
      nodeId: args.stepId,
      details: {
        source: args.source,
        method: args.method,
        triggerEvent: args.triggerEvent,
      },
    });
  } catch (error) {
    dataStore.addLog({
      level: "warning",
      service: "system",
      action: "workflow_failure_email_failed",
      message: `Failed to send workflow failure email: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
      workflowId: args.workflowId,
      executionId: args.executionId,
      nodeId: args.stepId,
      details: {
        recipient,
        source: args.source,
        method: args.method,
        triggerEvent: args.triggerEvent,
        failureReason: args.failureReason,
      },
    });
  }
}
