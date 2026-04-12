import type {
  NormalizedWebhookEvent,
  RoutedWorkflow,
  WorkflowTriggerResult,
} from "../types/webhook.js";
import { executeWebhookWorkflow } from "./webhook-workflow-executor.js";

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

      return {
        accepted: true,
        workflow,
        dag: execution ? { ...predefinedDag, execution } : predefinedDag,
      };
    } catch (error) {
      console.error(
        `[WebhookTrigger] default execution failed for workflow=${workflow}: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );

      return {
        accepted: true,
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
