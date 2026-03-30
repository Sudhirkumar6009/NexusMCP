import { v4 as uuidv4 } from "uuid";
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
  "github.create_issue": "github.createIssue",
  github_create_issue: "github.createIssue",
  "github.get_repository": "github.getRepository",
  github_get_repository: "github.getRepository",
  "github.create_pr": "github.createPullRequest",
  github_create_pr: "github.createPullRequest",
  "github.create_pull_request": "github.createPullRequest",
  github_create_pull_request: "github.createPullRequest",
  "github.create_branch": "github.createBranch",
  github_create_branch: "github.createBranch",
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

function parseIssueKeyFromPrompt(prompt: string): string | undefined {
  const match = prompt.match(/\b([A-Z][A-Z0-9]+-\d+)\b/);
  return match?.[1];
}

function parseRepoFromPrompt(prompt: string): string | undefined {
  const match = prompt.match(
    /(?:repo|repository)\s+([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+|[A-Za-z0-9_.-]+)/i,
  );
  return match?.[1];
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
  
  return false;
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

function getConnectedIntegration(service: "jira" | "github"): Integration {
  const integrationId = service === "jira" ? "int-jira" : "int-github";
  const integration = dataStore.getIntegration(integrationId);

  if (!integration || integration.status !== "connected") {
    throw new Error(
      `${service === "jira" ? "Jira" : "GitHub"} integration is not connected. Connect it from Integrations before running execution.`,
    );
  }

  return integration;
}

// New: Check if integration is connected without throwing
function isIntegrationConnected(service: "jira" | "github" | "slack" | "sheets"): boolean {
  const integrationMap: Record<string, string> = {
    jira: "int-jira",
    github: "int-github",
    slack: "int-slack",
    sheets: "int-google_sheets",
  };
  
  const integrationId = integrationMap[service];
  if (!integrationId) return false;
  
  const integration = dataStore.getIntegration(integrationId);
  return integration?.status === "connected";
}

// New: Get list of all connected integrations
function getConnectedServices(): string[] {
  const services = ["jira", "github", "slack", "sheets"] as const;
  return services.filter((svc) => isIntegrationConnected(svc));
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

  throw new Error("Issue key is required (for example ABC-123).");
}

function resolveRepository(params: JsonRecord): string {
  const candidate = pickString(params, ["repo", "repository", "repo_name"]);
  const prompt = pickString(params, ["prompt", "input"]) || "";

  let repo = !isPlaceholderValue(candidate) ? candidate : undefined;
  if (!repo) {
    repo = parseRepoFromPrompt(prompt);
  }

  if (!repo || isPlaceholderValue(repo)) {
    throw new Error(
      "Repository is required. Provide owner/repo in tool arguments or mention 'repo owner/name' in prompt.",
    );
  }

  repo = repo.replace(/^\/+|\/+$/g, "");

  if (!repo.includes("/")) {
    const owner =
      pickString(params, ["owner"]) ||
      (typeof process.env.GITHUB_DEFAULT_OWNER === "string"
        ? process.env.GITHUB_DEFAULT_OWNER.trim()
        : "");

    if (!owner) {
      throw new Error(
        "Repository must be owner/repo. Set GITHUB_DEFAULT_OWNER to use short repo names.",
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
  },

  "jira.getIssues": async (params) => {
    const payload = params as JsonRecord;
    const config = getJiraConfig(payload);
    const jql = pickString(payload, ["jql"]) || "order by created DESC";
    const maxResults = Number(payload.maxResults ?? payload.max_results ?? 10);

    const query = new URLSearchParams({
      jql,
      maxResults: String(Number.isFinite(maxResults) ? maxResults : 10),
    }).toString();

    const searchResult = await jiraRequest(
      config,
      "GET",
      `/rest/api/3/search?${query}`,
    );

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

    if (Object.keys(fields).length === 0) {
      throw new Error("Jira update requires a non-empty fields object.");
    }

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
      details: { issueKey, updatedFields: Object.keys(fields) },
    });

    return {
      success: true,
      issueKey,
    };
  },

  // Slack methods (mocked for now)
  "slack.sendMessage": async (params) => {
    await simulateDelay(100, 300);
    const { channel, text } = params as {
      channel: string;
      text: string;
      blocks?: unknown[];
    };

    const ts = `${Date.now()}.${Math.floor(Math.random() * 1000000)}`;

    dataStore.addLog({
      level: "info",
      service: "slack",
      action: "send_message",
      message: `Sent message to ${channel}`,
      details: { channel, textPreview: text.substring(0, 50) },
    });

    return { ok: true, ts, channel };
  },

  "slack.getChannels": async () => {
    await simulateDelay(150, 300);

    return {
      channels: [
        { id: "C001", name: "general" },
        { id: "C002", name: "engineering" },
        { id: "C003", name: "bugs" },
        { id: "C004", name: "notifications" },
      ],
    };
  },

  // GitHub methods
  "github.createIssue": async (params) => {
    const payload = params as JsonRecord;
    const config = getGitHubConfig(payload);
    const repo = resolveRepository(payload);
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
    const repo = resolveRepository(payload);
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
      base,
      repo,
      existed: false,
      url: `https://github.com/${repo}/tree/${branch}`,
      ref: createdRef.ref,
    };
  },

  "github.createPullRequest": async (params) => {
    const payload = params as JsonRecord;
    const config = getGitHubConfig(payload);
    const repo = resolveRepository(payload);
    const head = resolveBranchName(payload);
    const base = resolveBaseBranch(payload);

    const title =
      pickString(payload, ["title"]) ||
      `Automated PR for ${resolveOptionalIssueKey(payload) || "workflow"}`;
    const body = resolveDescription(payload);

    const pull = await githubRequestOrThrow(
      config,
      "POST",
      `/repos/${repo}/pulls`,
      {
        title,
        head,
        base,
        ...(body ? { body } : {}),
      },
    );

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
  },

  "github.getRepository": async (params) => {
    const payload = params as JsonRecord;
    const config = getGitHubConfig(payload);
    const repo = resolveRepository(payload);

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
    },
    slack: {
      "send-message": "slack.sendMessage",
      "on-message": "slack.sendMessage",
      "get-channels": "slack.getChannels",
    },
    github: {
      "create-branch": "github.createBranch",
      "create-issue": "github.createIssue",
      "create-pr": "github.createPullRequest",
      "on-push": "github.getRepository",
      "get-repo": "github.getRepository",
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
      method: "github.createBranch",
      description: "Create a branch in a GitHub repository",
    },
    { method: "github.createIssue", description: "Create a GitHub issue" },
    {
      method: "github.createPullRequest",
      description: "Create a GitHub pull request",
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
    { method: "postgres.query", description: "Execute a SQL query" },
    { method: "postgres.insert", description: "Insert a database record" },
  ];
}

export function getRegisteredGateways(): GatewayRegistration[] {
  return Object.values(registeredGateways);
}
