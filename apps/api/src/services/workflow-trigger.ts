import type {
  NormalizedWebhookEvent,
  RoutedWorkflow,
  WorkflowTriggerResult,
} from "../types/webhook.js";
import { processMCPRequest } from "./mcp.js";
import { executeWebhookWorkflow } from "./webhook-workflow-executor.js";
import { shouldSuppressWebhookEvent } from "./webhook-loop-guard.js";

const AGENTIC_SERVICE_URL = (
  process.env.AGENTIC_SERVICE_URL ?? "http://localhost:8010"
).replace(/\/$/, "");

const AGENTIC_SERVICE_TIMEOUT_MS = Number(
  process.env.AGENTIC_SERVICE_TIMEOUT_MS ?? "30000",
);

const ALWAYS_ON_PREDEFINED_WORKFLOWS =
  (process.env.WEBHOOK_ALWAYS_ON_PREDEFINED_WORKFLOWS ?? "true")
    .trim()
    .toLowerCase() !== "false";

const WEBHOOK_USE_AGENTIC_PLANNER =
  (process.env.WEBHOOK_USE_AGENTIC_PLANNER ?? "false").trim().toLowerCase() ===
  "true";

const SLACK_WORKFLOW_ALLOWED_CHANNELS = (
  process.env.SLACK_WORKFLOW_ALLOWED_CHANNELS ?? "#bug-reporting"
)
  .split(",")
  .map((channel) => normalizeSlackChannel(channel))
  .filter(Boolean);

const JIRA_MERGED_BRANCH_DONE_STATUS = (
  process.env.JIRA_MERGED_BRANCH_DONE_STATUS ?? "Done"
).trim();

const JIRA_MERGE_DONE_BRANCHES = (
  process.env.JIRA_MERGE_DONE_BRANCHES ?? "main,master"
)
  .split(",")
  .map((branch) => normalizeGitBranch(branch))
  .filter(Boolean);

const SLACK_ALLOWED_CHANNEL_SET = new Set(SLACK_WORKFLOW_ALLOWED_CHANNELS);
const JIRA_MERGE_DONE_BRANCH_SET = new Set(JIRA_MERGE_DONE_BRANCHES);

const ALWAYS_ON_WORKFLOWS: RoutedWorkflow[] = [
  "GITHUB_START_WORKFLOW",
  "JIRA_START_WORKFLOW",
  "SLACK_START_WORKFLOW",
];

export function getAlwaysOnWorkflowConfig(): {
  enabled: boolean;
  plannerEnabled: boolean;
  workflows: RoutedWorkflow[];
} {
  return {
    enabled: ALWAYS_ON_PREDEFINED_WORKFLOWS,
    plannerEnabled: WEBHOOK_USE_AGENTIC_PLANNER,
    workflows: [...ALWAYS_ON_WORKFLOWS],
  };
}

export function resolveWorkflowBySource(
  source: NormalizedWebhookEvent["source"],
): RoutedWorkflow | null {
  if (source === "github") {
    return "GITHUB_START_WORKFLOW";
  }

  if (source === "jira") {
    return "JIRA_START_WORKFLOW";
  }

  if (source === "slack") {
    return "SLACK_START_WORKFLOW";
  }

  return null;
}

function asObject(value: unknown): Record<string, unknown> {
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

function asBoolean(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return (
      normalized === "true" ||
      normalized === "1" ||
      normalized === "yes" ||
      normalized === "y"
    );
  }

  return false;
}

function normalizeGitBranch(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^refs\/heads\//, "");
}

const ISSUE_KEY_REGEX = /\b([a-z][a-z0-9]+-\d+)\b/i;

function extractIssueKeyFromText(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    return "";
  }

  const match = normalized.match(ISSUE_KEY_REGEX);
  return match?.[1] ? match[1].toUpperCase() : "";
}

function resolveIssueKeyFromCandidates(candidates: unknown[]): string {
  for (const candidate of candidates) {
    const key = extractIssueKeyFromText(asString(candidate));
    if (key) {
      return key;
    }
  }

  return "";
}

function resolveIssueKeyFromGitHubEvent(event: NormalizedWebhookEvent): string {
  const payload = asObject(event.data);
  const pullRequest = asObject(payload.pull_request);
  const commitMessages = Array.isArray(payload.commit_messages)
    ? payload.commit_messages
    : [];

  return resolveIssueKeyFromCandidates([
    payload.issue_key,
    payload.head_ref,
    payload.ref,
    payload.pull_request_title,
    payload.pull_request_body,
    payload.head_commit_message,
    pullRequest.title,
    pullRequest.body,
    ...commitMessages,
  ]);
}

function isGitHubMergeToTrackedBranch(event: NormalizedWebhookEvent): {
  matches: boolean;
  baseBranch: string;
} {
  if (event.source !== "github") {
    return { matches: false, baseBranch: "" };
  }

  const normalizedEvent = event.event.trim().toLowerCase();
  if (
    normalizedEvent !== "github.pull_request" &&
    !normalizedEvent.startsWith("github.pull_request.")
  ) {
    return { matches: false, baseBranch: "" };
  }

  const payload = asObject(event.data);
  const baseBranch = normalizeGitBranch(
    asString(payload.base_ref) ||
      asString(payload.default_branch) ||
      asString(payload.ref),
  );
  if (!baseBranch) {
    return { matches: false, baseBranch: "" };
  }

  const isPullRequestEvent =
    normalizedEvent === "github.pull_request" ||
    normalizedEvent.startsWith("github.pull_request.");
  const pullRequestMerged =
    asBoolean(payload.merged_to_default) ||
    asBoolean(payload.pull_request_merged);

  if (!(isPullRequestEvent && pullRequestMerged)) {
    return { matches: false, baseBranch: "" };
  }

  if (JIRA_MERGE_DONE_BRANCH_SET.size === 0) {
    return { matches: true, baseBranch };
  }

  return {
    matches: JIRA_MERGE_DONE_BRANCH_SET.has(baseBranch),
    baseBranch,
  };
}

async function maybeTransitionMergedIssueToDone(
  event: NormalizedWebhookEvent,
): Promise<void> {
  if (!JIRA_MERGED_BRANCH_DONE_STATUS) {
    return;
  }

  const mergeCheck = isGitHubMergeToTrackedBranch(event);
  if (!mergeCheck.matches) {
    return;
  }

  const issueKey = resolveIssueKeyFromGitHubEvent(event);
  if (!issueKey) {
    console.info(
      `[WebhookTrigger] github merge detected but no Jira issue key resolved event=${event.event}`,
    );
    return;
  }

  const response = await processMCPRequest({
    jsonrpc: "2.0",
    id: `jira-merge-done-${issueKey}-${Date.now()}`,
    method: "jira.update_issue",
    params: {
      issue_key: issueKey,
      status: JIRA_MERGED_BRANCH_DONE_STATUS,
      comment: `Auto-transitioned by NexusMCP after merge to ${mergeCheck.baseBranch}.`,
    },
  });

  if (response.error) {
    console.warn(
      `[WebhookTrigger] jira done transition failed for ${issueKey}: ${response.error.message}`,
    );
    return;
  }

  console.info(
    `[WebhookTrigger] jira issue ${issueKey} moved to ${JIRA_MERGED_BRANCH_DONE_STATUS} after merge to ${mergeCheck.baseBranch}`,
  );
}

function normalizeSlackChannel(value: string): string {
  return value.trim().toLowerCase().replace(/^#/, "");
}

function shouldRunSlackWorkflow(event: NormalizedWebhookEvent): {
  allowed: boolean;
  reason?: string;
} {
  const normalizedEvent = event.event.trim().toLowerCase();
  const isMessageEvent =
    normalizedEvent === "slack.message" ||
    normalizedEvent.startsWith("slack.message.");

  if (!isMessageEvent) {
    return {
      allowed: false,
      reason: `Ignored Slack event ${event.event}; only message events can trigger workflow.`,
    };
  }

  // If allowlist is intentionally emptied, allow message events from any channel.
  if (SLACK_ALLOWED_CHANNEL_SET.size === 0) {
    return { allowed: true };
  }

  const payload = asObject(event.data);
  const candidates = [
    asString(payload.channel_name),
    asString(payload.channel),
    asString(payload.channel_id),
    asString(payload.channelId),
  ]
    .map((value) => normalizeSlackChannel(value))
    .filter(Boolean);

  if (candidates.length === 0) {
    return {
      allowed: false,
      reason:
        "Ignored Slack message event because channel information is missing.",
    };
  }

  const hasAllowedChannel = candidates.some((channel) =>
    SLACK_ALLOWED_CHANNEL_SET.has(channel),
  );

  if (hasAllowedChannel) {
    return { allowed: true };
  }

  return {
    allowed: false,
    reason: `Ignored Slack message from channel(s) ${candidates.join(", ")}; allowed channel(s): ${[...SLACK_ALLOWED_CHANNEL_SET].join(", ")}.`,
  };
}

async function fetchPlannerDag(
  event: NormalizedWebhookEvent,
): Promise<Record<string, unknown>> {
  const plannerEvent = {
    source: event.source,
    trigger: event.event,
    ...event.data,
  };

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    AGENTIC_SERVICE_TIMEOUT_MS,
  );

  try {
    const response = await fetch(
      `${AGENTIC_SERVICE_URL}/agentic/event-workflow`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ event: plannerEvent }),
        signal: controller.signal,
      },
    );

    const contentType = response.headers.get("content-type") ?? "";
    const payload = contentType.includes("application/json")
      ? await response.json()
      : await response.text();

    if (!response.ok) {
      const detail =
        typeof payload === "string"
          ? payload
          : (asObject(payload).detail ??
            asObject(payload).error ??
            "Unknown planner error");

      throw new Error(String(detail));
    }

    return asObject(payload);
  } finally {
    clearTimeout(timeout);
  }
}

function predefinedDagForWorkflow(
  workflow: RoutedWorkflow,
  event: NormalizedWebhookEvent,
): Record<string, unknown> {
  if (workflow === "JIRA_START_WORKFLOW") {
    return {
      workflow,
      trigger: event.event,
      steps: [
        {
          id: "1",
          tool: "jira.get_issue",
          input: { issue_id: event.data.issue_id ?? "{{event.issue_id}}" },
          depends_on: [],
        },
        {
          id: "2",
          tool: "github.create_branch",
          input: { branch_name: "{{steps.1.output.issue_key}}-branch" },
          depends_on: ["1"],
        },
        {
          id: "3",
          tool: "slack.send_message",
          input: {
            message: "Issue {{steps.1.output.issue_key}} processed",
          },
          depends_on: ["1"],
        },
        {
          id: "4",
          tool: "spreadsheet.add_row",
          input: {
            issue_key: "{{steps.1.output.issue_key}}",
            branch_name: "{{steps.2.output.branch_name}}",
          },
          depends_on: ["1", "2", "3"],
        },
        {
          id: "5",
          tool: "gmail.send_email",
          input: {
            subject: "Jira workflow summary",
            body: "Issue {{steps.1.output.issue_key}} completed",
          },
          depends_on: ["1", "2", "3", "4"],
        },
      ],
      planner: "mock",
    };
  }

  if (workflow === "GITHUB_START_WORKFLOW") {
    return {
      workflow,
      trigger: event.event,
      steps: [
        {
          id: "1",
          tool: "github.get_pr",
          input: {
            pr_number: event.data.pr_number ?? "{{event.pr_number}}",
            repo: event.data.repository ?? "{{event.repo}}",
          },
          depends_on: [],
        },
        {
          id: "2",
          tool: "jira.get_issue",
          input: { issue_id: "{{steps.1.output.linked_issue_id}}" },
          depends_on: ["1"],
        },
        {
          id: "3",
          tool: "slack.send_message",
          input: {
            message: "GitHub update {{steps.1.output.reference}} linked",
          },
          depends_on: ["1", "2"],
        },
        {
          id: "4",
          tool: "spreadsheet.add_row",
          input: {
            repo: "{{steps.1.output.repo}}",
            issue_key: "{{steps.2.output.issue_key}}",
          },
          depends_on: ["1", "2", "3"],
        },
        {
          id: "5",
          tool: "gmail.send_email",
          input: {
            subject: "GitHub workflow summary",
            body: "PR/branch workflow completed",
          },
          depends_on: ["1", "2", "3", "4"],
        },
      ],
      planner: "mock",
    };
  }

  return {
    workflow,
    trigger: event.event,
    steps: [
      {
        id: "1",
        tool: "slack.send_message",
        input: {
          message: event.data.text ?? "{{event.text}}",
        },
        depends_on: [],
      },
      {
        id: "2",
        tool: "jira.create_issue",
        input: {
          summary: "{{steps.1.output.intent_summary}}",
        },
        depends_on: ["1"],
      },
      {
        id: "3",
        tool: "github.create_branch",
        input: {
          branch_name: "{{steps.2.output.issue_key}}-workflow",
        },
        depends_on: ["2"],
      },
      {
        id: "4",
        tool: "spreadsheet.add_row",
        input: {
          issue_key: "{{steps.2.output.issue_key}}",
          branch_name: "{{steps.3.output.branch_name}}",
        },
        depends_on: ["1", "2", "3"],
      },
      {
        id: "5",
        tool: "gmail.send_email",
        input: {
          subject: "Slack workflow confirmation",
          body: "Intent processed and logged",
        },
        depends_on: ["1", "2", "3", "4"],
      },
    ],
    planner: "mock",
  };
}

export async function triggerWorkflow(
  event: NormalizedWebhookEvent,
): Promise<WorkflowTriggerResult> {
  const suppression = shouldSuppressWebhookEvent(event);
  if (suppression.suppress) {
    console.info(
      `[WebhookTrigger] suppressed source=${event.source} event=${event.event} reason=${suppression.reason ?? "potential loop"}`,
    );

    return {
      accepted: false,
      reason:
        suppression.reason || "Suppressed potential webhook workflow loop",
    };
  }

  const workflow = resolveWorkflowBySource(event.source);
  if (!workflow) {
    console.info(
      `[WebhookTrigger] no workflow mapping for source=${event.source} event=${event.event}`,
    );

    return {
      accepted: false,
      reason: `No workflow mapped for source ${event.source}`,
    };
  }

  if (workflow === "GITHUB_START_WORKFLOW") {
    try {
      await maybeTransitionMergedIssueToDone(event);
    } catch (error) {
      console.warn(
        `[WebhookTrigger] merge-to-done automation failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    }
  }

  if (workflow === "SLACK_START_WORKFLOW") {
    const slackGate = shouldRunSlackWorkflow(event);
    if (!slackGate.allowed) {
      console.info(
        `[WebhookTrigger] slack event ignored event=${event.event} reason=${slackGate.reason ?? "channel filter"}`,
      );

      return {
        accepted: false,
        workflow,
        reason: slackGate.reason || "Slack event did not pass channel filter",
      };
    }
  }

  console.info(
    `[WebhookTrigger] execution start workflow=${workflow} source=${event.source} event=${event.event}`,
  );

  if (ALWAYS_ON_PREDEFINED_WORKFLOWS && !WEBHOOK_USE_AGENTIC_PLANNER) {
    console.info(
      `[WebhookTrigger] always-on mode active, using predefined DAG for ${workflow}`,
    );

    const predefinedDag = predefinedDagForWorkflow(workflow, event);

    try {
      const execution = await executeWebhookWorkflow({ workflow, event });

      if (!execution) {
        console.warn(
          `[WebhookTrigger] no executor implementation for workflow=${workflow}`,
        );

        return {
          accepted: false,
          workflow,
          dag: predefinedDag,
          reason: `No execution handler registered for ${workflow}`,
        };
      }

      return {
        accepted: true,
        workflow,
        dag: { ...predefinedDag, execution },
      };
    } catch (error) {
      console.error(
        `[WebhookTrigger] default execution failed for workflow=${workflow}: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );

      return {
        accepted: false,
        workflow,
        dag: predefinedDag,
        reason: `Default workflow execution failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      };
    }
  }

  try {
    const dag = await fetchPlannerDag(event);

    return {
      accepted: true,
      workflow,
      dag,
    };
  } catch (error) {
    console.warn(
      `[WebhookTrigger] planner unavailable, using mock DAG: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
    );

    return {
      accepted: true,
      workflow,
      dag: predefinedDagForWorkflow(workflow, event),
    };
  }
}
