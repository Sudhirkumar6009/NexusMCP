export type WebhookSource =
  | "github"
  | "jira"
  | "slack";

export type RoutedWorkflow =
  | "GITHUB_START_WORKFLOW"
  | "JIRA_START_WORKFLOW"
  | "SLACK_START_WORKFLOW";

export interface NormalizedWebhookEvent {
  source: WebhookSource;
  event: string;
  data: Record<string, unknown>;
}

export interface QueuedWebhookEvent extends NormalizedWebhookEvent {
  idempotencyKey: string;
  receivedAt: string;
}

export interface WorkflowTriggerResult {
  accepted: boolean;
  workflow?: RoutedWorkflow;
  dag?: Record<string, unknown>;
  reason?: string;
}

export interface QueueEnqueueResult {
  accepted: boolean;
  duplicate: boolean;
  queueSize: number;
  idempotencyKey: string;
}
