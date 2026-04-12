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

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => asString(entry))
    .filter((entry) => entry.length > 0);
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

const ISSUE_KEY_REGEX = /\b([a-z][a-z0-9]+-\d+)\b/i;

function extractIssueKeyFromText(value: unknown): string {
  const text = asString(value);
  if (!text) {
    return "";
  }

  const matched = text.match(ISSUE_KEY_REGEX);
  return matched?.[1] ? matched[1].toUpperCase() : "";
}

function extractFirstIssueKey(candidates: unknown[]): string {
  for (const candidate of candidates) {
    const issueKey = extractIssueKeyFromText(candidate);
    if (issueKey) {
      return issueKey;
    }
  }

  return "";
}

function normalizeBranchRef(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^refs\/heads\//, "");
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
  const pullRequest = asRecord(body.pull_request);
  const dataPullRequest = asRecord(data.pull_request);
  const prBase = asRecord(pullRequest.base);
  const dataPrBase = asRecord(dataPullRequest.base);
  const prHead = asRecord(pullRequest.head);
  const dataPrHead = asRecord(dataPullRequest.head);

  const eventHeader = headerAsString(headers, "x-github-event");
  const fallbackEvent =
    asString(body.event) ||
    asString(data.event) ||
    asString(body.action) ||
    asString(data.action);

  const eventType = formatEventName("github", eventHeader || fallbackEvent);

  const commits = Array.isArray(body.commits)
    ? body.commits
    : Array.isArray(data.commits)
      ? data.commits
      : [];
  const commitMessages: string[] = [];
  const changedFiles = new Set<string>();

  for (const commitRaw of commits) {
    const commit = asRecord(commitRaw);
    const commitMessage = asString(commit.message);
    if (commitMessage) {
      commitMessages.push(commitMessage);
    }

    for (const filename of asStringList(commit.added)) {
      changedFiles.add(filename);
    }
    for (const filename of asStringList(commit.modified)) {
      changedFiles.add(filename);
    }
    for (const filename of asStringList(commit.removed)) {
      changedFiles.add(filename);
    }
  }

  const headCommit = asRecord(body.head_commit);
  const issue = asRecord(body.issue);
  const dataIssue = asRecord(data.issue);
  const baseRef =
    asString(prBase.ref) ||
    asString(dataPrBase.ref) ||
    asString(body.base_ref) ||
    asString(data.base_ref);
  const headRef =
    asString(prHead.ref) ||
    asString(dataPrHead.ref) ||
    asString(body.head_ref) ||
    asString(data.head_ref);
  const defaultBranch =
    asString(repository.default_branch) ||
    asString(dataRepository.default_branch) ||
    "main";
  const pullRequestMerged =
    asBoolean(pullRequest.merged) || asBoolean(dataPullRequest.merged);
  const normalizedBaseRef = normalizeBranchRef(baseRef);
  const normalizedDefaultBranch = normalizeBranchRef(defaultBranch);
  const mergedToDefault =
    pullRequestMerged &&
    Boolean(normalizedBaseRef) &&
    (normalizedBaseRef === normalizedDefaultBranch ||
      normalizedBaseRef === "main" ||
      normalizedBaseRef === "master");

  const issueKey = extractFirstIssueKey([
    asString(issue.key),
    asString(dataIssue.key),
    headRef,
    asString(body.ref),
    asString(pullRequest.title),
    asString(dataPullRequest.title),
    asString(pullRequest.body),
    asString(dataPullRequest.body),
    asString(headCommit.message),
    ...commitMessages,
  ]);

  return {
    source: "github",
    event: eventType,
    data: {
      delivery_id: headerAsString(headers, "x-github-delivery"),
      repository:
        asString(repository.full_name) ||
        asString(repository.name) ||
        asString(dataRepository.full_name) ||
        asString(dataRepository.name) ||
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
      commit_count: commits.length,
      changed_files: [...changedFiles].slice(0, 100),
      compare_url: asString(body.compare) || asString(data.compare),
      head_commit_message:
        asString(headCommit.message) ||
        asString(asRecord(data.head_commit).message),
      issue_key: issueKey,
      pull_request_number:
        asString(pullRequest.number) || asString(dataPullRequest.number),
      pull_request_title:
        asString(pullRequest.title) || asString(dataPullRequest.title),
      pull_request_body:
        asString(pullRequest.body) || asString(dataPullRequest.body),
      pull_request_merged: pullRequestMerged,
      base_ref: baseRef,
      head_ref: headRef,
      default_branch: defaultBranch,
      merged_to_default: mergedToDefault,
      commit_messages: commitMessages.slice(0, 100),
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
  const bodyChannel = asRecord(body.channel);
  const dataChannel = asRecord(data.channel);
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

  const channelId =
    asString(eventBody.channel) ||
    asString(dataEventBody.channel) ||
    asString(body.channel) ||
    asString(data.channel) ||
    asString(bodyChannel.id) ||
    asString(dataChannel.id);

  const channelName =
    asString(eventBody.channel_name) ||
    asString(dataEventBody.channel_name) ||
    asString(body.channel_name) ||
    asString(data.channel_name) ||
    asString(bodyChannel.name) ||
    asString(dataChannel.name);

  const text =
    asString(eventBody.text) ||
    asString(dataEventBody.text) ||
    asString(body.text) ||
    asString(data.text);

  const branchName =
    asString(eventBody.branch_name) ||
    asString(dataEventBody.branch_name) ||
    asString(body.branch_name) ||
    asString(data.branch_name) ||
    asString(eventBody.branch) ||
    asString(dataEventBody.branch) ||
    asString(body.branch) ||
    asString(data.branch);

  const ref =
    asString(eventBody.ref) ||
    asString(dataEventBody.ref) ||
    asString(body.ref) ||
    asString(data.ref);

  const issueKey = extractFirstIssueKey([
    asString(eventBody.issue_key),
    asString(dataEventBody.issue_key),
    asString(body.issue_key),
    asString(data.issue_key),
    branchName,
    ref,
    text,
  ]);

  return {
    source: "slack",
    event: eventType,
    data: {
      text,
      user:
        asString(eventBody.user) ||
        asString(dataEventBody.user) ||
        asString(body.user) ||
        asString(data.user) ||
        "unknown-user",
      channel: channelName || channelId || "unknown-channel",
      channel_id: channelId,
      channel_name: channelName,
      ts: asString(eventBody.ts) || asString(dataEventBody.ts),
      issue_key: issueKey,
      branch_name: branchName,
      ref,
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
