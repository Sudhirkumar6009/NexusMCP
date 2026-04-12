import { v4 as uuidv4 } from "uuid";
import { createSign } from "crypto";
import { dataStore } from "../data/store.js";
import type {
  DAGNode,
  Integration,
  MCPError,
  MCPRequest,
  MCPResponse,
} from "../types/index.js";

// MCP Method handlers
type MCPHandler = (params: Record<string, unknown>) => Promise<unknown>;

type GatewayRegistration = {
  name: string;
  endpoint: string;
};

type JsonRecord = Record<string, unknown>;

type GitHubConfig = {
  baseUrl: string;
  authHeaders: string[];
};

type JiraConfig = {
  baseUrl: string;
  email: string;
  apiToken: string;
};

type SlackConfig = {
  token: string;
};

type SlackMessageDispatchOptions = {
  tokenCandidates: string[];
  webhookUrl?: string;
};

type GmailConfig = {
  accessToken: string;
  refreshToken?: string;
};

const GMAIL_READ_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const GMAIL_COMPOSE_SCOPE = "https://www.googleapis.com/auth/gmail.compose";
const GMAIL_MODIFY_SCOPE = "https://www.googleapis.com/auth/gmail.modify";

type GoogleServiceAccountCredentials = {
  client_email: string;
  private_key: string;
  token_uri?: string;
  project_id?: string;
  spreadsheet_id?: string;
};

type SheetsConfig = {
  spreadsheetId: string;
  accessToken?: string;
  apiKey?: string;
};

type ConnectedServiceId =
  | "jira"
  | "github"
  | "slack"
  | "google_sheets"
  | "gmail";

const METHOD_ALIASES: Record<string, string> = {
  "jira.create_issue": "jira.createIssue",
  jira_create_issue: "jira.createIssue",
  "jira.get_issue": "jira.getIssue",
  jira_get_issue: "jira.getIssue",
  "jira.search_issues": "jira.getIssues",
  jira_search: "jira.getIssues",
  "jira.get_issues": "jira.getIssues",
  "jira.update_issue": "jira.updateIssue",
  jira_update_issue: "jira.updateIssue",
  "jira.add_comment": "jira.addComment",
  jira_add_comment: "jira.addComment",
  "github.create_issue": "github.createIssue",
  github_create_issue: "github.createIssue",
  "github.get_repository": "github.getRepository",
  github_get_repository: "github.getRepository",
  "github.create_pr": "github.createPullRequest",
  github_create_pr: "github.createPullRequest",
  "github.create_pull_request": "github.createPullRequest",
  github_create_pull_request: "github.createPullRequest",
  "github.merge_pull_request": "github.mergePullRequest",
  github_merge_pull_request: "github.mergePullRequest",
  "github.merge_pr": "github.mergePullRequest",
  github_merge_pr: "github.mergePullRequest",
  "github.create_branch": "github.createBranch",
  github_create_branch: "github.createBranch",
  "github.get_branch": "github.getBranch",
  github_get_branch: "github.getBranch",
  "github.delete_branch": "github.deleteBranch",
  github_delete_branch: "github.deleteBranch",
  "github.create_file": "github.createOrUpdateFile",
  github_create_file: "github.createOrUpdateFile",
  "github.update_file": "github.createOrUpdateFile",
  github_update_file: "github.createOrUpdateFile",
  "github.create_or_update_file": "github.createOrUpdateFile",
  github_create_or_update_file: "github.createOrUpdateFile",
  "github.commit_file": "github.createOrUpdateFile",
  github_commit_file: "github.createOrUpdateFile",
  "github.trigger_workflow": "github.triggerWorkflow",
  github_trigger_workflow: "github.triggerWorkflow",
  "github.get_workflow_status": "github.getWorkflowStatus",
  github_get_workflow_status: "github.getWorkflowStatus",
  "github.listen_repo_events": "github.listenRepoEvents",
  github_listen_repo_events: "github.listenRepoEvents",
  "github.list_repositories": "github.listRepositories",
  github_list_repositories: "github.listRepositories",
  "github.check_connection": "github.checkConnection",
  github_check_connection: "github.checkConnection",
  "slack.send_message": "slack.sendMessage",
  slack_send_message: "slack.sendMessage",
  "slack.post_message": "slack.sendMessage",
  slack_post_message: "slack.sendMessage",
  "slack.list_channels": "slack.getChannels",
  "slack.get_channels": "slack.getChannels",
  slack_get_channels: "slack.getChannels",
  "slack.send_dm": "slack.sendDirectMessage",
  slack_send_dm: "slack.sendDirectMessage",
  "slack.post_dm": "slack.sendDirectMessage",
  slack_post_dm: "slack.sendDirectMessage",
  "slack.create_channel": "slack.createChannel",
  slack_create_channel: "slack.createChannel",
  "slack.update_message": "slack.updateMessage",
  slack_update_message: "slack.updateMessage",
  "slack.get_channel": "slack.getChannel",
  slack_get_channel: "slack.getChannel",
  "slack.get_user": "slack.getUser",
  slack_get_user: "slack.getUser",
  "slack.reply_in_thread": "slack.replyInThread",
  slack_reply_in_thread: "slack.replyInThread",
  "slack.get_thread_messages": "slack.getThreadMessages",
  slack_get_thread_messages: "slack.getThreadMessages",
  "slack.listen_slack_events": "slack.listenSlackEvents",
  slack_listen_slack_events: "slack.listenSlackEvents",
  "slack.handle_interactions": "slack.handleInteractions",
  slack_handle_interactions: "slack.handleInteractions",
  "slack.post_thread_reply": "slack.postThreadReply",
  slack_post_thread_reply: "slack.postThreadReply",
  "slack.delete_message": "slack.deleteMessage",
  slack_delete_message: "slack.deleteMessage",
  "slack.archive_channel": "slack.archiveChannel",
  slack_archive_channel: "slack.archiveChannel",
  "slack.invite_to_channel": "slack.inviteToChannel",
  slack_invite_to_channel: "slack.inviteToChannel",
  "slack.set_channel_topic": "slack.setChannelTopic",
  slack_set_channel_topic: "slack.setChannelTopic",
  "slack.get_user_by_email": "slack.getUserByEmail",
  slack_get_user_by_email: "slack.getUserByEmail",
  "slack.get_user_status": "slack.getUserStatus",
  slack_get_user_status: "slack.getUserStatus",
  "slack.list_team_members": "slack.listTeamMembers",
  slack_list_team_members: "slack.listTeamMembers",
  "slack.send_interactive_message": "slack.sendInteractiveMessage",
  slack_send_interactive_message: "slack.sendInteractiveMessage",
  "slack.schedule_message": "slack.scheduleMessage",
  slack_schedule_message: "slack.scheduleMessage",
  "slack.create_poll": "slack.createPoll",
  slack_create_poll: "slack.createPoll",
  "slack.wait_for_user_response": "slack.waitForUserResponse",
  slack_wait_for_user_response: "slack.waitForUserResponse",
  "slack.get_on_call_schedule": "slack.getOnCallSchedule",
  slack_get_on_call_schedule: "slack.getOnCallSchedule",
  "google_sheets.read_sheet": "sheets.readRange",
  google_sheets_read_sheet: "sheets.readRange",
  "google_sheets.read_rows": "sheets.readRange",
  "sheets.read_range": "sheets.readRange",
  sheets_read_range: "sheets.readRange",
  "sheets.read_sheet": "sheets.readRange",
  sheets_read: "sheets.readRange",
  "google_sheets.append_rows": "sheets.appendRow",
  "google_sheets.append_row": "sheets.appendRow",
  "google_sheets.insert_row": "sheets.appendRow",
  "google_sheets.add_row": "sheets.addRow",
  google_sheets_add_row: "sheets.addRow",
  "sheets.append_row": "sheets.appendRow",
  sheets_append_row: "sheets.appendRow",
  "sheets.insert_row": "sheets.appendRow",
  "sheets.add_row": "sheets.addRow",
  sheets_add_row: "sheets.addRow",
  "google_sheets.get_rows": "sheets.getRows",
  google_sheets_get_rows: "sheets.getRows",
  "sheets.get_rows": "sheets.getRows",
  sheets_get_rows: "sheets.getRows",
  "google_sheets.update_cells": "sheets.updateCells",
  "google_sheets.update_row": "sheets.updateRow",
  google_sheets_update_row: "sheets.updateRow",
  "sheets.update_cells": "sheets.updateCells",
  sheets_update_cells: "sheets.updateCells",
  "sheets.update_row": "sheets.updateRow",
  sheets_update_row: "sheets.updateRow",
  "google_sheets.delete_row": "sheets.deleteRow",
  google_sheets_delete_row: "sheets.deleteRow",
  "sheets.delete_row": "sheets.deleteRow",
  sheets_delete_row: "sheets.deleteRow",
  "google_sheets.query_rows": "sheets.queryRows",
  google_sheets_query_rows: "sheets.queryRows",
  "sheets.query_rows": "sheets.queryRows",
  sheets_query_rows: "sheets.queryRows",
  "google_sheets.list_sheets": "sheets.listSheets",
  google_sheets_list_sheets: "sheets.listSheets",
  "sheets.list_sheets": "sheets.listSheets",
  sheets_list_sheets: "sheets.listSheets",
  "sheets.append_rows": "sheets.appendRow",
  sheets_append_rows: "sheets.appendRow",
  "sheets.write_cells": "sheets.updateCells",
  sheets_write_cells: "sheets.updateCells",
  "spreadsheet.add_row": "sheets.addRow",
  spreadsheet_add_row: "sheets.addRow",
  "spreadsheet.append_row": "sheets.appendRow",
  spreadsheet_append_row: "sheets.appendRow",
  "spreadsheet.get_rows": "sheets.getRows",
  spreadsheet_get_rows: "sheets.getRows",
  "spreadsheet.read_range": "sheets.readRange",
  spreadsheet_read_range: "sheets.readRange",
  "spreadsheet.update_row": "sheets.updateRow",
  spreadsheet_update_row: "sheets.updateRow",
  "spreadsheet.delete_row": "sheets.deleteRow",
  spreadsheet_delete_row: "sheets.deleteRow",
  "spreadsheet.list_sheets": "sheets.listSheets",
  spreadsheet_list_sheets: "sheets.listSheets",
  "gmail.list_messages": "gmail.listMessages",
  gmail_list_messages: "gmail.listMessages",
  "gmail.search_messages": "gmail.listMessages",
  gmail_search_messages: "gmail.listMessages",
  "gmail.read_messages": "gmail.listMessages",
  gmail_read_messages: "gmail.listMessages",
  "gmail.send_message": "gmail.sendMessage",
  gmail_send_message: "gmail.sendMessage",
  "gmail.send_email": "gmail.sendMessage",
  gmail_send_email: "gmail.sendMessage",
  "gmail.send_mail": "gmail.sendMessage",
  gmail_send_mail: "gmail.sendMessage",
  "gmail.create_draft": "gmail.createDraft",
  gmail_create_draft: "gmail.createDraft",
  "gmail.draft_message": "gmail.createDraft",
  gmail_draft_message: "gmail.createDraft",
  "gmail.send": "gmail.sendMessage",
  gmail_send: "gmail.sendMessage",
  "gmail.read_email": "gmail.readEmail",
  gmail_read_email: "gmail.readEmail",
  "gmail.get_email": "gmail.readEmail",
  gmail_get_email: "gmail.readEmail",
  "gmail.search_emails": "gmail.searchEmails",
  gmail_search_emails: "gmail.searchEmails",
  "gmail.parse_email": "gmail.parseEmail",
  gmail_parse_email: "gmail.parseEmail",
  "gmail.add_label": "gmail.addLabel",
  gmail_add_label: "gmail.addLabel",
  "gmail.get_thread": "gmail.getThread",
  gmail_get_thread: "gmail.getThread",
  "gmail.reply_email": "gmail.replyEmail",
  gmail_reply_email: "gmail.replyEmail",
  "gmail.get_attachments": "gmail.getAttachments",
  gmail_get_attachments: "gmail.getAttachments",
  "gmail.listen_email_events": "gmail.listenEmailEvents",
  gmail_listen_email_events: "gmail.listenEmailEvents",
};

const registeredGateways: Record<string, GatewayRegistration> = {
  jira: {
    name: "jira",
    endpoint:
      process.env.JIRA_GATEWAY_ENDPOINT || "http://localhost:8001/invoke",
  },
};

function asRecord(value: unknown): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as JsonRecord;
}

function pickString(params: JsonRecord, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = params[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function parseBodyAsList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function parseBodyAsRecord(value: unknown): JsonRecord {
  return asRecord(value);
}

function parseJsonLikePayload(value: unknown): JsonRecord {
  if (typeof value !== "string") {
    return asRecord(value);
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return {};
  }

  if (trimmed.startsWith("payload=")) {
    const encoded = trimmed.slice("payload=".length);
    try {
      return asRecord(JSON.parse(decodeURIComponent(encoded)));
    } catch {
      return {};
    }
  }

  try {
    return asRecord(JSON.parse(trimmed));
  } catch {
    return {};
  }
}

function parseIssueKeyFromPrompt(prompt: string): string | undefined {
  const match = prompt.match(/\b([A-Z][A-Z0-9]+-\d+)\b/);
  return match?.[1];
}

function parseIssueKeysFromPrompt(prompt: string): string[] {
  const collected: string[] = [];
  const seen = new Set<string>();

  const directMatches = prompt.match(/\b([A-Z][A-Z0-9]+-\d+)\b/g) || [];
  for (const issueKey of directMatches) {
    const normalized = issueKey.toUpperCase();
    if (!seen.has(normalized)) {
      seen.add(normalized);
      collected.push(normalized);
    }
  }

  const rangePattern =
    /\b([A-Z][A-Z0-9]+)-(\d+)\s*(?:to|-)\s*(?:([A-Z][A-Z0-9]+)-)?(\d+)\b/i;
  const rangeMatch = prompt.match(rangePattern);
  if (rangeMatch) {
    const startPrefix = (rangeMatch[1] || "").toUpperCase();
    const startRaw = Number(rangeMatch[2]);
    const endPrefix = (rangeMatch[3] || startPrefix).toUpperCase();
    const endRaw = Number(rangeMatch[4]);

    if (
      startPrefix &&
      endPrefix &&
      startPrefix === endPrefix &&
      Number.isFinite(startRaw) &&
      Number.isFinite(endRaw)
    ) {
      const start = Math.floor(Math.min(startRaw, endRaw));
      const end = Math.floor(Math.max(startRaw, endRaw));
      if (end - start <= 200) {
        for (let value = start; value <= end; value += 1) {
          const key = `${startPrefix}-${value}`;
          if (!seen.has(key)) {
            seen.add(key);
            collected.push(key);
          }
        }
      }
    }
  }

  return collected;
}

function parseRepoFromPrompt(prompt: string): string | undefined {
  const patterns = [
    /(?:repo|repository)(?:\s+(?:is|as|named|name))?\s+([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+|[A-Za-z0-9_.-]+)/i,
    /\bin\s+([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\b/i,
  ];

  const invalidTokens = new Set([
    "repo",
    "repository",
    "as",
    "is",
    "name",
    "named",
  ]);

  for (const pattern of patterns) {
    const match = prompt.match(pattern);
    const candidate = match?.[1]?.trim();
    if (!candidate) {
      continue;
    }

    if (invalidTokens.has(candidate.toLowerCase())) {
      continue;
    }

    return candidate;
  }

  return undefined;
}

function normalizeRepositoryIdentifier(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "";
  }

  const urlMatch = trimmed.match(
    /github\.com[/:]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:\/|$)/i,
  );
  if (urlMatch) {
    const owner = urlMatch[1]?.trim();
    const repo = urlMatch[2]?.trim();
    if (owner && repo) {
      return `${owner}/${repo}`;
    }
  }

  return trimmed.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "");
}

function resolveDefaultRepositoryFromEnv(): string | undefined {
  const candidates = [
    process.env.GITHUB_DEFAULT_REPO,
    process.env.GITHUB_REPO,
    process.env.REPO,
  ];

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "string") {
      continue;
    }

    const normalized = normalizeRepositoryIdentifier(candidate);
    if (normalized && normalized.includes("/")) {
      return normalized;
    }
  }

  return undefined;
}

function resolveDefaultOwnerFromEnv(): string | undefined {
  const direct =
    typeof process.env.GITHUB_DEFAULT_OWNER === "string"
      ? process.env.GITHUB_DEFAULT_OWNER.trim()
      : "";
  if (direct) {
    return direct;
  }

  const fromRepo = resolveDefaultRepositoryFromEnv();
  if (!fromRepo) {
    return undefined;
  }

  const [owner] = fromRepo.split("/", 1);
  return owner || undefined;
}

function normalizeErrorDetail(payload: unknown, fallback: string): string {
  if (typeof payload === "string" && payload.trim().length > 0) {
    return payload.trim();
  }

  const record = asRecord(payload);
  if (typeof record.message === "string" && record.message.trim().length > 0) {
    return record.message.trim();
  }

  if (typeof record.error === "string" && record.error.trim().length > 0) {
    return record.error.trim();
  }

  if (typeof record.detail === "string" && record.detail.trim().length > 0) {
    return record.detail.trim();
  }

  const nestedError = asRecord(record.error);
  if (
    typeof nestedError.message === "string" &&
    nestedError.message.trim().length > 0
  ) {
    return nestedError.message.trim();
  }

  if (
    typeof nestedError.detail === "string" &&
    nestedError.detail.trim().length > 0
  ) {
    return nestedError.detail.trim();
  }

  const nestedErrors = parseBodyAsList(nestedError.errors)
    .map((entry) => {
      const item = asRecord(entry);
      return (
        pickString(item, ["message", "reason", "domain"]) ||
        (typeof item === "string" ? item : "")
      );
    })
    .filter((value): value is string => value.trim().length > 0);

  if (nestedErrors.length > 0) {
    return nestedErrors.join("; ");
  }

  return fallback;
}

function isPlaceholderValue(raw: string | undefined): boolean {
  if (!raw) {
    return true;
  }

  const normalized = raw.trim().toLowerCase();

  // Only reject actual placeholder patterns like <field_name> or {field_name}
  // Do NOT reject valid values like "repo", "repository", "issue" - these could be actual names
  if (normalized.length === 0) {
    return true;
  }

  // Match placeholder patterns: <something> or {something} or [something]
  const placeholderPattern = /^[<\[{][^<>\[\]{}]+[>\]}]$/;
  if (placeholderPattern.test(normalized)) {
    return true;
  }

  // Match template variable patterns like {{variable}} or ${variable}
  const templatePattern = /^(\$\{|\{\{)[^{}]+(\}|\}\})$/;
  if (templatePattern.test(normalized)) {
    return true;
  }

  if (
    normalized.includes("from-request") ||
    normalized.includes("placeholder")
  ) {
    return true;
  }

  return false;
}

function extractSpreadsheetIdFromText(
  raw: string | undefined,
): string | undefined {
  if (!raw) {
    return undefined;
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }

  const directUrlMatch = trimmed.match(
    /\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/i,
  );
  if (directUrlMatch?.[1]) {
    return directUrlMatch[1];
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return undefined;
  }

  return trimmed;
}

function isLikelySpreadsheetId(raw: string | undefined): boolean {
  if (!raw) {
    return false;
  }

  const candidate = raw.trim();
  if (!candidate || isPlaceholderValue(candidate)) {
    return false;
  }

  if (!/^[A-Za-z0-9_-]+$/.test(candidate)) {
    return false;
  }

  if (candidate.length < 20) {
    return false;
  }

  // Reject issue/branch-like identifiers such as KAN-9-fix-readme-line-20.
  if (/^[A-Z][A-Z0-9]+-\d+(?:-|$)/.test(candidate)) {
    return false;
  }

  return true;
}

async function parseResponseBody(response: Awaited<ReturnType<typeof fetch>>) {
  const raw = await response.text();
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

const INTEGRATION_ID_MAP: Record<ConnectedServiceId | "sheets", string> = {
  jira: "int-jira",
  github: "int-github",
  slack: "int-slack",
  sheets: "int-google-sheets",
  google_sheets: "int-google-sheets",
  gmail: "int-gmail",
};

const SERVICE_DISPLAY_NAME: Record<ConnectedServiceId, string> = {
  jira: "Jira",
  github: "GitHub",
  slack: "Slack",
  google_sheets: "Google Sheets",
  gmail: "Gmail",
};

function getConnectedIntegration(service: ConnectedServiceId): Integration {
  const integrationId = INTEGRATION_ID_MAP[service];
  const integration = dataStore.getIntegration(integrationId);

  if (!integration || integration.status !== "connected") {
    throw new Error(
      `${SERVICE_DISPLAY_NAME[service]} integration is not connected. Connect it from Integrations before running execution.`,
    );
  }

  return integration;
}

function isIntegrationConnected(
  service: "jira" | "github" | "slack" | "sheets" | "google_sheets" | "gmail",
): boolean {
  const integrationId = INTEGRATION_ID_MAP[service];
  if (!integrationId) {
    return false;
  }

  const integration = dataStore.getIntegration(integrationId);
  return integration?.status === "connected";
}

function getConnectedServices(): string[] {
  const services = ["jira", "github", "slack", "sheets", "gmail"] as const;
  return services.filter((svc) => isIntegrationConnected(svc));
}

function parseExpiresInSeconds(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed);
    }
  }

  return 3600;
}

function getGoogleOAuthClientCredentials() {
  return {
    clientId:
      (typeof process.env.GOOGLE_CLIENT_ID === "string"
        ? process.env.GOOGLE_CLIENT_ID
        : process.env.GOOGLE_CLIENT || "") || "",
    clientSecret:
      (typeof process.env.GOOGLE_CLIENT_SECRET === "string"
        ? process.env.GOOGLE_CLIENT_SECRET
        : "") || "",
  };
}

async function exchangeGoogleRefreshToken(refreshToken: string): Promise<{
  accessToken: string;
  expiresIn: number;
}> {
  const { clientId, clientSecret } = getGoogleOAuthClientCredentials();

  if (!clientId || !clientSecret) {
    throw new Error(
      "Google OAuth client credentials are not configured on the server (GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET).",
    );
  }

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  });

  const payload = await parseResponseBody(tokenResponse);

  if (!tokenResponse.ok) {
    throw new Error(
      `Google token refresh failed (${tokenResponse.status}): ${normalizeErrorDetail(
        payload,
        tokenResponse.statusText || "Unknown Google OAuth error",
      )}`,
    );
  }

  const record = parseBodyAsRecord(payload);
  const accessToken = pickString(record, ["access_token"]);
  if (!accessToken) {
    throw new Error(
      "Google token refresh succeeded but response did not include access_token.",
    );
  }

  return {
    accessToken,
    expiresIn: parseExpiresInSeconds(record.expires_in),
  };
}

function base64UrlEncode(content: string): string {
  return Buffer.from(content, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

type GmailAttachmentInput = {
  filename: string;
  contentType?: string;
  contentBase64?: string;
  content?: string;
  data?: string;
};

function buildGmailRawMessage(args: {
  to: string;
  subject: string;
  text?: string;
  html?: string;
  attachments?: GmailAttachmentInput[];
  additionalHeaders?: string[];
}): string {
  const bodyContentType = args.html
    ? "text/html; charset=UTF-8"
    : "text/plain; charset=UTF-8";
  const body = args.html || args.text || "";
  const attachments = Array.isArray(args.attachments)
    ? args.attachments.filter(
        (entry): entry is GmailAttachmentInput =>
          !!entry &&
          typeof entry === "object" &&
          typeof entry.filename === "string" &&
          entry.filename.trim().length > 0,
      )
    : [];
  const extraHeaders = Array.isArray(args.additionalHeaders)
    ? args.additionalHeaders.filter(
        (value): value is string =>
          typeof value === "string" && value.trim().length > 0,
      )
    : [];

  const headers = [
    "MIME-Version: 1.0",
    `To: ${args.to}`,
    `Subject: ${args.subject}`,
    ...extraHeaders,
  ];

  let rawMessage = "";
  if (attachments.length === 0) {
    rawMessage = [
      ...headers,
      `Content-Type: ${bodyContentType}`,
      "",
      body,
    ].join("\r\n");
  } else {
    const boundary = `nexusmcp_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const lines: string[] = [
      ...headers,
      `Content-Type: multipart/mixed; boundary=\"${boundary}\"`,
      "",
      `--${boundary}`,
      `Content-Type: ${bodyContentType}`,
      "Content-Transfer-Encoding: 7bit",
      "",
      body,
    ];

    for (const attachment of attachments) {
      const encoded = (attachment.contentBase64 || attachment.data || "")
        .trim()
        .replace(/-/g, "+")
        .replace(/_/g, "/");

      const base64Data =
        encoded ||
        Buffer.from(attachment.content || "", "utf8").toString("base64");
      const safeName = attachment.filename.replace(/\"/g, "");

      lines.push(
        `--${boundary}`,
        `Content-Type: ${attachment.contentType || "application/octet-stream"}; name=\"${safeName}\"`,
        "Content-Transfer-Encoding: base64",
        `Content-Disposition: attachment; filename=\"${safeName}\"`,
        "",
        base64Data,
      );
    }

    lines.push(`--${boundary}--`, "");
    rawMessage = lines.join("\r\n");
  }

  return base64UrlEncode(rawMessage);
}

function decodeBase64UrlToUtf8(value: string): string {
  const normalized = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Buffer.from(normalized, "base64").toString("utf8");
}

function getGmailHeaderMap(headersValue: unknown): Record<string, string> {
  const map: Record<string, string> = {};
  for (const rawHeader of parseBodyAsList(headersValue)) {
    const header = parseBodyAsRecord(rawHeader);
    const name = pickString(header, ["name"]);
    if (!name) {
      continue;
    }

    const value = pickString(header, ["value"]) || "";
    map[name.toLowerCase()] = value;
  }
  return map;
}

function extractMessageAddress(value: string): string {
  const match = value.match(/<([^>]+)>/);
  if (match && match[1]) {
    return match[1].trim();
  }
  return value.trim();
}

function collectGmailAttachments(
  payloadPart: JsonRecord,
  result: JsonRecord[] = [],
): JsonRecord[] {
  const body = parseBodyAsRecord(payloadPart.body);
  const filename = pickString(payloadPart, ["filename"]);
  const attachmentId = pickString(body, ["attachmentId"]);

  if (filename || attachmentId) {
    result.push({
      filename: filename || "attachment",
      mimeType: pickString(payloadPart, ["mimeType"]),
      attachmentId,
      size:
        typeof body.size === "number"
          ? body.size
          : typeof payloadPart.size === "number"
            ? payloadPart.size
            : undefined,
      inlineData: pickString(body, ["data"]),
    });
  }

  for (const child of parseBodyAsList(payloadPart.parts)) {
    collectGmailAttachments(parseBodyAsRecord(child), result);
  }

  return result;
}

function summarizeGmailMessage(messagePayload: JsonRecord): JsonRecord {
  const payload = parseBodyAsRecord(messagePayload.payload);
  const headers = getGmailHeaderMap(payload.headers);
  return {
    id: pickString(messagePayload, ["id"]),
    threadId: pickString(messagePayload, ["threadId"]),
    labelIds: parseBodyAsList(messagePayload.labelIds).filter(
      (entry): entry is string => typeof entry === "string",
    ),
    snippet: pickString(messagePayload, ["snippet"]),
    internalDate: pickString(messagePayload, ["internalDate"]),
    subject: headers.subject || "",
    from: headers.from || "",
    to: headers.to || "",
  };
}

function parseGoogleServiceAccountJson(
  raw: string,
): GoogleServiceAccountCredentials {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Invalid Google service account JSON.");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid Google service account JSON format.");
  }

  const data = parsed as Record<string, unknown>;
  const clientEmail = pickString(data, ["client_email"]);
  const privateKey = pickString(data, ["private_key"]);

  if (!clientEmail || !privateKey) {
    throw new Error(
      "Google service account JSON must include client_email and private_key.",
    );
  }

  return {
    client_email: clientEmail,
    private_key: privateKey,
    token_uri: pickString(data, ["token_uri"]),
    project_id: pickString(data, ["project_id"]),
    spreadsheet_id: pickString(data, ["spreadsheet_id"]),
  };
}

async function fetchGoogleServiceAccountAccessToken(
  account: GoogleServiceAccountCredentials,
  scope: string,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const tokenUri = account.token_uri || "https://oauth2.googleapis.com/token";

  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", typ: "JWT" }),
    "utf8",
  ).toString("base64url");

  const payload = Buffer.from(
    JSON.stringify({
      iss: account.client_email,
      scope,
      aud: tokenUri,
      iat: now,
      exp: now + 3600,
    }),
    "utf8",
  ).toString("base64url");

  const signingInput = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();

  const privateKey = account.private_key.includes("\\n")
    ? account.private_key.replace(/\\n/g, "\n")
    : account.private_key;

  const signature = signer.sign(privateKey, "base64url");
  const assertion = `${signingInput}.${signature}`;

  const tokenResponse = await fetch(tokenUri, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }).toString(),
  });

  const payloadResponse = await parseResponseBody(tokenResponse);

  if (!tokenResponse.ok) {
    throw new Error(
      `Google service account token exchange failed (${tokenResponse.status}): ${normalizeErrorDetail(
        payloadResponse,
        tokenResponse.statusText || "Unknown Google OAuth error",
      )}`,
    );
  }

  const tokenPayload = parseBodyAsRecord(payloadResponse);
  const accessToken = pickString(tokenPayload, ["access_token"]);
  if (!accessToken) {
    throw new Error(
      "Google service account token exchange succeeded but no access_token was returned.",
    );
  }

  return accessToken;
}

function getGitHubConfig(params: JsonRecord): GitHubConfig {
  const integration = getConnectedIntegration("github");
  const credentials = asRecord(integration.credentials);

  const tokenRaw =
    pickString(params, ["accessToken", "apiKey"]) ||
    pickString(credentials, ["accessToken", "apiKey"]) ||
    (typeof process.env.GITHUB_TOKEN === "string"
      ? process.env.GITHUB_TOKEN.trim()
      : "");

  if (!tokenRaw) {
    throw new Error("GitHub token is missing from connected integration.");
  }

  const baseUrl = (
    pickString(params, ["baseUrl"]) ||
    pickString(credentials, ["baseUrl"]) ||
    process.env.GITHUB_API_URL ||
    "https://api.github.com"
  )
    .trim()
    .replace(/\/+$/, "");

  const authHeaders = /^(Bearer|token)\s+/i.test(tokenRaw)
    ? [tokenRaw]
    : [`Bearer ${tokenRaw}`, `token ${tokenRaw}`];

  return {
    baseUrl,
    authHeaders,
  };
}

function getJiraConfig(params: JsonRecord): JiraConfig {
  const integration = getConnectedIntegration("jira");
  const credentials = asRecord(integration.credentials);

  const baseUrl = (
    pickString(params, ["baseUrl"]) ||
    pickString(credentials, ["baseUrl"]) ||
    process.env.JIRA_BASE_URL ||
    process.env.JIRA_URL ||
    ""
  )
    .trim()
    .replace(/\/+$/, "");

  const email = (
    pickString(params, ["username", "email"]) ||
    pickString(credentials, ["username", "email"]) ||
    process.env.JIRA_EMAIL ||
    ""
  ).trim();

  const apiToken = (
    pickString(params, ["apiKey", "apiToken", "token"]) ||
    pickString(credentials, ["apiKey", "apiToken", "token"]) ||
    process.env.JIRA_API_TOKEN ||
    process.env.JIRA_TOKEN ||
    ""
  ).trim();

  if (!baseUrl || !email || !apiToken) {
    throw new Error(
      "Jira credentials are incomplete. Ensure connected integration has baseUrl, username, and apiKey.",
    );
  }

  return {
    baseUrl,
    email,
    apiToken,
  };
}

function getSlackConfig(params: JsonRecord): SlackConfig {
  const integration = getConnectedIntegration("slack");
  const credentials = asRecord(integration.credentials);

  const token = (
    pickString(params, ["accessToken", "apiKey", "token"]) ||
    pickString(credentials, ["accessToken", "apiKey", "token"]) ||
    process.env.SLACK_BOT_TOKEN ||
    process.env.SLACK_TOKEN ||
    ""
  ).trim();

  if (!token) {
    throw new Error(
      "Slack token is missing from connected integration. Connect Slack with a bot/user token.",
    );
  }

  return { token };
}

function getSlackMessageDispatchOptions(
  params: JsonRecord,
): SlackMessageDispatchOptions {
  const integration = getConnectedIntegration("slack");
  const credentials = asRecord(integration.credentials);

  const tokenCandidates = [
    pickString(params, ["accessToken", "apiKey", "token"]),
    pickString(credentials, ["accessToken", "apiKey", "token"]),
    typeof process.env.SLACK_BOT_TOKEN === "string"
      ? process.env.SLACK_BOT_TOKEN.trim()
      : undefined,
    typeof process.env.SLACK_TOKEN === "string"
      ? process.env.SLACK_TOKEN.trim()
      : undefined,
  ]
    .filter((value): value is string => Boolean(value && value.trim()))
    .map((value) => value.trim());

  const dedupedTokens = Array.from(new Set(tokenCandidates));

  const webhookUrl =
    pickString(params, ["webhookUrl", "webhook_url"]) ||
    pickString(credentials, ["webhookUrl", "webhook_url"]) ||
    (typeof process.env.SLACK_WEBHOOK_URL === "string"
      ? process.env.SLACK_WEBHOOK_URL.trim()
      : undefined);

  return {
    tokenCandidates: dedupedTokens,
    ...(webhookUrl ? { webhookUrl } : {}),
  };
}

async function slackIncomingWebhookRequest(
  webhookUrl: string,
  payload: JsonRecord,
): Promise<void> {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(payload),
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(
      `Slack incoming webhook failed (${response.status}): ${body || response.statusText || "Unknown Slack webhook error"}`,
    );
  }

  const normalizedBody = body.trim().toLowerCase();
  if (normalizedBody && normalizedBody !== "ok") {
    throw new Error(`Slack incoming webhook failed: ${body}`);
  }
}

async function slackApiRequest(
  config: SlackConfig,
  method: string,
  payload?: JsonRecord,
  options?: { httpMethod?: "GET" | "POST" },
): Promise<JsonRecord> {
  const httpMethod = options?.httpMethod || "POST";
  const baseUrl = "https://slack.com/api";

  const queryString =
    httpMethod === "GET" && payload
      ? `?${new URLSearchParams(
          Object.entries(payload).reduce<Record<string, string>>(
            (acc, [key, value]) => {
              if (value === undefined || value === null) {
                return acc;
              }
              acc[key] = String(value);
              return acc;
            },
            {},
          ),
        ).toString()}`
      : "";

  const response = await fetch(`${baseUrl}/${method}${queryString}`, {
    method: httpMethod,
    headers: {
      Authorization: `Bearer ${config.token}`,
      ...(httpMethod === "POST"
        ? { "Content-Type": "application/json; charset=utf-8" }
        : {}),
    },
    ...(httpMethod === "POST" ? { body: JSON.stringify(payload || {}) } : {}),
  });

  const parsed = await parseResponseBody(response);
  const data = parseBodyAsRecord(parsed);

  if (!response.ok || data.ok !== true) {
    throw new Error(
      `Slack ${method} failed (${response.status}): ${normalizeErrorDetail(
        data,
        response.statusText || "Unknown Slack error",
      )}`,
    );
  }

  return data;
}

async function resolveSlackChannelId(
  config: SlackConfig,
  channelOrName: string,
): Promise<string> {
  const trimmed = channelOrName.trim();
  if (!trimmed) {
    throw new Error("Slack channel is required.");
  }

  if (/^[CDG][A-Z0-9]+$/i.test(trimmed)) {
    return trimmed;
  }

  const normalizedName = trimmed.replace(/^#/, "").toLowerCase();
  let channels: unknown[] = [];
  try {
    const listPayload = await slackApiRequest(
      config,
      "conversations.list",
      {
        limit: 1000,
        types: "public_channel,private_channel,mpim,im",
        exclude_archived: true,
      },
      { httpMethod: "GET" },
    );
    channels = parseBodyAsList(listPayload.channels);
  } catch (error) {
    const message =
      error instanceof Error ? error.message.toLowerCase() : String(error);

    // Some Slack token types cannot call conversations.list. In this case,
    // continue with the user-provided channel instead of failing send_message.
    if (
      message.includes("not_allowed_token_type") ||
      message.includes("missing_scope") ||
      message.includes("method_not_supported_for_token_type")
    ) {
      return trimmed;
    }

    throw error;
  }

  const matched = channels.find((entry) => {
    const channel = parseBodyAsRecord(entry);
    const id = pickString(channel, ["id"]);
    const name = pickString(channel, ["name"]);

    return (
      id?.toLowerCase() === normalizedName ||
      name?.toLowerCase() === normalizedName
    );
  });

  if (!matched) {
    return trimmed;
  }

  const matchedChannel = parseBodyAsRecord(matched);
  return pickString(matchedChannel, ["id"]) || trimmed;
}

async function resolveSlackUserId(
  config: SlackConfig,
  userOrEmailOrName: string,
): Promise<string> {
  const trimmed = userOrEmailOrName.trim();
  if (!trimmed) {
    throw new Error("Slack user identifier is required.");
  }

  if (/^[UW][A-Z0-9]+$/i.test(trimmed)) {
    return trimmed;
  }

  if (trimmed.includes("@")) {
    const lookup = await slackApiRequest(config, "users.lookupByEmail", {
      email: trimmed,
    });
    const user = parseBodyAsRecord(lookup.user);
    const userId = pickString(user, ["id"]);
    if (userId) {
      return userId;
    }
  }

  const membersPayload = await slackApiRequest(
    config,
    "users.list",
    { limit: 1000 },
    { httpMethod: "GET" },
  );
  const normalized = trimmed.replace(/^@/, "").toLowerCase();

  const members = parseBodyAsList(membersPayload.members);
  const matched = members.find((entry) => {
    const user = parseBodyAsRecord(entry);
    const profile = parseBodyAsRecord(user.profile);
    const name = pickString(user, ["name"]);
    const realName = pickString(user, ["real_name"]);
    const displayName = pickString(profile, ["display_name"]);

    return [name, realName, displayName]
      .filter((value): value is string => Boolean(value))
      .some((value) => value.toLowerCase() === normalized);
  });

  if (!matched) {
    throw new Error(`Slack user not found for '${userOrEmailOrName}'.`);
  }

  const matchedUser = parseBodyAsRecord(matched);
  const matchedId = pickString(matchedUser, ["id"]);

  if (!matchedId) {
    throw new Error(`Slack user ID missing for '${userOrEmailOrName}'.`);
  }

  return matchedId;
}

async function getSheetsConfig(params: JsonRecord): Promise<SheetsConfig> {
  const integration = getConnectedIntegration("google_sheets");
  const credentials = asRecord(integration.credentials);

  const promptText = pickString(params, ["prompt", "input"]);

  const spreadsheetIdCandidates = [
    extractSpreadsheetIdFromText(
      pickString(params, [
        "sheet_id",
        "spreadsheetId",
        "spreadsheet_id",
        "sheetId",
        "spreadsheetUrl",
        "spreadsheet_url",
      ]),
    ),
    extractSpreadsheetIdFromText(
      pickString(credentials, [
        "sheet_id",
        "spreadsheetId",
        "spreadsheet_id",
        "sheetId",
        "spreadsheetUrl",
        "spreadsheet_url",
      ]),
    ),
    extractSpreadsheetIdFromText(promptText),
    extractSpreadsheetIdFromText(process.env.GOOGLE_SHEETS_SPREADSHEET_ID),
    extractSpreadsheetIdFromText(process.env.SPREADSHEET_ID),
  ].filter((value): value is string => Boolean(value && value.trim()));

  const spreadsheetId =
    spreadsheetIdCandidates.find((candidate) =>
      isLikelySpreadsheetId(candidate),
    ) || "";

  if (!spreadsheetId) {
    const fallbackCandidate = spreadsheetIdCandidates.find(
      (candidate) => !isPlaceholderValue(candidate),
    );

    if (fallbackCandidate) {
      throw new Error(
        `Google Sheets spreadsheet ID looks invalid ('${fallbackCandidate}'). Provide a real spreadsheet ID or a Google Sheets URL containing /spreadsheets/d/{id}.`,
      );
    }

    throw new Error(
      "Google Sheets spreadsheet ID is required. Provide spreadsheetId or configure SPREADSHEET_ID/GOOGLE_SHEETS_SPREADSHEET_ID.",
    );
  }

  let accessToken = (
    pickString(params, ["accessToken", "token"]) ||
    pickString(credentials, ["accessToken", "token"]) ||
    process.env.GOOGLE_ACCESS_TOKEN ||
    ""
  ).trim();

  const apiKey = (
    pickString(params, ["apiKey"]) ||
    pickString(credentials, ["apiKey"]) ||
    process.env.GOOGLE_SHEETS_API_KEY ||
    ""
  ).trim();

  const serviceAccountRaw =
    pickString(params, ["googleServiceAccountJson"]) ||
    pickString(credentials, ["googleServiceAccountJson"]) ||
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
    "";

  if (!accessToken && serviceAccountRaw) {
    const serviceAccount = parseGoogleServiceAccountJson(serviceAccountRaw);
    accessToken = await fetchGoogleServiceAccountAccessToken(
      serviceAccount,
      "https://www.googleapis.com/auth/spreadsheets",
    );
  }

  if (!accessToken && !apiKey) {
    throw new Error(
      "Google Sheets credentials are missing. Connect Google Sheets with an access token/service-account JSON (write) or API key (read-only).",
    );
  }

  return {
    spreadsheetId,
    ...(accessToken ? { accessToken } : {}),
    ...(apiKey ? { apiKey } : {}),
  };
}

async function sheetsApiRequest(
  config: SheetsConfig,
  method: "GET" | "POST" | "PUT",
  path: string,
  body?: unknown,
  options?: { writeOperation?: boolean },
): Promise<JsonRecord> {
  if (options?.writeOperation && !config.accessToken) {
    throw new Error(
      "Google Sheets write operations require OAuth/service-account credentials. API key is read-only.",
    );
  }

  const baseUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
    config.spreadsheetId,
  )}`;
  const separator = path.includes("?") ? "&" : "?";
  const url = config.accessToken
    ? `${baseUrl}${path}`
    : `${baseUrl}${path}${separator}key=${encodeURIComponent(config.apiKey || "")}`;

  const response = await fetch(url, {
    method,
    headers: {
      ...(config.accessToken
        ? { Authorization: `Bearer ${config.accessToken}` }
        : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  const payload = await parseResponseBody(response);

  if (!response.ok) {
    throw new Error(
      `Google Sheets request failed (${response.status}): ${normalizeErrorDetail(
        payload,
        response.statusText || "Unknown Google Sheets error",
      )}`,
    );
  }

  return parseBodyAsRecord(payload);
}

function normalizeSheetValues(input: unknown): unknown[][] {
  if (!Array.isArray(input)) {
    return [[input]];
  }

  if (input.length === 0) {
    return [[]];
  }

  if (Array.isArray(input[0])) {
    return input.map((row) => (Array.isArray(row) ? row : [row]));
  }

  return [input];
}

function hasMeaningfulSheetValues(values: unknown[][]): boolean {
  return values.some((row) =>
    Array.isArray(row)
      ? row.some((cell) => {
          if (cell === null || cell === undefined) {
            return false;
          }

          if (typeof cell === "string") {
            return cell.trim().length > 0;
          }

          return true;
        })
      : false,
  );
}

function toSheetColumnName(columnNumber: number): string {
  if (!Number.isFinite(columnNumber) || columnNumber <= 0) {
    return "A";
  }

  let n = Math.floor(columnNumber);
  let result = "";
  while (n > 0) {
    const remainder = (n - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    n = Math.floor((n - 1) / 26);
  }

  return result;
}

async function getGmailConfig(params: JsonRecord): Promise<GmailConfig> {
  const integration = getConnectedIntegration("gmail");
  const credentials = asRecord(integration.credentials);

  let accessToken = (
    pickString(params, ["accessToken", "apiKey"]) ||
    pickString(credentials, ["accessToken", "apiKey", "token"]) ||
    process.env.GMAIL_ACCESS_TOKEN ||
    ""
  ).trim();

  const refreshToken = (
    pickString(params, ["refreshToken"]) ||
    pickString(credentials, ["refreshToken"]) ||
    process.env.GMAIL_REFRESH_TOKEN ||
    ""
  ).trim();

  if (!accessToken && refreshToken) {
    const refreshed = await exchangeGoogleRefreshToken(refreshToken);
    accessToken = refreshed.accessToken;
  }

  if (!accessToken) {
    throw new Error(
      "Gmail access token is missing. Connect Gmail integration with OAuth token (or refresh token + Google OAuth client credentials).",
    );
  }

  return {
    accessToken,
    ...(refreshToken ? { refreshToken } : {}),
  };
}

function getGmailRequiredScopes(
  operation:
    | "list_messages"
    | "send_message"
    | "create_draft"
    | "read_email"
    | "search_emails"
    | "parse_email"
    | "add_label"
    | "get_thread"
    | "reply_email"
    | "get_attachments"
    | "listen_email_events",
): string[] {
  if (
    operation === "list_messages" ||
    operation === "read_email" ||
    operation === "search_emails" ||
    operation === "parse_email" ||
    operation === "get_thread" ||
    operation === "get_attachments" ||
    operation === "listen_email_events"
  ) {
    return [GMAIL_READ_SCOPE];
  }

  if (operation === "send_message" || operation === "reply_email") {
    return [GMAIL_SEND_SCOPE];
  }

  if (operation === "add_label") {
    return [GMAIL_MODIFY_SCOPE];
  }

  return [GMAIL_COMPOSE_SCOPE];
}

function withGmailPermissionGuidance(
  error: unknown,
  operation:
    | "list_messages"
    | "send_message"
    | "create_draft"
    | "read_email"
    | "search_emails"
    | "parse_email"
    | "add_label"
    | "get_thread"
    | "reply_email"
    | "get_attachments"
    | "listen_email_events",
): Error {
  const message =
    error instanceof Error ? error.message : "Unknown Gmail request error";

  if (!/gmail request failed \(403\)/i.test(message)) {
    return error instanceof Error ? error : new Error(message);
  }

  const requiredScopes = getGmailRequiredScopes(operation).join(", ");
  return new Error(
    `${message}. Reconnect Gmail with required scopes: ${requiredScopes}. If using OAuth route, re-authorize via /auth/google/gmail.`,
  );
}

async function gmailApiRequest(
  config: GmailConfig,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<JsonRecord> {
  const executeRequest = async (accessToken: string) => {
    const response = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me${path}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      },
    );

    const payload = await parseResponseBody(response);
    return { response, payload };
  };

  let { response, payload } = await executeRequest(config.accessToken);

  // Retry once with refresh token if current access token is expired/invalid.
  if (response.status === 401 && config.refreshToken) {
    const refreshed = await exchangeGoogleRefreshToken(config.refreshToken);
    config.accessToken = refreshed.accessToken;
    ({ response, payload } = await executeRequest(config.accessToken));
  }

  if (!response.ok) {
    throw new Error(
      `Gmail request failed (${response.status}): ${normalizeErrorDetail(
        payload,
        response.statusText || "Unknown Gmail error",
      )}`,
    );
  }

  return parseBodyAsRecord(payload);
}

async function gmailGetMessage(
  config: GmailConfig,
  messageId: string,
  format: "metadata" | "full" = "full",
): Promise<JsonRecord> {
  const metadataHeaders =
    format === "metadata"
      ? "&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To"
      : "";

  return gmailApiRequest(
    config,
    "GET",
    `/messages/${encodeURIComponent(messageId)}?format=${format}${metadataHeaders}`,
  );
}

function decodeGmailMessageBody(payload: JsonRecord): string {
  const body = parseBodyAsRecord(payload.body);
  const inlineData = pickString(body, ["data"]);
  if (inlineData) {
    try {
      return decodeBase64UrlToUtf8(inlineData);
    } catch {
      return "";
    }
  }

  for (const partRaw of parseBodyAsList(payload.parts)) {
    const part = parseBodyAsRecord(partRaw);
    const mimeType = (pickString(part, ["mimeType"]) || "").toLowerCase();
    const nestedBody = decodeGmailMessageBody(part);
    if (
      nestedBody &&
      (mimeType.includes("text/plain") || mimeType.includes("text/html"))
    ) {
      return nestedBody;
    }
    if (nestedBody) {
      return nestedBody;
    }
  }

  return "";
}

function resolveIssueKey(params: JsonRecord): string {
  const direct = pickString(params, [
    "issueKey",
    "issue_key",
    "issueId",
    "issue_id",
    "key",
  ]);

  if (direct && !isPlaceholderValue(direct)) {
    return direct;
  }

  const prompt = pickString(params, ["prompt", "input"]) || "";
  const fromPrompt = parseIssueKeyFromPrompt(prompt);
  if (fromPrompt) {
    return fromPrompt;
  }

  throw new Error("Issue key is required (for example KAN-3).");
}

async function resolveRepository(
  params: JsonRecord,
  config: GitHubConfig,
): Promise<string> {
  const candidate = pickString(params, ["repo", "repository", "repo_name"]);
  const prompt = pickString(params, ["prompt", "input"]) || "";

  let repo = !isPlaceholderValue(candidate) ? candidate : undefined;
  if (!repo) {
    repo = parseRepoFromPrompt(prompt);
  }

  if (!repo) {
    repo = resolveDefaultRepositoryFromEnv();
  }

  if (!repo || isPlaceholderValue(repo)) {
    throw new Error(
      "Repository is required. Provide owner/repo in tool arguments or mention 'repo owner/name' in prompt.",
    );
  }

  repo = normalizeRepositoryIdentifier(repo);
  if (!repo) {
    throw new Error(
      "Repository is required. Provide owner/repo in tool arguments or mention 'repo owner/name' in prompt.",
    );
  }

  if (!repo.includes("/")) {
    const ownerFromParams = pickString(params, ["owner"]);
    const ownerFromEnv = resolveDefaultOwnerFromEnv();

    let owner =
      ownerFromParams && !isPlaceholderValue(ownerFromParams)
        ? ownerFromParams
        : ownerFromEnv;

    if (!owner) {
      const userResponse = await githubRequest(config, "GET", "/user");
      if (userResponse.status >= 200 && userResponse.status < 300) {
        const userPayload = parseBodyAsRecord(userResponse.payload);
        const login = pickString(userPayload, ["login"]);
        if (login) {
          owner = login;
        }
      }
    }

    if (!owner) {
      const defaultRepo = resolveDefaultRepositoryFromEnv();
      if (defaultRepo && defaultRepo.includes("/")) {
        const [defaultOwner] = defaultRepo.split("/", 1);
        if (defaultOwner) {
          owner = defaultOwner;
        }
      }
    }

    if (!owner) {
      throw new Error(
        "Repository must be owner/repo. Provide owner, set GITHUB_DEFAULT_OWNER, or configure GITHUB_DEFAULT_REPO.",
      );
    }

    repo = `${owner}/${repo}`;
  }

  return repo;
}

function resolveBranchName(params: JsonRecord): string {
  const raw = pickString(params, [
    "branch",
    "branch_name",
    "head",
    "source_branch",
  ]);

  if (raw && !isPlaceholderValue(raw)) {
    return raw;
  }

  const issueKey = resolveOptionalIssueKey(params);
  if (issueKey) {
    return `feature/${issueKey}`;
  }

  return "feature/automation";
}

function resolveOptionalIssueKey(params: JsonRecord): string | undefined {
  const direct = pickString(params, [
    "issueKey",
    "issue_key",
    "issueId",
    "issue_id",
    "key",
  ]);

  if (direct && !isPlaceholderValue(direct)) {
    return direct;
  }

  const prompt = pickString(params, ["prompt", "input"]) || "";
  return parseIssueKeyFromPrompt(prompt);
}

function resolveBaseBranch(params: JsonRecord): string {
  return pickString(params, ["base", "base_branch", "target_branch"]) || "main";
}

function resolveNumericParam(
  params: JsonRecord,
  keys: string[],
): number | undefined {
  for (const key of keys) {
    const value = params[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return Math.floor(value);
    }

    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value.trim());
      if (Number.isFinite(parsed) && parsed > 0) {
        return Math.floor(parsed);
      }
    }
  }

  return undefined;
}

function resolvePullRequestNumber(params: JsonRecord): number {
  const direct = resolveNumericParam(params, [
    "pull_number",
    "pullNumber",
    "pr_number",
    "prNumber",
    "number",
  ]);

  if (direct) {
    return direct;
  }

  const url = pickString(params, [
    "pull_url",
    "pullRequestUrl",
    "url",
    "html_url",
  ]);
  const fromUrl = url?.match(/\/pull\/(\d+)/i)?.[1];
  if (fromUrl) {
    const parsed = Number(fromUrl);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed);
    }
  }

  throw new Error("Pull request number is required (for example 42).");
}

function resolveRequiredBranchName(params: JsonRecord): string {
  const branch = pickString(params, [
    "branch",
    "branch_name",
    "name",
    "head",
    "ref",
  ]);

  if (!branch) {
    throw new Error("Branch name is required.");
  }

  return branch;
}

function resolveWorkflowIdentifier(params: JsonRecord): string {
  const workflowId = pickString(params, [
    "workflow_id",
    "workflowId",
    "workflow",
    "workflow_name",
    "workflowName",
  ]);

  if (!workflowId) {
    throw new Error(
      "Workflow identifier is required (workflow_id, workflow name, or workflow file name).",
    );
  }

  return workflowId;
}

function resolveFilePath(params: JsonRecord): string {
  const direct = pickString(params, ["path", "file", "file_path", "filename"]);
  if (direct && !isPlaceholderValue(direct)) {
    return direct.replace(/^\/+/, "");
  }

  const issueKey = resolveOptionalIssueKey(params);
  if (issueKey) {
    return `${issueKey}.txt`;
  }

  return "AUTOMATION_CHANGE.txt";
}

function resolveFileContent(params: JsonRecord): string {
  const direct = pickString(params, ["content", "text", "file_content"]);
  if (direct && !isPlaceholderValue(direct)) {
    return direct;
  }

  const issueKey = resolveOptionalIssueKey(params);
  if (issueKey) {
    return `Fix for ${issueKey}`;
  }

  return "Automated change from NexusMCP";
}

function resolveCommitMessage(params: JsonRecord): string {
  const direct = pickString(params, [
    "message",
    "commit_message",
    "commitMessage",
  ]);
  if (direct && !isPlaceholderValue(direct)) {
    return direct;
  }

  const issueKey = resolveOptionalIssueKey(params);
  if (issueKey) {
    return `Fix ${issueKey}`;
  }

  return "Automated update";
}

function buildRetryBranchName(params: JsonRecord): string {
  const issueKey = resolveOptionalIssueKey(params) || "automation";
  const normalizedIssueKey =
    issueKey
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "automation";

  return `feature/${normalizedIssueKey}-${Date.now()}-${Math.floor(
    Math.random() * 10000,
  )}`;
}

function resolveTitle(params: JsonRecord): string {
  const direct = pickString(params, ["title", "summary"]);
  if (direct && !isPlaceholderValue(direct)) {
    return direct;
  }

  const issueKey = resolveOptionalIssueKey(params);
  if (issueKey) {
    return `Work for ${issueKey}`;
  }

  const prompt = pickString(params, ["prompt", "input"]) || "";
  if (prompt.trim().length > 0) {
    return prompt.trim().slice(0, 120);
  }

  throw new Error("A title/summary is required.");
}

function resolveDescription(params: JsonRecord): string {
  return pickString(params, ["description", "body"]) || "";
}

async function githubRequest(
  config: GitHubConfig,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; payload: unknown }> {
  let lastStatus = 0;
  let lastPayload: unknown = null;

  for (let index = 0; index < config.authHeaders.length; index += 1) {
    const authorization = config.authHeaders[index];
    const response = await fetch(`${config.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: authorization,
        Accept: "application/vnd.github+json",
        "User-Agent": "NexusMCP",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

    const payload = await parseResponseBody(response);
    lastStatus = response.status;
    lastPayload = payload;

    const isAuthFailure = response.status === 401 || response.status === 403;
    const hasMoreAuthStyles = index < config.authHeaders.length - 1;

    if (isAuthFailure && hasMoreAuthStyles) {
      continue;
    }

    return {
      status: response.status,
      payload,
    };
  }

  return {
    status: lastStatus || 500,
    payload: lastPayload,
  };
}

async function githubRequestOrThrow(
  config: GitHubConfig,
  method: string,
  path: string,
  body?: unknown,
): Promise<JsonRecord> {
  const result = await githubRequest(config, method, path, body);

  if (result.status < 200 || result.status >= 300) {
    throw new Error(
      `GitHub request failed (${result.status}): ${normalizeErrorDetail(
        result.payload,
        "Unknown GitHub error",
      )}`,
    );
  }

  return parseBodyAsRecord(result.payload);
}

async function jiraRequest(
  config: JiraConfig,
  method: string,
  path: string,
  body?: unknown,
): Promise<JsonRecord> {
  const auth = Buffer.from(`${config.email}:${config.apiToken}`).toString(
    "base64",
  );

  const response = await fetch(`${config.baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  const payload = await parseResponseBody(response);

  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `Jira request failed (${response.status}): ${normalizeErrorDetail(
        payload,
        "Unknown Jira error",
      )}`,
    );
  }

  return parseBodyAsRecord(payload);
}

async function resolveDefaultJiraProjectKey(
  config: JiraConfig,
): Promise<string | undefined> {
  const payload = await jiraRequest(
    config,
    "GET",
    "/rest/api/3/project/search?maxResults=1",
  );

  const values = parseBodyAsList(payload.values);
  if (values.length === 0) {
    return undefined;
  }

  const first = parseBodyAsRecord(values[0]);
  const key = first.key;
  return typeof key === "string" ? key : undefined;
}

function buildJiraDescription(description: string): JsonRecord {
  return {
    type: "doc",
    version: 1,
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: description || "No description provided." },
        ],
      },
    ],
  };
}

function normalizeTransitionName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

async function resolveJiraTransitionId(
  config: JiraConfig,
  issueKey: string,
  transitionName: string,
): Promise<string> {
  const transitionsPayload = await jiraRequest(
    config,
    "GET",
    `/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`,
  );

  const transitions = parseBodyAsList(transitionsPayload.transitions);
  const targetName = normalizeTransitionName(transitionName);

  const matched = transitions.find((entry) => {
    const transition = parseBodyAsRecord(entry);
    const name = pickString(transition, ["name"]);
    return Boolean(name && normalizeTransitionName(name) === targetName);
  });

  if (matched) {
    const transitionRecord = parseBodyAsRecord(matched);
    const transitionId = pickString(transitionRecord, ["id"]);
    if (transitionId) {
      return transitionId;
    }
  }

  const availableTransitions = transitions
    .map((entry) => pickString(parseBodyAsRecord(entry), ["name"]))
    .filter((name): name is string => Boolean(name));

  throw new Error(
    `Jira transition '${transitionName}' is not available for ${issueKey}. Available transitions: ${availableTransitions.join(", ") || "none"}.`,
  );
}

async function invokeGatewayTool(
  gatewayName: keyof typeof registeredGateways,
  tool: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const gateway = registeredGateways[gatewayName];

  const response = await fetch(gateway.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ tool, input }),
  });

  const data = (await response.json()) as Record<string, unknown>;
  const detail =
    (typeof data.detail === "string" && data.detail) ||
    (typeof data.error === "string" && data.error) ||
    "Unknown gateway error";

  if (!response.ok) {
    throw new Error(`Gateway ${gateway.name} call failed: ${detail}`);
  }

  if (data.type === "error") {
    throw new Error(
      typeof data.error === "string"
        ? data.error
        : "Gateway tool execution failed",
    );
  }

  return (data.content as Record<string, unknown> | undefined) || data;
}

const handlers: Record<string, MCPHandler> = {
  // Jira methods
  "jira.createIssue": async (params) => {
    const payload = params as JsonRecord;
    const issueTitle = resolveTitle(payload);
    const description = resolveDescription(payload);
    const issueType =
      pickString(payload, ["issue_type", "issueType", "type"]) || "Task";

    let projectKey =
      pickString(payload, ["project", "project_key", "projectKey"]) ||
      (typeof process.env.JIRA_PROJECT_KEY === "string"
        ? process.env.JIRA_PROJECT_KEY.trim()
        : "");

    let responsePayload: JsonRecord;

    try {
      const config = getJiraConfig(payload);
      if (!projectKey) {
        projectKey = (await resolveDefaultJiraProjectKey(config)) || "";
      }

      if (!projectKey) {
        throw new Error(
          "Jira project key is required. Provide project or set JIRA_PROJECT_KEY.",
        );
      }

      responsePayload = await jiraRequest(config, "POST", "/rest/api/3/issue", {
        fields: {
          project: { key: projectKey },
          summary: issueTitle,
          description: buildJiraDescription(description),
          issuetype: { name: issueType },
        },
      });

      dataStore.addLog({
        level: "info",
        service: "jira",
        action: "create_issue",
        message: `Created issue ${String(responsePayload.key || "UNKNOWN")}: ${issueTitle}`,
        details: {
          issueKey: responsePayload.key,
          project: projectKey,
          issueType,
        },
      });

      return {
        issueKey: responsePayload.key || "UNKNOWN",
        issueId: responsePayload.id || uuidv4(),
        self: responsePayload.self || "",
      };
    } catch (error) {
      // Fallback to gateway if directly configured and direct call fails.
      if (registeredGateways.jira?.endpoint) {
        const gatewayResult = await invokeGatewayTool(
          "jira",
          "jira.create_issue",
          {
            title: issueTitle,
            description,
            project: projectKey || undefined,
            issue_type: issueType,
          },
        );

        return {
          issueKey:
            (gatewayResult.issue_key as string | undefined) ||
            (gatewayResult.issueKey as string | undefined) ||
            "UNKNOWN",
          issueId:
            (gatewayResult.issue_id as string | undefined) ||
            (gatewayResult.issueId as string | undefined) ||
            uuidv4(),
          self:
            (gatewayResult.url as string | undefined) ||
            (gatewayResult.self as string | undefined) ||
            "",
        };
      }

      throw error;
    }
  },

  "jira.getIssue": async (params) => {
    const payload = params as JsonRecord;
    const issueKey = resolveIssueKey(payload);
    const config = getJiraConfig(payload);

    try {
      const issue = await jiraRequest(
        config,
        "GET",
        `/rest/api/3/issue/${encodeURIComponent(issueKey)}`,
      );

      const fields = parseBodyAsRecord(issue.fields);
      const status = parseBodyAsRecord(fields.status);

      dataStore.addLog({
        level: "info",
        service: "jira",
        action: "get_issue",
        message: `Fetched Jira issue ${issueKey}`,
        details: { issueKey },
      });

      return {
        id: issue.id,
        key: issue.key,
        summary: fields.summary,
        status: status.name,
        url: `${config.baseUrl}/browse/${issue.key || issueKey}`,
        raw: issue,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown Jira error";

      if (/jira request failed \(404\)/i.test(message)) {
        dataStore.addLog({
          level: "warning",
          service: "jira",
          action: "get_issue_not_found",
          message: `Jira issue ${issueKey} not found; continuing workflow with issue key only`,
          details: { issueKey },
        });

        return {
          id: null,
          key: issueKey,
          summary: `Issue ${issueKey} not found`,
          status: "NOT_FOUND",
          url: `${config.baseUrl}/browse/${issueKey}`,
          missing: true,
        };
      }

      throw error;
    }
  },

  "jira.getIssues": async (params) => {
    const payload = params as JsonRecord;
    const config = getJiraConfig(payload);
    const jql = pickString(payload, ["jql"]) || "order by created DESC";
    const maxResults = Number(payload.maxResults ?? payload.max_results ?? 10);
    const safeMaxResults = Number.isFinite(maxResults)
      ? Math.max(1, Math.min(100, Math.floor(maxResults)))
      : 10;

    const query = new URLSearchParams({
      jql,
      maxResults: String(safeMaxResults),
    }).toString();

    const searchAttempts: Array<() => Promise<JsonRecord>> = [
      () =>
        jiraRequest(config, "POST", "/rest/api/3/search/jql", {
          jql,
          maxResults: safeMaxResults,
        }),
      () =>
        jiraRequest(config, "POST", "/rest/api/3/search", {
          jql,
          maxResults: safeMaxResults,
        }),
      () => jiraRequest(config, "GET", `/rest/api/3/search/jql?${query}`),
      () => jiraRequest(config, "GET", `/rest/api/3/search?${query}`),
    ];

    let searchResult: JsonRecord | null = null;
    const attemptErrors: string[] = [];

    for (const attempt of searchAttempts) {
      try {
        searchResult = await attempt();
        break;
      } catch (error) {
        const detail =
          error instanceof Error ? error.message : "Unknown Jira error";
        attemptErrors.push(detail);
      }
    }

    if (!searchResult) {
      const retryableEndpointFailure = attemptErrors.every((message) =>
        /jira request failed \((404|410|405)\)/i.test(message),
      );

      if (retryableEndpointFailure) {
        dataStore.addLog({
          level: "warning",
          service: "jira",
          action: "query_issues_fallback_empty",
          message:
            "Jira search endpoints unavailable (deprecated or disabled); returning empty issue list.",
          details: {
            jql,
            errors: attemptErrors,
          },
        });

        return {
          issues: [],
          total: 0,
          warning:
            "Jira search endpoint unavailable; returned empty issues list.",
        };
      }

      throw new Error(
        attemptErrors[attemptErrors.length - 1] || "Jira search failed",
      );
    }

    const issues = parseBodyAsList(searchResult.issues);
    const total =
      typeof searchResult.total === "number"
        ? searchResult.total
        : issues.length;

    dataStore.addLog({
      level: "info",
      service: "jira",
      action: "query_issues",
      message: `Queried Jira with JQL: ${jql}`,
      details: { total },
    });

    return {
      issues,
      total,
    };
  },

  "jira.updateIssue": async (params) => {
    const payload = params as JsonRecord;
    const config = getJiraConfig(payload);
    const issueKey = resolveIssueKey(payload);
    const fields = parseBodyAsRecord(payload.fields);
    const requestedStatus = pickString(payload, ["status", "state"]);
    const requestedTransitionId = pickString(payload, [
      "transition_id",
      "transitionId",
    ]);
    const transitionComment = pickString(payload, ["comment"]);

    if (Object.keys(fields).length > 0) {
      await jiraRequest(
        config,
        "PUT",
        `/rest/api/3/issue/${encodeURIComponent(issueKey)}`,
        { fields },
      );

      dataStore.addLog({
        level: "info",
        service: "jira",
        action: "update_issue",
        message: `Updated issue ${issueKey}`,
        details: {
          issueKey,
          updatedFields: Object.keys(fields),
          mode: "fields",
        },
      });

      return {
        success: true,
        issueKey,
        mode: "fields",
      };
    }

    if (!requestedStatus && !requestedTransitionId) {
      throw new Error(
        "Jira update requires either a non-empty fields object or a status/transition_id.",
      );
    }

    const transitionId =
      requestedTransitionId ||
      (requestedStatus
        ? await resolveJiraTransitionId(config, issueKey, requestedStatus)
        : undefined);

    if (!transitionId) {
      throw new Error(
        "Could not resolve Jira transition id for update request.",
      );
    }

    const transitionPayload: JsonRecord = {
      transition: { id: transitionId },
    };

    if (transitionComment) {
      transitionPayload.update = {
        comment: [
          {
            add: {
              body: buildJiraDescription(transitionComment),
            },
          },
        ],
      };
    }

    await jiraRequest(
      config,
      "POST",
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`,
      transitionPayload,
    );

    dataStore.addLog({
      level: "info",
      service: "jira",
      action: "update_issue",
      message: `Transitioned issue ${issueKey}`,
      details: {
        issueKey,
        mode: "transition",
        status: requestedStatus,
        transitionId,
      },
    });

    return {
      success: true,
      issueKey,
      mode: "transition",
      transitionId,
      status: requestedStatus,
    };
  },

  "jira.addComment": async (params) => {
    const payload = params as JsonRecord;
    const config = getJiraConfig(payload);
    const issueKey = resolveIssueKey(payload);
    const commentText =
      pickString(payload, ["comment", "body", "text", "message"]) || "";

    if (!commentText.trim()) {
      throw new Error("Jira add_comment requires comment text.");
    }

    const response = await jiraRequest(
      config,
      "POST",
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`,
      {
        body: buildJiraDescription(commentText),
      },
    );

    const commentId = pickString(response, ["id"]);
    const commentSelf = pickString(response, ["self"]);

    dataStore.addLog({
      level: "info",
      service: "jira",
      action: "add_comment",
      message: `Added comment to Jira issue ${issueKey}`,
      details: { issueKey, commentId },
    });

    return {
      issueKey,
      commentId,
      self: commentSelf,
    };
  },

  // Slack methods
  "slack.sendMessage": async (params) => {
    const payload = params as JsonRecord;
    const dispatchOptions = getSlackMessageDispatchOptions(payload);
    const text =
      pickString(payload, ["text", "message", "body"]) || "NexusMCP update";
    const channelInput = pickString(payload, ["channel", "channel_id", "to"]);
    if (!channelInput) {
      throw new Error("Slack channel is required.");
    }

    if (
      dispatchOptions.tokenCandidates.length === 0 &&
      !dispatchOptions.webhookUrl
    ) {
      throw new Error(
        "Slack credentials are missing. Connect Slack with a bot token (chat:write) or configure SLACK_WEBHOOK_URL.",
      );
    }

    const blocks = Array.isArray(payload.blocks) ? payload.blocks : undefined;
    const attachments = Array.isArray(payload.attachments)
      ? payload.attachments
      : undefined;
    const threadTs = pickString(payload, ["thread_ts", "threadTs"]);

    const rawChannelInput = channelInput.trim();
    let deliveredChannel: string | null = null;
    let dispatchedVia: "chat.postMessage" | "incoming_webhook" | null = null;
    let lastError: unknown = null;

    for (const token of dispatchOptions.tokenCandidates) {
      const config: SlackConfig = { token };
      let resolvedChannel = rawChannelInput;

      try {
        resolvedChannel = await resolveSlackChannelId(config, rawChannelInput);
      } catch (error) {
        lastError = error;
        continue;
      }

      const channelCandidates = Array.from(
        new Set(
          [
            resolvedChannel,
            rawChannelInput,
            rawChannelInput.startsWith("#")
              ? rawChannelInput.replace(/^#+/, "")
              : `#${rawChannelInput}`,
          ].filter((value): value is string => Boolean(value && value.trim())),
        ),
      );

      for (const candidate of channelCandidates) {
        try {
          const result = await slackApiRequest(config, "chat.postMessage", {
            channel: candidate,
            text,
            ...(blocks ? { blocks } : {}),
            ...(attachments ? { attachments } : {}),
            ...(threadTs ? { thread_ts: threadTs } : {}),
          });

          deliveredChannel = String(result.channel || candidate);
          dispatchedVia = "chat.postMessage";

          dataStore.addLog({
            level: "info",
            service: "slack",
            action: "send_message",
            message: `Sent Slack message to ${deliveredChannel}`,
            details: {
              channel: deliveredChannel,
              requestedChannel: rawChannelInput,
              dispatch: "chat.postMessage",
              textPreview: text.slice(0, 80),
            },
          });

          return {
            ok: true,
            ts: result.ts,
            channel: result.channel,
            message: result.message,
            dispatch: "chat.postMessage",
          };
        } catch (error) {
          lastError = error;
          const message =
            error instanceof Error
              ? error.message.toLowerCase()
              : String(error);

          if (message.includes("channel_not_found")) {
            continue;
          }

          if (
            message.includes("not_allowed_token_type") ||
            message.includes("invalid_auth") ||
            message.includes("missing_scope")
          ) {
            break;
          }

          throw error;
        }
      }
    }

    if (dispatchOptions.webhookUrl) {
      const webhookPayload: JsonRecord = {
        text,
        ...(blocks ? { blocks } : {}),
        ...(attachments ? { attachments } : {}),
      };

      if (!threadTs) {
        webhookPayload.channel = rawChannelInput;
      }

      await slackIncomingWebhookRequest(
        dispatchOptions.webhookUrl,
        webhookPayload,
      );

      deliveredChannel = rawChannelInput;
      dispatchedVia = "incoming_webhook";

      dataStore.addLog({
        level: "info",
        service: "slack",
        action: "send_message",
        message: `Sent Slack message to ${deliveredChannel} via incoming webhook`,
        details: {
          channel: deliveredChannel,
          requestedChannel: rawChannelInput,
          dispatch: "incoming_webhook",
          textPreview: text.slice(0, 80),
        },
      });

      return {
        ok: true,
        channel: deliveredChannel,
        message: {
          text,
          dispatched_via: "incoming_webhook",
        },
        dispatch: "incoming_webhook",
      };
    }

    const defaultError =
      lastError instanceof Error
        ? lastError
        : new Error(
            "Slack chat.postMessage failed for all token/channel attempts.",
          );

    if (/not_allowed_token_type/i.test(defaultError.message)) {
      throw new Error(
        `${defaultError.message}. Use a Slack bot token (xoxb with chat:write) or configure SLACK_WEBHOOK_URL as fallback.`,
      );
    }

    if (deliveredChannel || dispatchedVia) {
      return {
        ok: true,
        channel: deliveredChannel,
        dispatch: dispatchedVia,
      };
    }

    throw defaultError;
  },

  "slack.getChannels": async (params) => {
    const payload = params as JsonRecord;
    const config = getSlackConfig(payload);
    const limit = Number(payload.limit ?? 200);

    const result = await slackApiRequest(
      config,
      "conversations.list",
      {
        limit: Number.isFinite(limit)
          ? Math.max(1, Math.min(1000, limit))
          : 200,
        types:
          pickString(payload, ["types"]) ||
          "public_channel,private_channel,mpim,im",
        exclude_archived: payload.exclude_archived ?? true,
      },
      { httpMethod: "GET" },
    );

    const channels = parseBodyAsList(result.channels).map((entry) => {
      const channel = parseBodyAsRecord(entry);
      return {
        id: pickString(channel, ["id"]),
        name: pickString(channel, ["name"]),
        is_private: Boolean(channel.is_private),
        is_archived: Boolean(channel.is_archived),
      };
    });

    return {
      channels,
      count: channels.length,
    };
  },

  "slack.getChannel": async (params) => {
    const payload = params as JsonRecord;
    const config = getSlackConfig(payload);
    const channelInput = pickString(payload, [
      "channel",
      "channel_id",
      "name",
      "id",
    ]);

    if (!channelInput) {
      throw new Error("slack.get_channel requires channel or channel_id.");
    }

    const channel = await resolveSlackChannelId(config, channelInput);
    const result = await slackApiRequest(
      config,
      "conversations.info",
      {
        channel,
        include_locale: true,
        include_num_members: true,
      },
      { httpMethod: "GET" },
    );

    const details = parseBodyAsRecord(result.channel);
    return {
      id: pickString(details, ["id"]),
      name: pickString(details, ["name"]),
      is_private: Boolean(details.is_private),
      is_archived: Boolean(details.is_archived),
      is_member: Boolean(details.is_member),
      topic: pickString(parseBodyAsRecord(details.topic), ["value"]),
      purpose: pickString(parseBodyAsRecord(details.purpose), ["value"]),
      num_members:
        typeof details.num_members === "number"
          ? details.num_members
          : undefined,
    };
  },

  "slack.getUser": async (params) => {
    const payload = params as JsonRecord;
    const config = getSlackConfig(payload);
    const identifier =
      pickString(payload, ["user", "user_id", "email", "name", "username"]) ||
      "";

    if (!identifier) {
      throw new Error(
        "slack.get_user requires user identifier (user_id, email, or name).",
      );
    }

    const userId = await resolveSlackUserId(config, identifier);
    const userPayload = await slackApiRequest(
      config,
      "users.info",
      { user: userId, include_locale: true },
      { httpMethod: "GET" },
    );

    const user = parseBodyAsRecord(userPayload.user);
    const profile = parseBodyAsRecord(user.profile);

    let presence = "unknown";
    try {
      const presencePayload = await slackApiRequest(
        config,
        "users.getPresence",
        { user: userId },
        { httpMethod: "GET" },
      );
      presence = pickString(presencePayload, ["presence"]) || "unknown";
    } catch {
      presence = "unknown";
    }

    return {
      id: pickString(user, ["id"]),
      name: pickString(user, ["name"]),
      real_name: pickString(user, ["real_name"]),
      display_name: pickString(profile, ["display_name"]),
      email: pickString(profile, ["email"]),
      title: pickString(profile, ["title"]),
      tz: pickString(user, ["tz"]),
      is_bot: Boolean(user.is_bot),
      is_admin: Boolean(user.is_admin),
      is_owner: Boolean(user.is_owner),
      presence,
    };
  },

  "slack.createChannel": async (params) => {
    const payload = params as JsonRecord;
    const config = getSlackConfig(payload);

    const name = (
      pickString(payload, ["name", "channel", "channel_name"]) ||
      "workflow-updates"
    )
      .replace(/^#/, "")
      .toLowerCase();
    const isPrivate = Boolean(payload.is_private ?? payload.isPrivate ?? false);

    const created = await slackApiRequest(config, "conversations.create", {
      name,
      is_private: isPrivate,
    });
    const channelRecord = parseBodyAsRecord(created.channel);
    const channelId = pickString(channelRecord, ["id"]);

    const inviteList = parseBodyAsList(payload.members ?? payload.users)
      .map((entry) => String(entry).trim())
      .filter(Boolean);

    if (channelId && inviteList.length > 0) {
      await slackApiRequest(config, "conversations.invite", {
        channel: channelId,
        users: inviteList.join(","),
      });
    }

    dataStore.addLog({
      level: "info",
      service: "slack",
      action: "create_channel",
      message: `Created Slack channel ${name}`,
      details: { name, isPrivate, invitedMembers: inviteList.length },
    });

    return {
      ok: true,
      channel: {
        id: channelId,
        name: pickString(channelRecord, ["name"]) || name,
        is_private: Boolean(channelRecord.is_private),
      },
    };
  },

  "slack.sendDirectMessage": async (params) => {
    const payload = params as JsonRecord;
    const config = getSlackConfig(payload);
    const recipient =
      pickString(payload, ["user", "user_id", "recipient", "email"]) || "";
    const text =
      pickString(payload, ["text", "message", "body"]) || "NexusMCP update";
    const blocks = Array.isArray(payload.blocks) ? payload.blocks : undefined;
    const attachments = Array.isArray(payload.attachments)
      ? payload.attachments
      : undefined;

    const explicitChannel = pickString(payload, [
      "channel",
      "channel_id",
      "group",
    ]);
    const recipients = parseBodyAsList(payload.users ?? payload.recipients)
      .map((entry) => String(entry).trim())
      .filter(Boolean);

    if (recipient) {
      recipients.push(
        ...recipient
          .split(",")
          .map((entry) => entry.trim())
          .filter(Boolean),
      );
    }

    const uniqueRecipients = Array.from(new Set(recipients));

    if (!explicitChannel && uniqueRecipients.length === 0) {
      throw new Error(
        "Slack recipient is required for direct messages (user/user_id/email or users array).",
      );
    }

    let channelId: string | undefined;
    let userIds: string[] = [];

    if (explicitChannel) {
      channelId = await resolveSlackChannelId(config, explicitChannel);
    } else {
      userIds = await Promise.all(
        uniqueRecipients.map((entry) => resolveSlackUserId(config, entry)),
      );

      const opened = await slackApiRequest(config, "conversations.open", {
        users: userIds.join(","),
      });
      const channel = parseBodyAsRecord(opened.channel);
      channelId = pickString(channel, ["id"]);
    }

    if (!channelId) {
      throw new Error("Could not resolve Slack DM/group channel.");
    }

    const sent = await slackApiRequest(config, "chat.postMessage", {
      channel: channelId,
      text,
      ...(blocks ? { blocks } : {}),
      ...(attachments ? { attachments } : {}),
    });

    dataStore.addLog({
      level: "info",
      service: "slack",
      action: "send_dm",
      message: `Sent Slack DM/group message to ${channelId}`,
      details: {
        channel: channelId,
        recipientCount: userIds.length || uniqueRecipients.length,
      },
    });

    return {
      ok: true,
      ts: sent.ts,
      recipients: uniqueRecipients,
      channel: channelId,
    };
  },

  "slack.updateMessage": async (params) => {
    const payload = params as JsonRecord;
    const config = getSlackConfig(payload);

    const channelInput = pickString(payload, ["channel", "channel_id"]);
    const ts = pickString(payload, ["timestamp", "ts"]);
    const text =
      pickString(payload, ["text", "message", "body"]) ||
      "Updated from NexusMCP";

    if (!channelInput || !ts) {
      throw new Error("Slack update_message requires channel and timestamp.");
    }

    const channel = await resolveSlackChannelId(config, channelInput);
    const updated = await slackApiRequest(config, "chat.update", {
      channel,
      ts,
      text,
    });

    return {
      ok: true,
      channel: updated.channel,
      ts: updated.ts,
      text,
    };
  },

  "slack.replyInThread": async (params) => {
    const payload = params as JsonRecord;
    const config = getSlackConfig(payload);
    const channelInput = pickString(payload, ["channel", "channel_id"]);
    const threadTs = pickString(payload, ["thread_ts", "threadTs", "ts"]);
    const text =
      pickString(payload, ["text", "message", "body"]) || "Thread reply";
    const blocks = Array.isArray(payload.blocks) ? payload.blocks : undefined;
    const attachments = Array.isArray(payload.attachments)
      ? payload.attachments
      : undefined;

    if (!channelInput || !threadTs) {
      throw new Error("slack.reply_in_thread requires channel and thread_ts.");
    }

    const channel = await resolveSlackChannelId(config, channelInput);
    const reply = await slackApiRequest(config, "chat.postMessage", {
      channel,
      thread_ts: threadTs,
      text,
      ...(blocks ? { blocks } : {}),
      ...(attachments ? { attachments } : {}),
    });

    dataStore.addLog({
      level: "info",
      service: "slack",
      action: "reply_in_thread",
      message: `Posted reply in Slack thread ${threadTs}`,
      details: { channel, threadTs },
    });

    return {
      ok: true,
      channel: reply.channel,
      ts: reply.ts,
      thread_ts: threadTs,
    };
  },

  "slack.postThreadReply": async (params) => {
    const payload = params as JsonRecord;
    return handlers["slack.replyInThread"](payload);
  },

  "slack.getThreadMessages": async (params) => {
    const payload = params as JsonRecord;
    const config = getSlackConfig(payload);
    const channelInput = pickString(payload, ["channel", "channel_id"]);
    const threadTs = pickString(payload, ["thread_ts", "threadTs", "ts"]);
    const limitRaw = Number(payload.limit ?? 50);
    const limit = Number.isFinite(limitRaw)
      ? Math.max(1, Math.min(200, Math.floor(limitRaw)))
      : 50;

    if (!channelInput || !threadTs) {
      throw new Error(
        "slack.get_thread_messages requires channel and thread_ts.",
      );
    }

    const channel = await resolveSlackChannelId(config, channelInput);
    const replies = await slackApiRequest(
      config,
      "conversations.replies",
      { channel, ts: threadTs, limit },
      { httpMethod: "GET" },
    );

    const messages = parseBodyAsList(replies.messages).map((entry) => {
      const message = parseBodyAsRecord(entry);
      return {
        user: pickString(message, ["user"]),
        text: pickString(message, ["text"]),
        ts: pickString(message, ["ts"]),
        thread_ts: pickString(message, ["thread_ts"]),
        bot_id: pickString(message, ["bot_id"]),
      };
    });

    return {
      channel,
      thread_ts: threadTs,
      messages,
      count: messages.length,
    };
  },

  "slack.listenSlackEvents": async (params) => {
    const payload = params as JsonRecord;
    const requestedEventTypes = parseBodyAsList(
      payload.event_types ?? payload.eventTypes,
    )
      .map((entry) => String(entry).trim().toLowerCase())
      .filter(Boolean);

    const eventTypes =
      requestedEventTypes.length > 0
        ? requestedEventTypes
        : ["message", "mention", "slash_command"];

    const endpoint =
      pickString(payload, ["endpoint", "webhook", "path"]) ||
      process.env.SLACK_EVENTS_ENDPOINT ||
      "/api/integrations/slack/events";

    const incoming = parseJsonLikePayload(
      payload.payload ?? payload.body ?? payload.event,
    );

    if (Object.keys(incoming).length === 0) {
      return {
        listening: false,
        mode: "configuration",
        endpoint,
        event_types: eventTypes,
        signing_secret_configured: Boolean(process.env.SLACK_SIGNING_SECRET),
        note: "Pass payload/body to normalize incoming Slack Events API or slash-command payloads.",
      };
    }

    const envelopeType = pickString(incoming, ["type"]);
    if (envelopeType === "url_verification") {
      return {
        listening: true,
        acknowledged: true,
        challenge: pickString(incoming, ["challenge"]),
      };
    }

    const event = parseBodyAsRecord(incoming.event);
    const slashCommand = pickString(incoming, ["command"]);
    const eventType = pickString(event, ["type"]);

    let normalizedEventType = "other";
    if (slashCommand) {
      normalizedEventType = "slash_command";
    } else if (eventType === "app_mention") {
      normalizedEventType = "mention";
    } else if (eventType === "message") {
      normalizedEventType = "message";
    }

    const shouldTrigger = eventTypes.includes(normalizedEventType);

    const normalizedPayload = {
      event_type: normalizedEventType,
      slack_event_type: eventType || slashCommand || envelopeType,
      command: slashCommand,
      text: pickString(event, ["text"]) || pickString(incoming, ["text"]),
      user: pickString(event, ["user"]) || pickString(incoming, ["user_id"]),
      channel:
        pickString(event, ["channel"]) || pickString(incoming, ["channel_id"]),
      ts: pickString(event, ["ts"]) || pickString(incoming, ["trigger_id"]),
    };

    dataStore.addLog({
      level: "info",
      service: "slack",
      action: "listen_slack_events",
      message: `Processed Slack event ${normalizedPayload.event_type}`,
      details: {
        shouldTrigger,
        eventType: normalizedPayload.slack_event_type,
      },
    });

    return {
      listening: true,
      acknowledged: true,
      should_trigger_workflow: shouldTrigger,
      subscribed_event_types: eventTypes,
      event: normalizedPayload,
    };
  },

  "slack.handleInteractions": async (params) => {
    const payload = params as JsonRecord;
    const incoming = parseJsonLikePayload(
      payload.payload ?? payload.body ?? payload.interaction,
    );

    if (Object.keys(incoming).length === 0) {
      throw new Error(
        "slack.handle_interactions requires payload/body with Slack interaction data.",
      );
    }

    const interactionType = pickString(incoming, ["type"]) || "unknown";
    const user = parseBodyAsRecord(incoming.user);
    const channel = parseBodyAsRecord(incoming.channel);
    const actions = parseBodyAsList(incoming.actions);
    const firstAction = parseBodyAsRecord(actions[0]);

    const actionId =
      pickString(firstAction, ["action_id"]) ||
      pickString(firstAction, ["name"]) ||
      pickString(incoming, ["callback_id"]) ||
      "unknown";
    const actionValue = pickString(firstAction, ["value", "text", "name"]);

    const decision =
      /approve/i.test(actionId) || /approve/i.test(actionValue || "")
        ? "approved"
        : /reject|deny/i.test(actionId) ||
            /reject|deny/i.test(actionValue || "")
          ? "rejected"
          : "handled";

    dataStore.addLog({
      level: "info",
      service: "slack",
      action: "handle_interactions",
      message: `Handled Slack interaction ${actionId}`,
      details: {
        interactionType,
        decision,
        user: pickString(user, ["id", "username"]),
      },
    });

    return {
      handled: true,
      interaction_type: interactionType,
      action_id: actionId,
      decision,
      user: {
        id: pickString(user, ["id"]),
        username: pickString(user, ["username"]),
      },
      channel: {
        id: pickString(channel, ["id"]),
        name: pickString(channel, ["name"]),
      },
      response_url: pickString(incoming, ["response_url"]),
    };
  },

  "slack.deleteMessage": async (params) => {
    const payload = params as JsonRecord;
    const config = getSlackConfig(payload);
    const channelInput = pickString(payload, ["channel", "channel_id"]);
    const ts = pickString(payload, ["timestamp", "ts"]);

    if (!channelInput || !ts) {
      throw new Error("slack.delete_message requires channel and timestamp.");
    }

    const channel = await resolveSlackChannelId(config, channelInput);
    await slackApiRequest(config, "chat.delete", {
      channel,
      ts,
    });

    return { ok: true, channel, ts };
  },

  "slack.archiveChannel": async (params) => {
    const payload = params as JsonRecord;
    const config = getSlackConfig(payload);
    const channelInput = pickString(payload, ["channel", "channel_id"]);
    if (!channelInput) {
      throw new Error("slack.archive_channel requires channel.");
    }

    const channel = await resolveSlackChannelId(config, channelInput);
    await slackApiRequest(config, "conversations.archive", { channel });
    return { ok: true, channel };
  },

  "slack.inviteToChannel": async (params) => {
    const payload = params as JsonRecord;
    const config = getSlackConfig(payload);
    const channelInput = pickString(payload, ["channel", "channel_id"]);
    if (!channelInput) {
      throw new Error("slack.invite_to_channel requires channel.");
    }

    const users = parseBodyAsList(payload.users ?? payload.members)
      .map((entry) => String(entry).trim())
      .filter(Boolean);
    if (users.length === 0) {
      throw new Error("slack.invite_to_channel requires users/members.");
    }

    const channel = await resolveSlackChannelId(config, channelInput);
    await slackApiRequest(config, "conversations.invite", {
      channel,
      users: users.join(","),
    });
    return { ok: true, channel, invited: users.length };
  },

  "slack.setChannelTopic": async (params) => {
    const payload = params as JsonRecord;
    const config = getSlackConfig(payload);
    const channelInput = pickString(payload, ["channel", "channel_id"]);
    const topic = pickString(payload, ["topic", "description", "text"]);

    if (!channelInput || !topic) {
      throw new Error("slack.set_channel_topic requires channel and topic.");
    }

    const channel = await resolveSlackChannelId(config, channelInput);
    await slackApiRequest(config, "conversations.setTopic", {
      channel,
      topic,
    });
    return { ok: true, channel, topic };
  },

  "slack.getUserByEmail": async (params) => {
    const payload = params as JsonRecord;
    const config = getSlackConfig(payload);
    const email = pickString(payload, ["email"]);

    if (!email) {
      throw new Error("slack.get_user_by_email requires email.");
    }

    const result = await slackApiRequest(config, "users.lookupByEmail", {
      email,
    });
    const user = parseBodyAsRecord(result.user);
    return {
      id: pickString(user, ["id"]),
      email,
      real_name: pickString(user, ["real_name"]),
      display_name: pickString(parseBodyAsRecord(user.profile), [
        "display_name",
      ]),
      is_bot: Boolean(user.is_bot),
    };
  },

  "slack.getUserStatus": async (params) => {
    const payload = params as JsonRecord;
    const config = getSlackConfig(payload);
    const user = pickString(payload, ["user", "user_id"]);

    const presence = await slackApiRequest(
      config,
      "users.getPresence",
      user ? { user } : {},
      { httpMethod: "GET" },
    );

    const dnd = await slackApiRequest(
      config,
      "dnd.info",
      user ? { user } : {},
      { httpMethod: "GET" },
    );

    return {
      user,
      presence: pickString(presence, ["presence"]),
      online: pickString(presence, ["presence"]) === "active",
      dnd_enabled: Boolean(dnd.dnd_enabled),
      next_dnd_start_ts: dnd.next_dnd_start_ts,
      next_dnd_end_ts: dnd.next_dnd_end_ts,
    };
  },

  "slack.listTeamMembers": async (params) => {
    const payload = params as JsonRecord;
    const config = getSlackConfig(payload);
    const limit = Number(payload.limit ?? 200);

    const result = await slackApiRequest(
      config,
      "users.list",
      {
        limit: Number.isFinite(limit)
          ? Math.max(1, Math.min(1000, limit))
          : 200,
      },
      { httpMethod: "GET" },
    );

    const members = parseBodyAsList(result.members).map((entry) => {
      const user = parseBodyAsRecord(entry);
      const profile = parseBodyAsRecord(user.profile);
      return {
        id: pickString(user, ["id"]),
        name: pickString(user, ["name"]),
        real_name: pickString(user, ["real_name"]),
        email: pickString(profile, ["email"]),
        is_bot: Boolean(user.is_bot),
      };
    });

    return {
      members,
      count: members.length,
    };
  },

  "slack.sendInteractiveMessage": async (params) => {
    const payload = params as JsonRecord;
    const config = getSlackConfig(payload);
    const channelInput = pickString(payload, ["channel", "channel_id"]);
    if (!channelInput) {
      throw new Error("slack.send_interactive_message requires channel.");
    }

    const channel = await resolveSlackChannelId(config, channelInput);
    const text =
      pickString(payload, ["text", "message", "fallback"]) || "Action required";
    const blocks = Array.isArray(payload.blocks) ? payload.blocks : undefined;

    const result = await slackApiRequest(config, "chat.postMessage", {
      channel,
      text,
      ...(blocks ? { blocks } : {}),
    });

    return {
      ok: true,
      channel: result.channel,
      ts: result.ts,
    };
  },

  "slack.scheduleMessage": async (params) => {
    const payload = params as JsonRecord;
    const config = getSlackConfig(payload);
    const channelInput = pickString(payload, ["channel", "channel_id"]);
    if (!channelInput) {
      throw new Error("slack.schedule_message requires channel.");
    }

    const channel = await resolveSlackChannelId(config, channelInput);
    const text =
      pickString(payload, ["text", "message", "body"]) || "Scheduled message";
    const postAtRaw = payload.post_at ?? payload.postAt ?? payload.send_at;
    const postAt =
      typeof postAtRaw === "number"
        ? Math.floor(postAtRaw)
        : Number.isFinite(Number(postAtRaw))
          ? Math.floor(Number(postAtRaw))
          : Math.floor(Date.now() / 1000) + 60;

    const result = await slackApiRequest(config, "chat.scheduleMessage", {
      channel,
      text,
      post_at: postAt,
    });

    return {
      ok: true,
      channel: result.channel,
      scheduled_message_id: result.scheduled_message_id,
      post_at: result.post_at,
    };
  },

  "slack.createPoll": async (params) => {
    const payload = params as JsonRecord;
    const channelInput = pickString(payload, ["channel", "channel_id"]);
    if (!channelInput) {
      throw new Error("slack.create_poll requires channel.");
    }

    const question =
      pickString(payload, ["question", "text", "title"]) || "Poll";
    const options = parseBodyAsList(payload.options)
      .map((entry) => String(entry).trim())
      .filter(Boolean);

    if (options.length === 0) {
      throw new Error("slack.create_poll requires at least one option.");
    }

    const blocks = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${question}*`,
        },
      },
      ...options.map((option, index) => ({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${index + 1}. ${option}`,
        },
      })),
    ];

    return handlers["slack.sendInteractiveMessage"]({
      ...payload,
      channel: channelInput,
      text: question,
      blocks,
    });
  },

  "slack.waitForUserResponse": async (params) => {
    const payload = params as JsonRecord;
    const config = getSlackConfig(payload);
    const channelInput = pickString(payload, ["channel", "channel_id"]);
    const threadTs = pickString(payload, ["thread_ts", "threadTs", "ts"]);
    const timeoutSecondsRaw = Number(
      payload.timeout_seconds ?? payload.timeout ?? 60,
    );
    const timeoutSeconds = Number.isFinite(timeoutSecondsRaw)
      ? Math.max(5, Math.min(300, timeoutSecondsRaw))
      : 60;

    if (!channelInput || !threadTs) {
      throw new Error(
        "slack.wait_for_user_response requires channel and thread_ts.",
      );
    }

    const channel = await resolveSlackChannelId(config, channelInput);
    const start = Date.now();
    const pollIntervalMs = 3000;

    while (Date.now() - start < timeoutSeconds * 1000) {
      const replies = await slackApiRequest(
        config,
        "conversations.replies",
        { channel, ts: threadTs, inclusive: true, limit: 50 },
        { httpMethod: "GET" },
      );

      const messages = parseBodyAsList(replies.messages);
      if (messages.length > 1) {
        const latest = parseBodyAsRecord(messages[messages.length - 1]);
        const text = pickString(latest, ["text"]);
        if (text) {
          return {
            received: true,
            timeout_seconds: timeoutSeconds,
            response: {
              text,
              user: pickString(latest, ["user"]),
              ts: pickString(latest, ["ts"]),
            },
          };
        }
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    return {
      received: false,
      timeout_seconds: timeoutSeconds,
      message: "No user response received within timeout window.",
    };
  },

  "slack.getOnCallSchedule": async (params) => {
    const payload = params as JsonRecord;
    const scheduleEndpoint =
      pickString(payload, ["endpoint", "url"]) ||
      process.env.ONCALL_SCHEDULE_ENDPOINT ||
      "";

    if (!scheduleEndpoint) {
      return {
        configured: false,
        message:
          "On-call provider endpoint is not configured. Set ONCALL_SCHEDULE_ENDPOINT or pass endpoint in arguments.",
      };
    }

    const response = await fetch(scheduleEndpoint, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });
    const body = await parseResponseBody(response);

    if (!response.ok) {
      throw new Error(
        `On-call schedule request failed (${response.status}): ${normalizeErrorDetail(
          body,
          response.statusText || "Unknown on-call provider error",
        )}`,
      );
    }

    return {
      configured: true,
      schedule: body,
    };
  },

  // Google Sheets methods
  "sheets.listSheets": async (params) => {
    const payload = params as JsonRecord;
    const config = await getSheetsConfig(payload);

    const response = await sheetsApiRequest(
      config,
      "GET",
      "?fields=spreadsheetId,spreadsheetUrl,sheets(properties(sheetId,title,index,gridProperties(rowCount,columnCount)))",
    );

    const sheets = parseBodyAsList(response.sheets).map((entry) => {
      const sheet = parseBodyAsRecord(entry);
      const properties = parseBodyAsRecord(sheet.properties);
      const grid = parseBodyAsRecord(properties.gridProperties);
      return {
        id: Number(properties.sheetId ?? 0),
        title: pickString(properties, ["title"]) || "",
        index: Number(properties.index ?? 0),
        rowCount: Number(grid.rowCount ?? 0),
        columnCount: Number(grid.columnCount ?? 0),
      };
    });

    return {
      sheet_id: config.spreadsheetId,
      spreadsheet_url: pickString(response, ["spreadsheetUrl"]),
      sheets,
      count: sheets.length,
    };
  },

  "sheets.readRange": async (params) => {
    const payload = params as JsonRecord;
    const config = await getSheetsConfig(payload);
    const range = pickString(payload, ["range"]) || "Sheet1!A1:Z100";

    const response = await sheetsApiRequest(
      config,
      "GET",
      `/values/${encodeURIComponent(range)}`,
    );

    dataStore.addLog({
      level: "info",
      service: "google_sheets",
      action: "sheets_read_range",
      message: `Read ${range} from spreadsheet ${config.spreadsheetId}`,
      details: { spreadsheetId: config.spreadsheetId, range },
    });

    return {
      sheet_id: config.spreadsheetId,
      range: pickString(response, ["range"]) || range,
      values: parseBodyAsList(response.values),
      majorDimension: pickString(response, ["majorDimension"]),
    };
  },

  "sheets.getRows": async (params) => {
    const payload = params as JsonRecord;
    const sheetName =
      pickString(payload, ["sheet_name", "sheet", "tab"]) || "Sheet1";
    const range = pickString(payload, ["range"]) || `${sheetName}!A1:ZZ1000`;

    const readResult = asRecord(
      await handlers["sheets.readRange"]({
        ...payload,
        range,
      }),
    );

    const values = parseBodyAsList(readResult.values).map((entry) =>
      Array.isArray(entry) ? entry : [entry],
    );
    const headers =
      values.length > 0 && Array.isArray(values[0]) ? values[0] : [];

    return {
      ...readResult,
      headers,
      rows: values.slice(1),
      rowCount: Math.max(0, values.length - 1),
    };
  },

  "sheets.appendRow": async (params) => {
    const payload = params as JsonRecord;
    const config = await getSheetsConfig(payload);
    const sheetName =
      pickString(payload, ["sheet_name", "sheet", "tab"]) || "Sheet1";
    const rows = normalizeSheetValues(payload.row_data ?? payload.values ?? []);

    if (rows.length === 0) {
      throw new Error("sheets.append_row requires row_data or values.");
    }

    const appendRange = pickString(payload, ["range"]) || `${sheetName}!A:ZZ`;
    const response = await sheetsApiRequest(
      config,
      "POST",
      `/values/${encodeURIComponent(appendRange)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      {
        majorDimension: "ROWS",
        values: rows,
      },
      { writeOperation: true },
    );

    const updates = parseBodyAsRecord(response.updates);

    dataStore.addLog({
      level: "info",
      service: "google_sheets",
      action: "sheets_append_row",
      message: `Appended ${rows.length} row(s) to ${config.spreadsheetId}`,
      details: {
        spreadsheetId: config.spreadsheetId,
        sheetName,
        updatedRange: pickString(updates, ["updatedRange"]),
      },
    });

    return {
      sheet_id: config.spreadsheetId,
      sheet_name: sheetName,
      updatedRange: pickString(updates, ["updatedRange"]),
      updatedRows: Number(updates.updatedRows ?? 0),
      updatedCells: Number(updates.updatedCells ?? 0),
    };
  },

  "sheets.addRow": async (params) => {
    const payload = params as JsonRecord;
    const rowInput =
      payload.row ?? payload.row_data ?? payload.values ?? payload.data;
    const uniqueByRaw = payload.unique_by ?? payload.uniqueBy;

    const rowRecord = asRecord(rowInput);
    if (Object.keys(rowRecord).length > 0 && !Array.isArray(rowInput)) {
      const sheetName =
        pickString(payload, ["sheet_name", "sheet", "tab"]) || "Sheet1";

      const uniqueBy = Array.isArray(uniqueByRaw)
        ? uniqueByRaw
            .map((entry) => String(entry).trim())
            .filter((entry) => entry.length > 0)
        : typeof uniqueByRaw === "string" && uniqueByRaw.trim().length > 0
          ? [uniqueByRaw.trim()]
          : [];

      if (uniqueBy.length > 0) {
        const filters = uniqueBy.reduce<JsonRecord>((acc, key) => {
          if (rowRecord[key] !== undefined && rowRecord[key] !== null) {
            acc[key] = rowRecord[key];
          }
          return acc;
        }, {});

        if (Object.keys(filters).length > 0) {
          const existing = asRecord(
            await handlers["sheets.queryRows"]({
              ...payload,
              sheet_name: sheetName,
              filters,
              limit: 1,
            }),
          );

          if (Number(existing.count ?? 0) > 0) {
            return {
              skipped: true,
              reason: "duplicate",
              sheet_id: existing.sheet_id,
              sheet_name: sheetName,
              filters,
            };
          }
        }
      }

      const headerRange = `${sheetName}!1:1`;
      const headerRead = asRecord(
        await handlers["sheets.readRange"]({
          ...payload,
          range: headerRange,
        }),
      );
      const headerRows = parseBodyAsList(headerRead.values);
      let headers =
        headerRows.length > 0 && Array.isArray(headerRows[0])
          ? (headerRows[0] as unknown[])
          : [];

      const rowKeys = Object.keys(rowRecord);
      const normalizedHeaderKeys = headers
        .map((entry) => String(entry ?? "").trim())
        .filter((entry) => entry.length > 0);

      if (normalizedHeaderKeys.length === 0 && rowKeys.length > 0) {
        await handlers["sheets.appendRow"]({
          ...payload,
          row_data: [rowKeys],
          range: `${sheetName}!1:1`,
        });
        headers = [...rowKeys];
      }

      const currentHeaders = headers
        .map((entry) => String(entry ?? "").trim())
        .filter((entry) => entry.length > 0);

      const missingHeaders = rowKeys.filter(
        (key) => !currentHeaders.includes(key),
      );

      if (currentHeaders.length > 0 && missingHeaders.length > 0) {
        const updatedHeaders = [...currentHeaders, ...missingHeaders];
        const endColumn = toSheetColumnName(updatedHeaders.length);

        await handlers["sheets.updateCells"]({
          ...payload,
          range: `${sheetName}!A1:${endColumn}1`,
          values: [updatedHeaders],
        });

        headers = [...updatedHeaders];
      }

      const mappedRow =
        headers.length > 0
          ? headers.map((header) => {
              const key = String(header ?? "").trim();
              return key ? (rowRecord[key] ?? "") : "";
            })
          : Object.values(rowRecord);

      return handlers["sheets.appendRow"]({
        ...payload,
        row_data: [mappedRow],
      });
    }

    return handlers["sheets.appendRow"]({
      ...payload,
      row_data: rowInput,
    });
  },

  "sheets.updateCells": async (params) => {
    const payload = params as JsonRecord;
    const config = await getSheetsConfig(payload);

    let values = normalizeSheetValues(
      payload.values ?? payload.row_data ?? payload.value ?? "",
    );

    const sheetName =
      pickString(payload, ["sheet_name", "sheet", "tab"]) || "Sheet1";
    const prompt = pickString(payload, ["prompt", "input"]) || "";

    let range = pickString(payload, ["range"]);
    if (!range) {
      const rowRaw = Number(
        payload.row ?? payload.row_number ?? payload.rowIndex,
      );
      const columnRaw = Number(
        payload.column ??
          payload.col ??
          payload.column_number ??
          payload.columnIndex,
      );

      if (Number.isFinite(rowRaw) && Number.isFinite(columnRaw)) {
        const row = Math.max(1, Math.floor(rowRaw));
        const column = Math.max(1, Math.floor(columnRaw));
        const width = Math.max(1, values[0]?.length || 1);
        const startCol = toSheetColumnName(column);
        const endCol = toSheetColumnName(column + width - 1);
        range = `${sheetName}!${startCol}${row}:${endCol}${row}`;
      }
    }

    if (!range) {
      // If range is missing but prompt clearly asks to add entries, infer rows
      // and append them instead of failing hard.
      if (!hasMeaningfulSheetValues(values)) {
        const issueKeys = parseIssueKeysFromPrompt(prompt);
        if (issueKeys.length > 0) {
          const generatedAt = new Date().toISOString();
          values = issueKeys.map((issueKey) => [
            issueKey,
            "Latest details",
            generatedAt,
          ]);
        }
      }

      if (hasMeaningfulSheetValues(values)) {
        const appendResult = await handlers["sheets.appendRow"]({
          ...payload,
          sheet_name: sheetName,
          values,
          range: `${sheetName}!A:ZZ`,
        });

        return {
          ...(asRecord(appendResult) as JsonRecord),
          mode: "append_fallback",
          reason: "range_missing",
        };
      }

      throw new Error(
        "sheets.update_cells requires range, or row+column coordinates. Provide range/coordinates, or include non-empty values.",
      );
    }

    const response = await sheetsApiRequest(
      config,
      "PUT",
      `/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
      {
        range,
        majorDimension: "ROWS",
        values,
      },
      { writeOperation: true },
    );

    dataStore.addLog({
      level: "info",
      service: "google_sheets",
      action: "sheets_update_cells",
      message: `Updated ${range} in spreadsheet ${config.spreadsheetId}`,
      details: { spreadsheetId: config.spreadsheetId, range },
    });

    return {
      sheet_id: config.spreadsheetId,
      range: pickString(response, ["updatedRange"]) || range,
      updatedRows: Number(response.updatedRows ?? 0),
      updatedColumns: Number(response.updatedColumns ?? 0),
      updatedCells: Number(response.updatedCells ?? 0),
    };
  },

  "sheets.updateRow": async (params) => {
    const payload = params as JsonRecord;
    const explicitRange = pickString(payload, ["range"]);

    if (explicitRange) {
      return handlers["sheets.updateCells"](payload);
    }

    const sheetName =
      pickString(payload, ["sheet_name", "sheet", "tab"]) || "Sheet1";
    const rowIndexRaw = Number(
      payload.row_index ??
        payload.row ??
        payload.row_number ??
        payload.rowNumber,
    );

    if (!Number.isFinite(rowIndexRaw) || rowIndexRaw <= 0) {
      throw new Error(
        "sheets.update_row requires row_index (or row/row_number) when range is not provided.",
      );
    }

    let values = normalizeSheetValues(
      payload.values ??
        payload.row_data ??
        payload.value ??
        payload.row_data ??
        [],
    );

    const rowRecord = asRecord(
      payload.row_data ?? payload.row_values ?? payload.row,
    );
    if (Object.keys(rowRecord).length > 0 && !Array.isArray(payload.row_data)) {
      const headerRead = asRecord(
        await handlers["sheets.readRange"]({
          ...payload,
          range: `${sheetName}!1:1`,
        }),
      );
      const headerRows = parseBodyAsList(headerRead.values);
      const headers =
        headerRows.length > 0 && Array.isArray(headerRows[0])
          ? (headerRows[0] as unknown[])
          : [];

      if (headers.length > 0) {
        values = [
          headers.map((header) => {
            const key = String(header ?? "").trim();
            return key ? (rowRecord[key] ?? "") : "";
          }),
        ];
      }
    }

    const width = Math.max(1, values[0]?.length || 1);
    const startColumn = Number(payload.column ?? payload.column_index ?? 1);
    const startColName = toSheetColumnName(
      Number.isFinite(startColumn) && startColumn > 0
        ? Math.floor(startColumn)
        : 1,
    );
    const endColName = toSheetColumnName(
      (Number.isFinite(startColumn) && startColumn > 0
        ? Math.floor(startColumn)
        : 1) +
        width -
        1,
    );

    return handlers["sheets.updateCells"]({
      ...payload,
      range: `${sheetName}!${startColName}${Math.floor(rowIndexRaw)}:${endColName}${Math.floor(rowIndexRaw)}`,
      values,
    });
  },

  "sheets.deleteRow": async (params) => {
    const payload = params as JsonRecord;
    const config = await getSheetsConfig(payload);
    const sheetName =
      pickString(payload, ["sheet_name", "sheet", "tab"]) || "Sheet1";
    const rowIndexRaw = Number(
      payload.row_index ??
        payload.row ??
        payload.row_number ??
        payload.rowNumber,
    );

    if (!Number.isFinite(rowIndexRaw) || rowIndexRaw <= 0) {
      throw new Error(
        "sheets.delete_row requires row_index (or row/row_number) greater than 0.",
      );
    }

    const metadata = await sheetsApiRequest(config, "GET", "");
    const sheets = parseBodyAsList(metadata.sheets);
    const target = sheets
      .map((entry) => parseBodyAsRecord(entry))
      .find((entry) => {
        const properties = parseBodyAsRecord(entry.properties);
        return pickString(properties, ["title"]) === sheetName;
      });

    if (!target) {
      throw new Error(`Sheet '${sheetName}' was not found in spreadsheet.`);
    }

    const properties = parseBodyAsRecord(target.properties);
    const sheetId = Number(properties.sheetId ?? NaN);
    if (!Number.isFinite(sheetId)) {
      throw new Error(`Sheet '${sheetName}' is missing a valid sheetId.`);
    }

    const startIndex = Math.floor(rowIndexRaw) - 1;
    const endIndex = startIndex + 1;

    await sheetsApiRequest(
      config,
      "POST",
      ":batchUpdate",
      {
        requests: [
          {
            deleteDimension: {
              range: {
                sheetId,
                dimension: "ROWS",
                startIndex,
                endIndex,
              },
            },
          },
        ],
      },
      { writeOperation: true },
    );

    return {
      sheet_id: config.spreadsheetId,
      sheet_name: sheetName,
      deleted_row_index: Math.floor(rowIndexRaw),
      ok: true,
    };
  },

  "sheets.queryRows": async (params) => {
    const payload = params as JsonRecord;
    const sheetName =
      pickString(payload, ["sheet_name", "sheet", "tab"]) || "Sheet1";
    const range = pickString(payload, ["range"]) || `${sheetName}!A1:ZZ1000`;
    const queryText =
      pickString(payload, ["query", "search", "contains"]) || "";
    const column = pickString(payload, ["column", "field", "header"]);
    const value = pickString(payload, ["value", "equals", "match"]);
    const operator = (
      pickString(payload, ["operator", "op"]) || "equals"
    ).toLowerCase();
    const filters = asRecord(payload.filters);
    const limitRaw = Number(
      payload.limit ?? payload.max_rows ?? payload.maxResults ?? 100,
    );
    const limit = Number.isFinite(limitRaw)
      ? Math.max(1, Math.min(5000, Math.floor(limitRaw)))
      : 100;

    const readResult = asRecord(
      await handlers["sheets.readRange"]({
        ...payload,
        range,
      }),
    );

    const values = parseBodyAsList(readResult.values).map((entry) =>
      Array.isArray(entry) ? entry : [entry],
    );
    const headerRow =
      values.length > 0 && Array.isArray(values[0]) ? values[0] : [];
    const headers = headerRow.map((header, index) => {
      const text = String(header ?? "").trim();
      return text || `column_${index + 1}`;
    });

    const dataRows = values.slice(1).map((row, rowOffset) => {
      const rowRecord: JsonRecord = {
        _rowIndex: rowOffset + 2,
      };
      headers.forEach((header, index) => {
        rowRecord[header] = (row as unknown[])[index] ?? "";
      });
      return rowRecord;
    });

    const normalizedQuery = queryText.trim().toLowerCase();

    const matched = dataRows.filter((row) => {
      if (normalizedQuery) {
        const haystack = Object.values(row)
          .map((item) => String(item ?? ""))
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(normalizedQuery)) {
          return false;
        }
      }

      if (column && value !== undefined) {
        const current = String(row[column] ?? "");
        const expected = String(value);
        const currentLower = current.toLowerCase();
        const expectedLower = expected.toLowerCase();

        if (operator === "contains" && !currentLower.includes(expectedLower)) {
          return false;
        }

        if (
          operator === "starts_with" &&
          !currentLower.startsWith(expectedLower)
        ) {
          return false;
        }

        if (operator === "not_equals" && currentLower === expectedLower) {
          return false;
        }

        if (
          (operator === "equals" || operator === "eq") &&
          currentLower !== expectedLower
        ) {
          return false;
        }
      }

      for (const [filterKey, filterValue] of Object.entries(filters)) {
        const rowValue = String(row[filterKey] ?? "").toLowerCase();
        const expected = String(filterValue ?? "").toLowerCase();
        if (rowValue !== expected) {
          return false;
        }
      }

      return true;
    });

    return {
      sheet_id: readResult.sheet_id,
      range: readResult.range,
      headers,
      rows: matched.slice(0, limit),
      count: matched.length,
      returned: Math.min(matched.length, limit),
    };
  },

  // Gmail methods
  "gmail.listMessages": async (params) => {
    const payload = params as JsonRecord;
    const config = await getGmailConfig(payload);
    const query =
      pickString(payload, ["query", "q"]) || "in:inbox newer_than:7d";
    const maxResultsRaw = Number(
      payload.max_results ?? payload.maxResults ?? 20,
    );
    const maxResults = Number.isFinite(maxResultsRaw)
      ? Math.max(1, Math.min(100, maxResultsRaw))
      : 20;

    let response: JsonRecord;
    try {
      response = await gmailApiRequest(
        config,
        "GET",
        `/messages?q=${encodeURIComponent(query)}&maxResults=${maxResults}`,
      );
    } catch (error) {
      const guidedError = withGmailPermissionGuidance(error, "list_messages");

      if (/gmail request failed \(403\)/i.test(guidedError.message)) {
        dataStore.addLog({
          level: "warning",
          service: "gmail",
          action: "gmail_list_messages_fallback_empty",
          message:
            "Gmail denied message listing; returning empty message list and continuing execution.",
          details: {
            query,
            reason: guidedError.message,
            requiredScopes: getGmailRequiredScopes("list_messages"),
          },
        });

        return {
          query,
          resultSizeEstimate: 0,
          messages: [],
          warning:
            "Gmail list access denied (403). Reconnect Gmail with gmail.readonly scope.",
          requiredScopes: getGmailRequiredScopes("list_messages"),
        };
      }

      throw guidedError;
    }

    const messages = parseBodyAsList(response.messages).map((entry) => {
      const message = parseBodyAsRecord(entry);
      return {
        id: pickString(message, ["id"]),
        threadId: pickString(message, ["threadId"]),
      };
    });

    return {
      query,
      resultSizeEstimate:
        typeof response.resultSizeEstimate === "number"
          ? response.resultSizeEstimate
          : messages.length,
      messages,
    };
  },

  "gmail.searchEmails": async (params) => {
    const payload = params as JsonRecord;
    const query = pickString(payload, ["query", "q"]) || "in:inbox";
    const result = (await handlers["gmail.listMessages"]({
      ...payload,
      query,
    })) as JsonRecord;

    return {
      ...result,
      operation: "search_emails",
    };
  },

  "gmail.readEmail": async (params) => {
    const payload = params as JsonRecord;
    const config = await getGmailConfig(payload);
    const messageId = pickString(payload, ["messageId", "id", "emailId"]);

    if (!messageId) {
      throw new Error("gmail.read_email requires messageId (or id).");
    }

    let message: JsonRecord;
    try {
      message = await gmailGetMessage(config, messageId, "full");
    } catch (error) {
      throw withGmailPermissionGuidance(error, "read_email");
    }

    const summary = summarizeGmailMessage(message);
    const payloadData = parseBodyAsRecord(message.payload);
    const body = decodeGmailMessageBody(payloadData);

    return {
      ...summary,
      body,
      rawSizeEstimate: Number(message.sizeEstimate ?? 0),
      historyId: pickString(message, ["historyId"]),
    };
  },

  "gmail.parseEmail": async (params) => {
    const payload = params as JsonRecord;

    let message: JsonRecord;
    if (
      typeof payload.message === "object" &&
      payload.message &&
      !Array.isArray(payload.message)
    ) {
      message = parseBodyAsRecord(payload.message);
    } else {
      const messageId = pickString(payload, ["messageId", "id", "emailId"]);
      if (!messageId) {
        throw new Error(
          "gmail.parse_email requires a message payload or messageId.",
        );
      }

      const config = await getGmailConfig(payload);
      try {
        message = await gmailGetMessage(config, messageId, "full");
      } catch (error) {
        throw withGmailPermissionGuidance(error, "parse_email");
      }
    }

    const summary = summarizeGmailMessage(message);
    const messagePayload = parseBodyAsRecord(message.payload);
    const headerMap = getGmailHeaderMap(messagePayload.headers);
    const body = decodeGmailMessageBody(messagePayload);
    const attachments = collectGmailAttachments(messagePayload);

    return {
      ...summary,
      sender: headerMap.from || "",
      recipient: headerMap.to || "",
      subject: headerMap.subject || "",
      body,
      attachments,
      parsed: true,
    };
  },

  "gmail.sendMessage": async (params) => {
    const payload = params as JsonRecord;
    const config = await getGmailConfig(payload);
    const to = pickString(payload, ["to", "recipient", "email"]);
    const subject =
      pickString(payload, ["subject", "title"]) || "NexusMCP Update";
    const body = pickString(payload, ["body", "text", "message"]) || "";
    const html = pickString(payload, ["html"]);
    const threadId = pickString(payload, ["threadId", "thread_id"]);
    const attachments = parseBodyAsList(payload.attachments).map((entry) =>
      parseBodyAsRecord(entry),
    ) as GmailAttachmentInput[];

    if (!to) {
      throw new Error("gmail.send_message requires recipient email (to).");
    }

    const raw = buildGmailRawMessage({
      to,
      subject,
      ...(html ? { html } : { text: body }),
      ...(attachments.length > 0 ? { attachments } : {}),
    });

    let response: JsonRecord;
    try {
      response = await gmailApiRequest(config, "POST", "/messages/send", {
        raw,
        ...(threadId ? { threadId } : {}),
      });
    } catch (error) {
      throw withGmailPermissionGuidance(error, "send_message");
    }

    dataStore.addLog({
      level: "info",
      service: "gmail",
      action: "gmail_send_message",
      message: `Sent Gmail message to ${to}`,
      details: { to, subject, id: response.id },
    });

    return {
      id: response.id,
      threadId: response.threadId,
      to,
      subject,
      accepted: true,
    };
  },

  "gmail.replyEmail": async (params) => {
    const payload = params as JsonRecord;
    const config = await getGmailConfig(payload);
    const messageId = pickString(payload, ["messageId", "id", "emailId"]);
    const explicitThreadId = pickString(payload, ["threadId", "thread_id"]);
    const explicitTo = pickString(payload, ["to", "recipient", "email"]);
    const body = pickString(payload, ["body", "text", "message"]) || "";
    const html = pickString(payload, ["html"]);

    if (!explicitThreadId && !messageId) {
      throw new Error(
        "gmail.reply_email requires threadId or messageId to anchor the reply.",
      );
    }

    let threadId = explicitThreadId || "";
    let to = explicitTo || "";
    let subject = pickString(payload, ["subject", "title"]);
    let inReplyTo = pickString(payload, ["inReplyTo", "in_reply_to"]);
    let references = pickString(payload, ["references"]);

    if (messageId) {
      let original: JsonRecord;
      try {
        original = await gmailGetMessage(config, messageId, "full");
      } catch (error) {
        throw withGmailPermissionGuidance(error, "reply_email");
      }

      const originalPayload = parseBodyAsRecord(original.payload);
      const headers = getGmailHeaderMap(originalPayload.headers);
      threadId = threadId || pickString(original, ["threadId"]) || "";

      if (!to && headers.from) {
        to = extractMessageAddress(headers.from);
      }

      if (!subject) {
        const source = headers.subject || "";
        subject = /^re:/i.test(source) ? source : `Re: ${source || "Message"}`;
      }

      inReplyTo = inReplyTo || headers["message-id"] || "";
      references = references || headers.references || inReplyTo || "";
    }

    if (!to) {
      throw new Error("gmail.reply_email could not resolve recipient address.");
    }

    if (!threadId) {
      throw new Error("gmail.reply_email requires threadId.");
    }

    const additionalHeaders: string[] = [];
    if (inReplyTo) {
      additionalHeaders.push(`In-Reply-To: ${inReplyTo}`);
    }
    if (references) {
      additionalHeaders.push(`References: ${references}`);
    }

    const raw = buildGmailRawMessage({
      to,
      subject: subject || "Re: Message",
      ...(html ? { html } : { text: body }),
      ...(additionalHeaders.length > 0 ? { additionalHeaders } : {}),
    });

    let response: JsonRecord;
    try {
      response = await gmailApiRequest(config, "POST", "/messages/send", {
        raw,
        threadId,
      });
    } catch (error) {
      throw withGmailPermissionGuidance(error, "reply_email");
    }

    return {
      id: response.id,
      threadId: response.threadId || threadId,
      to,
      subject: subject || "Re: Message",
      replied: true,
    };
  },

  "gmail.addLabel": async (params) => {
    const payload = params as JsonRecord;
    const config = await getGmailConfig(payload);
    const messageId = pickString(payload, ["messageId", "id", "emailId"]);

    if (!messageId) {
      throw new Error("gmail.add_label requires messageId (or id).");
    }

    const addLabelIds = parseBodyAsList(payload.addLabelIds ?? payload.labels)
      .filter(
        (entry): entry is string =>
          typeof entry === "string" && entry.trim().length > 0,
      )
      .map((entry) => entry.trim());
    const removeLabelIds = parseBodyAsList(payload.removeLabelIds)
      .filter(
        (entry): entry is string =>
          typeof entry === "string" && entry.trim().length > 0,
      )
      .map((entry) => entry.trim());

    if (addLabelIds.length === 0 && removeLabelIds.length === 0) {
      throw new Error(
        "gmail.add_label requires at least one label in addLabelIds/labels/removeLabelIds.",
      );
    }

    let response: JsonRecord;
    try {
      response = await gmailApiRequest(
        config,
        "POST",
        `/messages/${encodeURIComponent(messageId)}/modify`,
        {
          addLabelIds,
          removeLabelIds,
        },
      );
    } catch (error) {
      throw withGmailPermissionGuidance(error, "add_label");
    }

    return {
      id: pickString(response, ["id"]) || messageId,
      threadId: pickString(response, ["threadId"]),
      labelIds: parseBodyAsList(response.labelIds).filter(
        (entry): entry is string => typeof entry === "string",
      ),
      added: addLabelIds,
      removed: removeLabelIds,
    };
  },

  "gmail.getThread": async (params) => {
    const payload = params as JsonRecord;
    const config = await getGmailConfig(payload);
    let threadId = pickString(payload, ["threadId", "thread_id"]);

    const messageId = pickString(payload, ["messageId", "id", "emailId"]);
    if (!threadId && messageId) {
      const message = await gmailGetMessage(config, messageId, "metadata");
      threadId = pickString(message, ["threadId"]);
    }

    if (!threadId) {
      throw new Error("gmail.get_thread requires threadId or messageId.");
    }

    let response: JsonRecord;
    try {
      response = await gmailApiRequest(
        config,
        "GET",
        `/threads/${encodeURIComponent(threadId)}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To`,
      );
    } catch (error) {
      throw withGmailPermissionGuidance(error, "get_thread");
    }

    const messages = parseBodyAsList(response.messages).map((entry) =>
      summarizeGmailMessage(parseBodyAsRecord(entry)),
    );

    return {
      id: pickString(response, ["id"]) || threadId,
      historyId: pickString(response, ["historyId"]),
      messages,
      messageCount: messages.length,
    };
  },

  "gmail.getAttachments": async (params) => {
    const payload = params as JsonRecord;
    const config = await getGmailConfig(payload);
    const messageId = pickString(payload, ["messageId", "id", "emailId"]);

    if (!messageId) {
      throw new Error("gmail.get_attachments requires messageId (or id).");
    }

    let message: JsonRecord;
    try {
      message = await gmailGetMessage(config, messageId, "full");
    } catch (error) {
      throw withGmailPermissionGuidance(error, "get_attachments");
    }

    const messagePayload = parseBodyAsRecord(message.payload);
    const attachments = collectGmailAttachments(messagePayload);
    const wantedAttachmentId = pickString(payload, ["attachmentId"]);
    const wantedFilename = pickString(payload, ["filename"]);
    const download = payload.download === true || !!wantedAttachmentId;

    if (!download) {
      return {
        messageId,
        count: attachments.length,
        attachments: attachments.map((entry) => ({
          filename: entry.filename,
          mimeType: entry.mimeType,
          attachmentId: entry.attachmentId,
          size: entry.size,
        })),
      };
    }

    const selected = attachments.find((entry) => {
      const idMatch = wantedAttachmentId
        ? entry.attachmentId === wantedAttachmentId
        : true;
      const nameMatch = wantedFilename
        ? entry.filename === wantedFilename
        : true;
      return idMatch && nameMatch;
    });

    if (!selected || !selected.attachmentId) {
      throw new Error(
        "Attachment not found. Provide a valid attachmentId/filename from gmail.get_attachments list result.",
      );
    }

    const attachmentData = await gmailApiRequest(
      config,
      "GET",
      `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(String(selected.attachmentId))}`,
    );

    return {
      messageId,
      attachmentId: selected.attachmentId,
      filename: selected.filename,
      mimeType: selected.mimeType,
      size: selected.size,
      data: pickString(attachmentData, ["data"]),
    };
  },

  "gmail.listenEmailEvents": async (params) => {
    const payload = params as JsonRecord;
    const config = await getGmailConfig(payload);
    const maxResultsRaw = Number(
      payload.maxResults ?? payload.max_results ?? 20,
    );
    const maxResults = Number.isFinite(maxResultsRaw)
      ? Math.max(1, Math.min(100, maxResultsRaw))
      : 20;

    const startHistoryId = pickString(payload, [
      "startHistoryId",
      "historyId",
      "cursor",
    ]);
    const labelId = pickString(payload, ["labelId"]);

    if (!startHistoryId) {
      const profile = await gmailApiRequest(config, "GET", "/profile");
      return {
        listening: true,
        mode: "poll_history",
        startHistoryId: pickString(profile, ["historyId"]),
        hint: "Call gmail.listen_email_events again with startHistoryId to fetch mailbox changes.",
      };
    }

    const query = new URLSearchParams({
      startHistoryId,
      maxResults: String(maxResults),
      ...(labelId ? { labelId } : {}),
    });

    let response: JsonRecord;
    try {
      response = await gmailApiRequest(
        config,
        "GET",
        `/history?${query.toString()}`,
      );
    } catch (error) {
      throw withGmailPermissionGuidance(error, "listen_email_events");
    }

    const history = parseBodyAsList(response.history).map((entry) => {
      const record = parseBodyAsRecord(entry);
      const messagesAdded = parseBodyAsList(record.messagesAdded).map(
        (added) => {
          const message = parseBodyAsRecord(parseBodyAsRecord(added).message);
          return {
            id: pickString(message, ["id"]),
            threadId: pickString(message, ["threadId"]),
          };
        },
      );

      return {
        id: pickString(record, ["id"]),
        messagesAdded,
      };
    });

    return {
      listening: true,
      mode: "poll_history",
      history,
      nextHistoryId: pickString(response, ["historyId"]),
      historyCount: history.length,
    };
  },

  "gmail.createDraft": async (params) => {
    const payload = params as JsonRecord;
    const config = await getGmailConfig(payload);
    const to = pickString(payload, ["to", "recipient", "email"]);
    const subject =
      pickString(payload, ["subject", "title"]) || "Draft from NexusMCP";
    const body = pickString(payload, ["body", "text", "message"]) || "";
    const html = pickString(payload, ["html"]);

    if (!to) {
      throw new Error("gmail.create_draft requires recipient email (to).");
    }

    const raw = buildGmailRawMessage({
      to,
      subject,
      ...(html ? { html } : { text: body }),
    });

    let response: JsonRecord;
    try {
      response = await gmailApiRequest(config, "POST", "/drafts", {
        message: {
          raw,
        },
      });
    } catch (error) {
      throw withGmailPermissionGuidance(error, "create_draft");
    }

    const draft = parseBodyAsRecord(response);
    const draftMessage = parseBodyAsRecord(draft.message);

    return {
      id: pickString(draft, ["id"]),
      messageId: pickString(draftMessage, ["id"]),
      threadId: pickString(draftMessage, ["threadId"]),
      to,
      subject,
    };
  },

  // GitHub methods
  "github.createIssue": async (params) => {
    const payload = params as JsonRecord;
    const config = getGitHubConfig(payload);
    const repo = await resolveRepository(payload, config);
    const title = resolveTitle(payload);
    const body = resolveDescription(payload);

    const labels = parseBodyAsList(payload.labels).filter(
      (item): item is string =>
        typeof item === "string" && item.trim().length > 0,
    );

    const issue = await githubRequestOrThrow(
      config,
      "POST",
      `/repos/${repo}/issues`,
      {
        title,
        body,
        ...(labels.length > 0 ? { labels } : {}),
      },
    );

    const issueNumber = issue.number;
    const htmlUrl = issue.html_url;

    dataStore.addLog({
      level: "info",
      service: "github",
      action: "create_issue",
      message: `Created GitHub issue #${String(issueNumber)} in ${repo}`,
      details: { repo, issueNumber, title },
    });

    return {
      number: issueNumber,
      url: htmlUrl,
      title,
    };
  },

  "github.createBranch": async (params) => {
    const payload = params as JsonRecord;
    const config = getGitHubConfig(payload);
    const repo = await resolveRepository(payload, config);
    const branch = resolveBranchName(payload);
    const base = resolveBaseBranch(payload);

    const baseRef = await githubRequestOrThrow(
      config,
      "GET",
      `/repos/${repo}/git/ref/heads/${encodeURIComponent(base)}`,
    );

    const baseRefObject = parseBodyAsRecord(baseRef.object);
    const baseSha = pickString(baseRefObject, ["sha"]);
    if (!baseSha) {
      throw new Error(`Unable to resolve base branch SHA for ${repo}:${base}`);
    }

    const createRefResult = await githubRequest(
      config,
      "POST",
      `/repos/${repo}/git/refs`,
      {
        ref: `refs/heads/${branch}`,
        sha: baseSha,
      },
    );

    if (createRefResult.status === 422) {
      const detail = normalizeErrorDetail(
        createRefResult.payload,
        "Branch creation conflict",
      );

      if (/reference already exists/i.test(detail)) {
        const existingRef = await githubRequestOrThrow(
          config,
          "GET",
          `/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`,
        );

        dataStore.addLog({
          level: "info",
          service: "github",
          action: "create_branch",
          message: `Branch ${branch} already exists in ${repo}`,
          details: { repo, branch, base, existed: true },
        });

        return {
          branch,
          branch_name: branch,
          base,
          repo,
          existed: true,
          url: `https://github.com/${repo}/tree/${branch}`,
          ref: existingRef.ref,
        };
      }

      throw new Error(`GitHub create branch failed: ${detail}`);
    }

    if (createRefResult.status < 200 || createRefResult.status >= 300) {
      throw new Error(
        `GitHub create branch failed (${createRefResult.status}): ${normalizeErrorDetail(
          createRefResult.payload,
          "Unknown GitHub error",
        )}`,
      );
    }

    const createdRef = parseBodyAsRecord(createRefResult.payload);

    dataStore.addLog({
      level: "info",
      service: "github",
      action: "create_branch",
      message: `Created branch ${branch} in ${repo} from ${base}`,
      details: { repo, branch, base },
    });

    return {
      branch,
      branch_name: branch,
      base,
      repo,
      existed: false,
      url: `https://github.com/${repo}/tree/${branch}`,
      ref: createdRef.ref,
    };
  },

  "github.createOrUpdateFile": async (params) => {
    const payload = params as JsonRecord;
    const config = getGitHubConfig(payload);
    const repo = await resolveRepository(payload, config);
    const branch = resolveBranchName(payload);
    const path = resolveFilePath(payload);
    const content = resolveFileContent(payload);
    const message = resolveCommitMessage(payload);
    const encodedPath = encodeURIComponent(path).replace(/%2F/g, "/");

    let existingSha: string | undefined;
    const existingResult = await githubRequest(
      config,
      "GET",
      `/repos/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`,
    );

    if (existingResult.status === 200) {
      const existingPayload = parseBodyAsRecord(existingResult.payload);
      existingSha = pickString(existingPayload, ["sha"]);
    } else if (existingResult.status !== 404) {
      throw new Error(
        `GitHub read file failed (${existingResult.status}): ${normalizeErrorDetail(
          existingResult.payload,
          "Unknown GitHub error",
        )}`,
      );
    }

    const updatePayload: JsonRecord = {
      message,
      content: Buffer.from(content, "utf8").toString("base64"),
      branch,
    };

    if (existingSha) {
      updatePayload.sha = existingSha;
    }

    const writeResult = await githubRequest(
      config,
      "PUT",
      `/repos/${repo}/contents/${encodedPath}`,
      updatePayload,
    );

    if (writeResult.status < 200 || writeResult.status >= 300) {
      throw new Error(
        `GitHub create/update file failed (${writeResult.status}): ${normalizeErrorDetail(
          writeResult.payload,
          "Unknown GitHub error",
        )}`,
      );
    }

    const writePayload = parseBodyAsRecord(writeResult.payload);
    const commit = parseBodyAsRecord(writePayload.commit);
    const fileContent = parseBodyAsRecord(writePayload.content);
    const action = existingSha ? "updated" : "created";

    dataStore.addLog({
      level: "info",
      service: "github",
      action: "create_or_update_file",
      message: `${action === "updated" ? "Updated" : "Created"} ${path} in ${repo}@${branch}`,
      details: {
        repo,
        branch,
        path,
        action,
        commitSha: commit.sha,
      },
    });

    return {
      repo,
      branch,
      path,
      action,
      message,
      sha: fileContent.sha,
      commitSha: commit.sha,
      url:
        fileContent.html_url ||
        `https://github.com/${repo}/blob/${branch}/${path}`,
    };
  },

  "github.createPullRequest": async (params) => {
    const payload = params as JsonRecord;
    const config = getGitHubConfig(payload);
    const repo = await resolveRepository(payload, config);
    const head = resolveBranchName(payload);
    const base = resolveBaseBranch(payload);

    const title =
      pickString(payload, ["title"]) ||
      `Automated PR for ${resolveOptionalIssueKey(payload) || "workflow"}`;
    const body = resolveDescription(payload);

    const createPullRequest = async (headBranch: string) =>
      githubRequest(config, "POST", `/repos/${repo}/pulls`, {
        title,
        head: headBranch,
        base,
        ...(body ? { body } : {}),
      });

    const initialPullResult = await createPullRequest(head);

    if (initialPullResult.status >= 200 && initialPullResult.status < 300) {
      const pull = parseBodyAsRecord(initialPullResult.payload);

      dataStore.addLog({
        level: "info",
        service: "github",
        action: "create_pr",
        message: `Created PR #${String(pull.number)} in ${repo}: ${head} -> ${base}`,
        details: { repo, title, head, base, number: pull.number },
      });

      return {
        number: pull.number,
        url: pull.html_url,
        title,
        head,
        base,
      };
    }

    if (initialPullResult.status !== 422) {
      throw new Error(
        `GitHub create pull request failed (${initialPullResult.status}): ${normalizeErrorDetail(
          initialPullResult.payload,
          "Unknown GitHub error",
        )}`,
      );
    }

    const retryBranch = buildRetryBranchName(payload);

    await handlers["github.createBranch"]({
      ...payload,
      repo,
      branch: retryBranch,
      branch_name: retryBranch,
      base,
      base_branch: base,
    });

    await handlers["github.createOrUpdateFile"]({
      ...payload,
      repo,
      branch: retryBranch,
      branch_name: retryBranch,
      path: resolveFilePath(payload),
      content: resolveFileContent(payload),
      message: resolveCommitMessage(payload),
    });

    const retryPullResult = await createPullRequest(retryBranch);

    if (retryPullResult.status < 200 || retryPullResult.status >= 300) {
      throw new Error(
        `GitHub create pull request failed after retry (${retryPullResult.status}): ${normalizeErrorDetail(
          retryPullResult.payload,
          "Unknown GitHub error",
        )}`,
      );
    }

    const pull = parseBodyAsRecord(retryPullResult.payload);

    dataStore.addLog({
      level: "info",
      service: "github",
      action: "create_pr",
      message: `Created PR #${String(pull.number)} in ${repo}: ${retryBranch} -> ${base} (retry after 422)`,
      details: {
        repo,
        title,
        head: retryBranch,
        base,
        number: pull.number,
        retriedAfter422: true,
      },
    });

    return {
      number: pull.number,
      url: pull.html_url,
      title,
      head: retryBranch,
      base,
      retriedAfter422: true,
    };
  },

  "github.getRepository": async (params) => {
    const payload = params as JsonRecord;
    const config = getGitHubConfig(payload);
    const repo = await resolveRepository(payload, config);

    const repository = await githubRequestOrThrow(
      config,
      "GET",
      `/repos/${repo}`,
    );

    return {
      name: repository.name,
      full_name: repository.full_name,
      default_branch: repository.default_branch,
      open_issues_count: repository.open_issues_count,
      stargazers_count: repository.stargazers_count,
      html_url: repository.html_url,
    };
  },

  "github.listRepositories": async (params) => {
    const payload = params as JsonRecord;
    const config = getGitHubConfig(payload);
    const limitRaw = Number(payload.limit ?? payload.maxResults ?? 20);
    const limit = Number.isFinite(limitRaw)
      ? Math.max(1, Math.min(100, Math.floor(limitRaw)))
      : 20;

    const reposResponse = await githubRequestOrThrow(
      config,
      "GET",
      `/user/repos?per_page=${limit}&sort=updated&direction=desc`,
    );

    const repos = parseBodyAsList(reposResponse).map((entry) => {
      const item = parseBodyAsRecord(entry);
      return {
        id: item.id,
        name: pickString(item, ["name"]),
        full_name: pickString(item, ["full_name"]),
        private: Boolean(item.private),
        default_branch: pickString(item, ["default_branch"]),
        html_url: pickString(item, ["html_url"]),
      };
    });

    return {
      repositories: repos,
      count: repos.length,
    };
  },

  "github.checkConnection": async (params) => {
    const payload = params as JsonRecord;

    try {
      const config = getGitHubConfig(payload);
      const user = await githubRequestOrThrow(config, "GET", "/user");

      return {
        available: true,
        base_url: config.baseUrl,
        account: {
          login: pickString(user, ["login"]),
          id: user.id,
          name: pickString(user, ["name"]),
        },
        checked_at: new Date().toISOString(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        available: false,
        error: message,
        checked_at: new Date().toISOString(),
      };
    }
  },

  "github.getBranch": async (params) => {
    const payload = params as JsonRecord;
    const config = getGitHubConfig(payload);
    const repo = await resolveRepository(payload, config);
    const branch = resolveRequiredBranchName(payload);

    const branchInfo = await githubRequestOrThrow(
      config,
      "GET",
      `/repos/${repo}/branches/${encodeURIComponent(branch)}`,
    );

    const commit = parseBodyAsRecord(branchInfo.commit);

    return {
      repo,
      name: pickString(branchInfo, ["name"]) || branch,
      protected: Boolean(branchInfo.protected),
      sha: pickString(commit, ["sha"]),
      url: `https://github.com/${repo}/tree/${branch}`,
    };
  },

  "github.deleteBranch": async (params) => {
    const payload = params as JsonRecord;
    const config = getGitHubConfig(payload);
    const repo = await resolveRepository(payload, config);
    const branch = resolveRequiredBranchName(payload);

    const result = await githubRequest(
      config,
      "DELETE",
      `/repos/${repo}/git/refs/heads/${encodeURIComponent(branch)}`,
    );

    if (result.status === 404) {
      return {
        repo,
        branch,
        deleted: false,
        existed: false,
      };
    }

    if (result.status < 200 || result.status >= 300) {
      throw new Error(
        `GitHub delete branch failed (${result.status}): ${normalizeErrorDetail(
          result.payload,
          "Unknown GitHub error",
        )}`,
      );
    }

    dataStore.addLog({
      level: "info",
      service: "github",
      action: "delete_branch",
      message: `Deleted branch ${branch} in ${repo}`,
      details: { repo, branch },
    });

    return {
      repo,
      branch,
      deleted: true,
      existed: true,
    };
  },

  "github.mergePullRequest": async (params) => {
    const payload = params as JsonRecord;
    const config = getGitHubConfig(payload);
    const repo = await resolveRepository(payload, config);
    const pullNumber = resolvePullRequestNumber(payload);
    const commitTitle = pickString(payload, ["commit_title", "commitTitle"]);
    const commitMessage = pickString(payload, [
      "commit_message",
      "commitMessage",
      "message",
    ]);
    const methodRaw =
      pickString(payload, ["merge_method", "mergeMethod", "method"]) ||
      "squash";
    const mergeMethod = ["merge", "squash", "rebase"].includes(methodRaw)
      ? methodRaw
      : "squash";

    const mergeResult = await githubRequest(
      config,
      "PUT",
      `/repos/${repo}/pulls/${pullNumber}/merge`,
      {
        ...(commitTitle ? { commit_title: commitTitle } : {}),
        ...(commitMessage ? { commit_message: commitMessage } : {}),
        merge_method: mergeMethod,
      },
    );

    if (mergeResult.status < 200 || mergeResult.status >= 300) {
      throw new Error(
        `GitHub merge pull request failed (${mergeResult.status}): ${normalizeErrorDetail(
          mergeResult.payload,
          "Unknown GitHub error",
        )}`,
      );
    }

    const mergePayload = parseBodyAsRecord(mergeResult.payload);

    dataStore.addLog({
      level: "info",
      service: "github",
      action: "merge_pull_request",
      message: `Merged PR #${pullNumber} in ${repo}`,
      details: { repo, pullNumber, mergeMethod },
    });

    return {
      repo,
      pull_number: pullNumber,
      merged: Boolean(mergePayload.merged),
      message: pickString(mergePayload, ["message"]),
      sha: pickString(mergePayload, ["sha"]),
      merge_method: mergeMethod,
    };
  },

  "github.triggerWorkflow": async (params) => {
    const payload = params as JsonRecord;
    const config = getGitHubConfig(payload);
    const repo = await resolveRepository(payload, config);
    const workflowId = resolveWorkflowIdentifier(payload);
    const ref =
      pickString(payload, ["ref", "branch", "branch_name", "head"]) ||
      resolveBaseBranch(payload);
    const inputs = asRecord(payload.inputs);

    const dispatchResult = await githubRequest(
      config,
      "POST",
      `/repos/${repo}/actions/workflows/${encodeURIComponent(workflowId)}/dispatches`,
      {
        ref,
        ...(Object.keys(inputs).length > 0 ? { inputs } : {}),
      },
    );

    if (
      dispatchResult.status !== 204 &&
      (dispatchResult.status < 200 || dispatchResult.status >= 300)
    ) {
      throw new Error(
        `GitHub trigger workflow failed (${dispatchResult.status}): ${normalizeErrorDetail(
          dispatchResult.payload,
          "Unknown GitHub error",
        )}`,
      );
    }

    dataStore.addLog({
      level: "info",
      service: "github",
      action: "trigger_workflow",
      message: `Triggered workflow ${workflowId} on ${repo}@${ref}`,
      details: { repo, workflowId, ref },
    });

    return {
      accepted: true,
      repo,
      workflow_id: workflowId,
      ref,
    };
  },

  "github.getWorkflowStatus": async (params) => {
    const payload = params as JsonRecord;
    const config = getGitHubConfig(payload);
    const repo = await resolveRepository(payload, config);
    const runId = resolveNumericParam(payload, [
      "run_id",
      "runId",
      "workflow_run_id",
      "workflowRunId",
    ]);

    if (runId) {
      const run = await githubRequestOrThrow(
        config,
        "GET",
        `/repos/${repo}/actions/runs/${runId}`,
      );

      return {
        repo,
        run_id: run.id,
        name: run.name,
        workflow_id: run.workflow_id,
        status: run.status,
        conclusion: run.conclusion,
        event: run.event,
        head_branch: run.head_branch,
        html_url: run.html_url,
      };
    }

    const workflowId = pickString(payload, [
      "workflow_id",
      "workflowId",
      "workflow",
      "workflow_name",
      "workflowName",
    ]);
    const branch = pickString(payload, ["branch", "branch_name", "ref"]);
    const event = pickString(payload, ["event"]);
    const limitRaw = Number(payload.limit ?? payload.maxResults ?? 10);
    const limit = Number.isFinite(limitRaw)
      ? Math.max(1, Math.min(50, Math.floor(limitRaw)))
      : 10;

    const query = new URLSearchParams({
      per_page: String(limit),
      ...(branch ? { branch } : {}),
      ...(event ? { event } : {}),
    }).toString();

    const runsPath = workflowId
      ? `/repos/${repo}/actions/workflows/${encodeURIComponent(workflowId)}/runs?${query}`
      : `/repos/${repo}/actions/runs?${query}`;

    const runsPayload = await githubRequestOrThrow(config, "GET", runsPath);
    const runs = parseBodyAsList(runsPayload.workflow_runs).map((entry) => {
      const run = parseBodyAsRecord(entry);
      return {
        run_id: run.id,
        name: run.name,
        workflow_id: run.workflow_id,
        status: run.status,
        conclusion: run.conclusion,
        event: run.event,
        head_branch: run.head_branch,
        created_at: run.created_at,
        updated_at: run.updated_at,
        html_url: run.html_url,
      };
    });

    return {
      repo,
      workflow_id: workflowId,
      total_count:
        typeof runsPayload.total_count === "number"
          ? runsPayload.total_count
          : runs.length,
      latest: runs[0] || null,
      runs,
    };
  },

  "github.listenRepoEvents": async (params) => {
    const payload = params as JsonRecord;
    const config = getGitHubConfig(payload);
    const repo = await resolveRepository(payload, config);
    const limitRaw = Number(payload.limit ?? payload.maxResults ?? 30);
    const limit = Number.isFinite(limitRaw)
      ? Math.max(1, Math.min(100, Math.floor(limitRaw)))
      : 30;

    const requestedTypes = new Set(
      parseBodyAsList(payload.event_types ?? payload.events ?? payload.types)
        .map((entry) => String(entry).trim().toLowerCase())
        .filter(Boolean),
    );

    if (requestedTypes.size === 0) {
      requestedTypes.add("push");
      requestedTypes.add("pull_request");
      requestedTypes.add("issue");
    }

    const eventsPayload = await githubRequestOrThrow(
      config,
      "GET",
      `/repos/${repo}/events?per_page=${limit}`,
    );

    const eventTypeMap: Record<
      string,
      "push" | "pull_request" | "issue" | "other"
    > = {
      PushEvent: "push",
      PullRequestEvent: "pull_request",
      IssuesEvent: "issue",
    };

    const events = parseBodyAsList(eventsPayload).map((entry) => {
      const event = parseBodyAsRecord(entry);
      const actor = parseBodyAsRecord(event.actor);
      const payloadData = parseBodyAsRecord(event.payload);
      const simpleType = eventTypeMap[String(event.type)] || "other";

      return {
        id: event.id,
        type: simpleType,
        github_type: event.type,
        action: pickString(payloadData, ["action"]),
        actor: {
          login: pickString(actor, ["login"]),
          id: actor.id,
        },
        created_at: event.created_at,
        ref: pickString(payloadData, ["ref"]),
        head: pickString(payloadData, ["head"]),
      };
    });

    const filtered = events.filter((event) => requestedTypes.has(event.type));

    return {
      repo,
      mode: "polling",
      events: filtered,
      count: filtered.length,
      latest_event_at: filtered[0]?.created_at || null,
      note: "GitHub events are retrieved via polling endpoint. Use webhooks for real-time push delivery.",
    };
  },

  // PostgreSQL methods (mocked for now)
  "postgres.query": async (params) => {
    await simulateDelay(50, 200);
    const { query } = params as { query: string; params?: unknown[] };

    const mockRows = Array.from(
      { length: Math.floor(Math.random() * 10) + 1 },
      (_, i) => ({
        id: i + 1,
        name: `Record ${i + 1}`,
        created_at: new Date(Date.now() - i * 86400000).toISOString(),
      }),
    );

    dataStore.addLog({
      level: "info",
      service: "postgres",
      action: "execute_query",
      message: `Executed query: ${query.substring(0, 50)}...`,
      details: { rowCount: mockRows.length },
    });

    return { rows: mockRows, rowCount: mockRows.length };
  },

  "postgres.insert": async (params) => {
    await simulateDelay(50, 150);
    const { table } = params as {
      table: string;
      data: Record<string, unknown>;
    };

    const id = uuidv4();

    dataStore.addLog({
      level: "info",
      service: "postgres",
      action: "insert_record",
      message: `Inserted record into ${table}`,
      details: { table, id },
    });

    return { id, success: true };
  },
};

function simulateDelay(min: number, max: number): Promise<void> {
  const delay = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise((resolve) => setTimeout(resolve, delay));
}

export async function processMCPRequest(
  request: MCPRequest,
): Promise<MCPResponse> {
  const { id, method, params = {} } = request;

  const normalizedMethod = METHOD_ALIASES[method] || method;
  const handler = handlers[normalizedMethod];

  if (!handler) {
    const error: MCPError = {
      code: -32601,
      message: `Method not found: ${method}`,
    };
    return { jsonrpc: "2.0", id, error };
  }

  try {
    const result = await handler(params);
    return { jsonrpc: "2.0", id, result };
  } catch (err) {
    const error: MCPError = {
      code: -32000,
      message: err instanceof Error ? err.message : "Unknown error",
    };
    return { jsonrpc: "2.0", id, error };
  }
}

export async function executeNode(
  node: DAGNode,
): Promise<{ result: unknown; error?: string }> {
  const methodMap: Record<string, Record<string, string>> = {
    jira: {
      "create-issue": "jira.createIssue",
      "get-issue": "jira.getIssue",
      "get-issues": "jira.getIssues",
      "update-issue": "jira.updateIssue",
      "add-comment": "jira.addComment",
    },
    slack: {
      "send-message": "slack.sendMessage",
      send_message: "slack.sendMessage",
      "on-message": "slack.sendMessage",
      "get-channels": "slack.getChannels",
      get_channels: "slack.getChannels",
      "get-channel": "slack.getChannel",
      get_channel: "slack.getChannel",
      "send-dm": "slack.sendDirectMessage",
      send_dm: "slack.sendDirectMessage",
      "update-message": "slack.updateMessage",
      update_message: "slack.updateMessage",
      "reply-in-thread": "slack.replyInThread",
      reply_in_thread: "slack.replyInThread",
      "get-thread-messages": "slack.getThreadMessages",
      get_thread_messages: "slack.getThreadMessages",
      "get-user": "slack.getUser",
      get_user: "slack.getUser",
      "listen-slack-events": "slack.listenSlackEvents",
      listen_slack_events: "slack.listenSlackEvents",
      "handle-interactions": "slack.handleInteractions",
      handle_interactions: "slack.handleInteractions",
      "delete-message": "slack.deleteMessage",
      delete_message: "slack.deleteMessage",
      "create-channel": "slack.createChannel",
    },
    github: {
      "create-branch": "github.createBranch",
      "get-branch": "github.getBranch",
      "delete-branch": "github.deleteBranch",
      "create-file": "github.createOrUpdateFile",
      "update-file": "github.createOrUpdateFile",
      "commit-file": "github.createOrUpdateFile",
      "create-issue": "github.createIssue",
      "create-pr": "github.createPullRequest",
      "merge-pr": "github.mergePullRequest",
      "trigger-workflow": "github.triggerWorkflow",
      "get-workflow-status": "github.getWorkflowStatus",
      "listen-repo-events": "github.listenRepoEvents",
      "check-connection": "github.checkConnection",
      "list-repositories": "github.listRepositories",
      "on-push": "github.getRepository",
      "get-repo": "github.getRepository",
    },
    google_sheets: {
      "read-sheet": "sheets.readRange",
      "read-range": "sheets.readRange",
      "get-rows": "sheets.getRows",
      "append-row": "sheets.appendRow",
      "add-row": "sheets.addRow",
      "update-cells": "sheets.updateCells",
      "update-row": "sheets.updateRow",
      "delete-row": "sheets.deleteRow",
      "query-rows": "sheets.queryRows",
      "list-sheets": "sheets.listSheets",
    },
    sheets: {
      "read-sheet": "sheets.readRange",
      "read-range": "sheets.readRange",
      "get-rows": "sheets.getRows",
      "append-row": "sheets.appendRow",
      "add-row": "sheets.addRow",
      "update-cells": "sheets.updateCells",
      "update-row": "sheets.updateRow",
      "delete-row": "sheets.deleteRow",
      "query-rows": "sheets.queryRows",
      "list-sheets": "sheets.listSheets",
    },
    gmail: {
      "list-messages": "gmail.listMessages",
      "search-emails": "gmail.searchEmails",
      "read-email": "gmail.readEmail",
      "parse-email": "gmail.parseEmail",
      "send-message": "gmail.sendMessage",
      "reply-email": "gmail.replyEmail",
      "add-label": "gmail.addLabel",
      "get-thread": "gmail.getThread",
      "get-attachments": "gmail.getAttachments",
      "listen-email-events": "gmail.listenEmailEvents",
      "create-draft": "gmail.createDraft",
    },
    postgres: {
      query: "postgres.query",
      insert: "postgres.insert",
    },
  };

  const method = methodMap[node.service]?.[node.operation];

  if (!method) {
    return {
      result: null,
      error: `Unknown operation: ${node.service}.${node.operation}`,
    };
  }

  const request: MCPRequest = {
    jsonrpc: "2.0",
    id: node.id,
    method,
    params: node.config,
  };

  const response = await processMCPRequest(request);

  if (response.error) {
    return { result: null, error: response.error.message };
  }

  return { result: response.result };
}

export function getAvailableMethods(): {
  method: string;
  description: string;
}[] {
  return [
    {
      method: "jira.createIssue",
      description: "Create a new Jira issue on Jira Cloud",
    },
    {
      method: "jira.getIssue",
      description: "Fetch Jira issue details by key",
    },
    {
      method: "jira.getIssues",
      description: "Search Jira issues using JQL",
    },
    {
      method: "jira.updateIssue",
      description: "Update Jira issue fields",
    },
    {
      method: "jira.addComment",
      description: "Add a comment to a Jira issue",
    },
    {
      method: "github.createBranch",
      description: "Create a branch in a GitHub repository",
    },
    {
      method: "github.getBranch",
      description: "Get branch details from a GitHub repository",
    },
    {
      method: "github.deleteBranch",
      description: "Delete a branch in a GitHub repository",
    },
    {
      method: "github.createOrUpdateFile",
      description:
        "Create or update a file in a GitHub branch (creates a commit)",
    },
    { method: "github.createIssue", description: "Create a GitHub issue" },
    {
      method: "github.createPullRequest",
      description: "Create a GitHub pull request",
    },
    {
      method: "github.mergePullRequest",
      description: "Merge a GitHub pull request",
    },
    {
      method: "github.triggerWorkflow",
      description: "Trigger a GitHub Actions workflow dispatch",
    },
    {
      method: "github.getWorkflowStatus",
      description: "Get GitHub Actions workflow run status",
    },
    {
      method: "github.listenRepoEvents",
      description: "Poll GitHub repository events (push, PR, issues)",
    },
    {
      method: "github.listRepositories",
      description: "List repositories available to the GitHub token",
    },
    {
      method: "github.checkConnection",
      description: "Check GitHub connection availability and token validity",
    },
    {
      method: "github.getRepository",
      description: "Get GitHub repository information",
    },
    {
      method: "slack.sendMessage",
      description: "Send a message to a Slack channel",
    },
    {
      method: "slack.getChannels",
      description: "List available Slack channels",
    },
    {
      method: "slack.getChannel",
      description: "Get Slack channel details by ID or name",
    },
    {
      method: "slack.sendDirectMessage",
      description: "Send a Slack direct message",
    },
    {
      method: "slack.getUser",
      description: "Get Slack user info by id, email, or name",
    },
    {
      method: "slack.replyInThread",
      description: "Reply to an existing Slack thread",
    },
    {
      method: "slack.getThreadMessages",
      description: "List messages in a Slack thread",
    },
    {
      method: "slack.listenSlackEvents",
      description: "Normalize Slack Events API and slash-command payloads",
    },
    {
      method: "slack.handleInteractions",
      description: "Handle Slack button/action interactions and approvals",
    },
    {
      method: "slack.postThreadReply",
      description: "Post a reply in a Slack thread",
    },
    {
      method: "slack.updateMessage",
      description: "Update a Slack message",
    },
    {
      method: "slack.deleteMessage",
      description: "Delete a Slack message",
    },
    {
      method: "slack.createChannel",
      description: "Create a Slack channel",
    },
    {
      method: "slack.archiveChannel",
      description: "Archive a Slack channel",
    },
    {
      method: "slack.inviteToChannel",
      description: "Invite users to a Slack channel",
    },
    {
      method: "slack.setChannelTopic",
      description: "Set Slack channel topic",
    },
    {
      method: "slack.getUserByEmail",
      description: "Find Slack user by email",
    },
    {
      method: "slack.getUserStatus",
      description: "Get Slack user presence and DND status",
    },
    {
      method: "slack.listTeamMembers",
      description: "List Slack workspace members",
    },
    {
      method: "slack.sendInteractiveMessage",
      description: "Send Slack message with interactive blocks",
    },
    {
      method: "slack.scheduleMessage",
      description: "Schedule a Slack message",
    },
    {
      method: "slack.createPoll",
      description: "Create a poll-style Slack message",
    },
    {
      method: "slack.waitForUserResponse",
      description: "Wait for a reply in Slack thread",
    },
    {
      method: "sheets.readRange",
      description: "Read values from Google Sheets range",
    },
    {
      method: "sheets.getRows",
      description: "Get structured rows from Google Sheets",
    },
    {
      method: "sheets.appendRow",
      description: "Append row(s) to Google Sheets",
    },
    {
      method: "sheets.addRow",
      description: "Add a row to Google Sheets",
    },
    {
      method: "sheets.updateCells",
      description: "Update Google Sheets cells",
    },
    {
      method: "sheets.updateRow",
      description: "Update a specific Google Sheets row",
    },
    {
      method: "sheets.deleteRow",
      description: "Delete a row from Google Sheets",
    },
    {
      method: "sheets.queryRows",
      description: "Query/filter rows from Google Sheets",
    },
    {
      method: "sheets.listSheets",
      description: "List tabs in a Google spreadsheet",
    },
    {
      method: "gmail.listMessages",
      description: "List Gmail messages",
    },
    {
      method: "gmail.searchEmails",
      description: "Search Gmail messages using Gmail query filters",
    },
    {
      method: "gmail.readEmail",
      description: "Read a Gmail message by ID",
    },
    {
      method: "gmail.parseEmail",
      description: "Parse a Gmail message into structured fields",
    },
    {
      method: "gmail.sendMessage",
      description: "Send an email through Gmail API",
    },
    {
      method: "gmail.replyEmail",
      description: "Reply to an existing Gmail thread or message",
    },
    {
      method: "gmail.addLabel",
      description: "Add or remove labels on a Gmail message",
    },
    {
      method: "gmail.getThread",
      description: "Get a Gmail thread and its message summaries",
    },
    {
      method: "gmail.getAttachments",
      description: "List or download Gmail message attachments",
    },
    {
      method: "gmail.listenEmailEvents",
      description: "Poll Gmail history API for new mailbox events",
    },
    {
      method: "gmail.createDraft",
      description: "Create a draft in Gmail",
    },
    { method: "postgres.query", description: "Execute a SQL query" },
    { method: "postgres.insert", description: "Insert a database record" },
  ];
}

export function getRegisteredGateways(): GatewayRegistration[] {
  return Object.values(registeredGateways);
}
