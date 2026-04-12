import { Router } from "express";
import { createSign } from "crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseDotEnv } from "dotenv";
import { dataStore } from "../data/store.js";
import { User, IUser } from "../models/User.js";

const router = Router();

router.use(async (_req, _res, next) => {
  try {
    await dataStore.hydrateSharedIntegrationMemory();
  } catch {
    // Continue with in-memory state when PostgreSQL-backed hydration is unavailable.
  }
  next();
});

const integrationIdAliases: Record<string, string> = {
  jira: "int-jira",
  slack: "int-slack",
  github: "int-github",
  google_sheets: "int-google-sheets",
  gmail: "int-gmail",
};

function resolveIntegrationId(id: string): string {
  return integrationIdAliases[id] || id;
}

function toSafeIntegration<T extends { credentials?: unknown }>(
  integration: T,
): Omit<T, "credentials"> & { credentials?: { configured: true } } {
  return {
    ...integration,
    credentials: integration.credentials ? { configured: true } : undefined,
  };
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

const envFileCandidates = [
  resolve(process.cwd(), "services", ".env"),
  resolve(process.cwd(), "services/.env"),
  resolve(process.cwd(), "..", "services", ".env"),
  resolve(__dirname, "../../../../services/.env"),
];

function loadServicesEnvFile(): Record<string, string> {
  for (const envPath of envFileCandidates) {
    if (!existsSync(envPath)) {
      continue;
    }

    try {
      const raw = readFileSync(envPath, "utf8");
      return parseDotEnv(raw);
    } catch {
      return {};
    }
  }

  return {};
}

function pickEnvValue(
  envFile: Record<string, string>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const envValue = normalizeOptionalString(process.env[key]);
    if (envValue) {
      return envValue;
    }

    const fileValue = normalizeOptionalString(envFile[key]);
    if (fileValue) {
      return fileValue;
    }
  }

  return undefined;
}

function compactCredentials<T extends Record<string, unknown>>(
  values: T,
): Partial<T> {
  const cleaned: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(values)) {
    if (typeof value === "string" && value.trim()) {
      cleaned[key] = value;
    }
  }

  return cleaned as Partial<T>;
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

function looksLikeNexusAuthToken(token: string): boolean {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return false;
  }

  try {
    const payloadText = Buffer.from(parts[1], "base64url").toString("utf8");
    const payload = JSON.parse(payloadText) as Record<string, unknown>;

    return (
      typeof payload.userId === "string" &&
      typeof payload.email === "string" &&
      typeof payload.role === "string"
    );
  } catch {
    return false;
  }
}

function getGoogleOAuthClientCredentials() {
  const clientId =
    process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT || "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || "";

  return {
    clientId,
    clientSecret,
  };
}

async function exchangeGoogleRefreshToken(refreshToken: string) {
  const { clientId, clientSecret } = getGoogleOAuthClientCredentials();

  if (!clientId || !clientSecret) {
    throw new Error(
      "Google OAuth client credentials are not configured on the server",
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

  const tokenText = await tokenResponse.text();
  let tokenPayload: Record<string, unknown> = {};

  try {
    tokenPayload = tokenText
      ? (JSON.parse(tokenText) as Record<string, unknown>)
      : {};
  } catch {
    throw new Error(
      `Google token refresh failed (${tokenResponse.status}): ${tokenText}`,
    );
  }

  if (!tokenResponse.ok) {
    throw new Error(
      `Google token refresh failed (${tokenResponse.status}): ${String(tokenPayload.error_description || tokenPayload.error || tokenResponse.statusText)}`,
    );
  }

  const accessToken = normalizeOptionalString(tokenPayload.access_token);
  if (!accessToken) {
    throw new Error("Google token refresh succeeded but no access_token found");
  }

  return {
    accessToken,
    expiresIn: parseExpiresInSeconds(tokenPayload.expires_in),
  };
}

async function loadUserGoogleOAuthState(
  userId?: string,
): Promise<IUser | null> {
  if (!userId) {
    return null;
  }

  return (await User.findById(userId).select(
    "+googleAccessToken +googleRefreshToken +googleAccessTokenExpiresAt",
  )) as IUser | null;
}

async function persistUserGoogleAccessToken(
  user: IUser,
  accessToken: string,
  expiresInSeconds: number,
) {
  user.googleAccessToken = accessToken;
  user.googleAccessTokenExpiresAt = new Date(
    Date.now() + Math.max(expiresInSeconds - 60, 60) * 1000,
  );
  await user.save();
}

async function validateJiraCredentials(credentials: Record<string, unknown>) {
  const apiKey =
    (typeof credentials.apiKey === "string" && credentials.apiKey.trim()) ||
    process.env.JIRA_API_TOKEN ||
    process.env.JIRA_TOKEN;
  const email =
    (typeof credentials.username === "string" && credentials.username.trim()) ||
    process.env.JIRA_EMAIL;
  const baseUrl =
    (typeof credentials.baseUrl === "string" && credentials.baseUrl.trim()) ||
    process.env.JIRA_BASE_URL ||
    process.env.JIRA_URL;

  if (!apiKey || !email || !baseUrl) {
    throw new Error(
      "Jira credentials are incomplete. Provide apiKey, username, and baseUrl or configure JIRA_API_TOKEN, JIRA_EMAIL, JIRA_BASE_URL in server env.",
    );
  }

  const auth = Buffer.from(`${email}:${apiKey}`).toString("base64");
  const url = `${String(baseUrl).replace(/\/$/, "")}/rest/api/3/myself`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${auth}`,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Jira validation failed (${response.status}): ${body}`);
  }

  const profile = (await response.json()) as Record<string, unknown>;
  return {
    apiKey,
    email,
    baseUrl: String(baseUrl),
    accountId:
      typeof profile.accountId === "string" ? profile.accountId : undefined,
    displayName:
      typeof profile.displayName === "string" ? profile.displayName : undefined,
  };
}

async function validateSlackCredentials(credentials: Record<string, unknown>) {
  const token =
    (typeof credentials.accessToken === "string" &&
      credentials.accessToken.trim()) ||
    (typeof credentials.apiKey === "string" && credentials.apiKey.trim()) ||
    process.env.SLACK_BOT_TOKEN ||
    process.env.SLACK_TOKEN;

  if (!token) {
    throw new Error("Slack token is required");
  }

  const response = await fetch("https://slack.com/api/auth.test", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });

  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok || payload.ok !== true) {
    throw new Error(
      `Slack validation failed: ${String(payload.error || response.statusText)}`,
    );
  }

  return {
    credentials: {
      accessToken: token,
    },
    metadata: {
      team: payload.team,
      user: payload.user,
    },
  };
}

async function validateGitHubCredentials(credentials: Record<string, unknown>) {
  const tokenRaw =
    (typeof credentials.accessToken === "string" &&
      credentials.accessToken.trim()) ||
    (typeof credentials.apiKey === "string" && credentials.apiKey.trim()) ||
    process.env.GITHUB_TOKEN;

  if (!tokenRaw) {
    throw new Error("GitHub token is required");
  }

  const token = tokenRaw.trim();
  const configuredBaseUrl =
    (typeof credentials.baseUrl === "string" && credentials.baseUrl.trim()) ||
    process.env.GITHUB_API_URL ||
    "https://api.github.com";

  const baseUrl = configuredBaseUrl.replace(/\/$/, "").replace(/\/+$/, "");
  const profileUrl = `${baseUrl}/user`;

  const authHeaders = /^(Bearer|token)\s+/i.test(token)
    ? [token]
    : [`Bearer ${token}`, `token ${token}`];

  let lastStatus = 0;
  let lastDetail = "Unknown GitHub error";
  for (const authorizationValue of authHeaders) {
    let response: Response;
    try {
      response = await fetch(profileUrl, {
        headers: {
          Authorization: authorizationValue,
          Accept: "application/vnd.github+json",
          "User-Agent": "NexusMCP",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });
    } catch (error) {
      throw new Error(
        `GitHub validation request failed: ${error instanceof Error ? error.message : "Network error"}`,
      );
    }

    const raw = await response.text();
    let parsedBody: Record<string, unknown> | undefined;
    try {
      parsedBody = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      parsedBody = undefined;
    }

    if (response.ok) {
      const profile = parsedBody || {};
      return {
        credentials: {
          accessToken: token,
          ...(credentials.baseUrl ? { baseUrl } : {}),
        },
        metadata: {
          login: profile.login,
          id: profile.id,
          apiBaseUrl: baseUrl,
        },
      };
    }

    lastStatus = response.status;
    lastDetail =
      (typeof parsedBody?.message === "string" && parsedBody.message) ||
      (typeof parsedBody?.error === "string" && parsedBody.error) ||
      raw ||
      response.statusText;

    // Retry auth style only for auth-related failures.
    if (response.status !== 401 && response.status !== 403) {
      break;
    }
  }

  throw new Error(`GitHub validation failed (${lastStatus}): ${lastDetail}`);
}

async function validateGoogleSheetsCredentials(
  credentials: Record<string, unknown>,
) {
  type GoogleServiceAccountCredentials = {
    client_email: string;
    private_key: string;
    token_uri?: string;
    project_id?: string;
    spreadsheet_id?: string;
  };

  const parseGoogleServiceAccountJson = (
    raw: string,
  ): GoogleServiceAccountCredentials => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("Invalid Google service account JSON file");
    }

    if (!parsed || typeof parsed !== "object") {
      throw new Error("Invalid Google service account JSON format");
    }

    const account = parsed as Record<string, unknown>;
    const clientEmail =
      typeof account.client_email === "string"
        ? account.client_email.trim()
        : "";
    const privateKey =
      typeof account.private_key === "string" ? account.private_key.trim() : "";

    if (!clientEmail || !privateKey) {
      throw new Error(
        "Google service account JSON must include client_email and private_key",
      );
    }

    return {
      client_email: clientEmail,
      private_key: privateKey,
      token_uri:
        typeof account.token_uri === "string" ? account.token_uri : undefined,
      project_id:
        typeof account.project_id === "string" ? account.project_id : undefined,
      spreadsheet_id:
        typeof account.spreadsheet_id === "string"
          ? account.spreadsheet_id
          : undefined,
    };
  };

  const fetchGoogleServiceAccountAccessToken = async (
    account: GoogleServiceAccountCredentials,
  ): Promise<string> => {
    const now = Math.floor(Date.now() / 1000);
    const tokenUri = account.token_uri || "https://oauth2.googleapis.com/token";
    const scope = "https://www.googleapis.com/auth/spreadsheets.readonly";

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

    const tokenPayload = (await tokenResponse.json()) as Record<
      string,
      unknown
    >;

    if (!tokenResponse.ok) {
      throw new Error(
        `Google token exchange failed (${tokenResponse.status}): ${String(tokenPayload.error_description || tokenPayload.error || tokenResponse.statusText)}`,
      );
    }

    const accessToken =
      typeof tokenPayload.access_token === "string"
        ? tokenPayload.access_token
        : "";

    if (!accessToken) {
      throw new Error(
        "Google token exchange succeeded but no access token was returned",
      );
    }

    return accessToken;
  };

  const serviceAccountRaw =
    (typeof credentials.googleServiceAccountJson === "string" &&
      credentials.googleServiceAccountJson.trim()) ||
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  const serviceAccount = serviceAccountRaw
    ? parseGoogleServiceAccountJson(serviceAccountRaw)
    : undefined;

  const spreadsheetId =
    (typeof credentials.spreadsheetId === "string" &&
      credentials.spreadsheetId.trim()) ||
    serviceAccount?.spreadsheet_id ||
    process.env.GOOGLE_SHEETS_SPREADSHEET_ID;

  if (!spreadsheetId) {
    throw new Error("Google Sheets spreadsheetId is required");
  }

  const accessToken =
    (typeof credentials.accessToken === "string" &&
      credentials.accessToken.trim()) ||
    process.env.GOOGLE_ACCESS_TOKEN;

  const apiKey =
    (typeof credentials.apiKey === "string" && credentials.apiKey.trim()) ||
    process.env.GOOGLE_SHEETS_API_KEY;

  let resolvedAccessToken = accessToken;
  if (!resolvedAccessToken && serviceAccount) {
    resolvedAccessToken =
      await fetchGoogleServiceAccountAccessToken(serviceAccount);
  }

  if (!resolvedAccessToken && !apiKey) {
    throw new Error(
      "Google Sheets credentials are required. Upload a Google service account JSON file, or provide access token/API key.",
    );
  }

  const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
    spreadsheetId,
  )}`;
  const url = resolvedAccessToken
    ? `${base}?fields=spreadsheetId`
    : `${base}?fields=spreadsheetId&key=${encodeURIComponent(apiKey as string)}`;

  const response = await fetch(url, {
    headers: resolvedAccessToken
      ? {
          Authorization: `Bearer ${resolvedAccessToken}`,
        }
      : undefined,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Google Sheets validation failed (${response.status}): ${body}`,
    );
  }

  const payload = (await response.json()) as Record<string, unknown>;
  return {
    credentials: {
      ...(accessToken ? { accessToken } : {}),
      ...(apiKey ? { apiKey } : {}),
      ...(serviceAccountRaw
        ? { googleServiceAccountJson: serviceAccountRaw }
        : {}),
      spreadsheetId,
    },
    metadata: {
      spreadsheetId: payload.spreadsheetId || spreadsheetId,
      authMode: serviceAccountRaw
        ? "service_account_json"
        : resolvedAccessToken
          ? "access_token"
          : "api_key",
      projectId: serviceAccount?.project_id,
    },
  };
}

async function validateGmailCredentials(
  credentials: Record<string, unknown>,
  userId?: string,
) {
  let accessToken =
    normalizeOptionalString(credentials.accessToken) ||
    normalizeOptionalString(credentials.apiKey);
  const explicitRefreshToken = normalizeOptionalString(
    credentials.refreshToken,
  );
  const envRefreshToken = normalizeOptionalString(
    process.env.GMAIL_REFRESH_TOKEN,
  );
  const envAccessToken = normalizeOptionalString(
    process.env.GMAIL_ACCESS_TOKEN,
  );

  if (accessToken && looksLikeNexusAuthToken(accessToken)) {
    throw new Error(
      "Detected a Nexus auth JWT (from /auth/callback?token=...) instead of a Google OAuth access token. Use /auth/google/gmail or leave Gmail token blank so the server uses your saved Google OAuth tokens.",
    );
  }

  const oauthUser = await loadUserGoogleOAuthState(userId);
  let refreshToken =
    explicitRefreshToken ||
    normalizeOptionalString(oauthUser?.googleRefreshToken) ||
    envRefreshToken;
  accessToken =
    accessToken ||
    normalizeOptionalString(oauthUser?.googleAccessToken) ||
    envAccessToken;

  const userTokenExpired =
    !!oauthUser?.googleAccessTokenExpiresAt &&
    oauthUser.googleAccessTokenExpiresAt.getTime() <= Date.now();

  if ((!accessToken || userTokenExpired) && refreshToken) {
    const refreshed = await exchangeGoogleRefreshToken(refreshToken);
    accessToken = refreshed.accessToken;

    if (oauthUser) {
      await persistUserGoogleAccessToken(
        oauthUser,
        refreshed.accessToken,
        refreshed.expiresIn,
      );
    }
  }

  if (!accessToken) {
    throw new Error(
      "No Gmail OAuth access token found. Sign in through /auth/google/gmail or provide a valid Google OAuth access token.",
    );
  }

  const fetchTokenInfo = (token: string) =>
    fetch(
      `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`,
    );

  let response = await fetchTokenInfo(accessToken);

  if ((response.status === 400 || response.status === 401) && refreshToken) {
    const refreshed = await exchangeGoogleRefreshToken(refreshToken);
    accessToken = refreshed.accessToken;

    if (oauthUser) {
      await persistUserGoogleAccessToken(
        oauthUser,
        refreshed.accessToken,
        refreshed.expiresIn,
      );
    }

    response = await fetchTokenInfo(accessToken);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Gmail validation failed (${response.status}): ${body}`);
  }

  const tokenInfo = (await response.json()) as Record<string, unknown>;
  const scopeText = normalizeOptionalString(tokenInfo.scope) || "";
  const grantedScopes = scopeText
    .split(/\s+/)
    .map((scope) => scope.trim())
    .filter(Boolean);

  const scopeSet = new Set(grantedScopes);
  const hasSendScope =
    scopeSet.has("https://www.googleapis.com/auth/gmail.send") ||
    scopeSet.has("https://mail.google.com/");

  if (!hasSendScope) {
    throw new Error(
      "Gmail OAuth token is missing gmail.send scope. Re-authorize via /auth/google/gmail and grant Gmail access.",
    );
  }

  return {
    credentials: {
      accessToken,
      ...(refreshToken ? { refreshToken } : {}),
    },
    metadata: {
      emailAddress: normalizeOptionalString(tokenInfo.email),
      grantedScopes,
      validationMode: "tokeninfo",
      tokenAudience:
        normalizeOptionalString(tokenInfo.audience) ||
        normalizeOptionalString(tokenInfo.aud),
      expiresIn: parseExpiresInSeconds(tokenInfo.expires_in),
      authSource: oauthUser ? "user_oauth" : "provided_token",
    },
  };
}

async function validateProvider(
  service: string,
  credentials: Record<string, unknown>,
  options?: {
    userId?: string;
  },
) {
  if (service === "jira") {
    const jira = await validateJiraCredentials(credentials);
    return {
      credentials: {
        apiKey: jira.apiKey,
        username: jira.email,
        baseUrl: jira.baseUrl,
      },
      metadata: {
        accountId: jira.accountId,
        displayName: jira.displayName,
      },
    };
  }

  if (service === "slack") {
    return validateSlackCredentials(credentials);
  }

  if (service === "github") {
    return validateGitHubCredentials(credentials);
  }

  if (service === "google_sheets") {
    return validateGoogleSheetsCredentials(credentials);
  }

  if (service === "gmail") {
    return validateGmailCredentials(credentials, options?.userId);
  }

  throw new Error(`No validator configured for provider: ${service}`);
}

// GET /api/integrations/env-credentials - Read connector credentials from env
router.get("/env-credentials", (_req, res) => {
  const envFile = loadServicesEnvFile();

  const jiraCredentials = compactCredentials({
    apiKey: pickEnvValue(envFile, ["JIRA_API_TOKEN", "JIRA_TOKEN"]),
    username: pickEnvValue(envFile, ["JIRA_EMAIL"]),
    baseUrl: pickEnvValue(envFile, ["JIRA_BASE_URL", "JIRA_URL"]),
  });

  const slackCredentials = compactCredentials({
    accessToken: pickEnvValue(envFile, [
      "SLACK_BOT_TOKEN",
      "SLACK_TOKEN",
      "SLACK_ACCESS_TOKEN",
      "SLACK_REFRESH_TOKEN",
    ]),
  });

  const githubCredentials = compactCredentials({
    accessToken: pickEnvValue(envFile, ["GITHUB_TOKEN"]),
    baseUrl: pickEnvValue(envFile, ["GITHUB_API_URL"]),
  });

  const sheetsCredentials = compactCredentials({
    googleServiceAccountJson: pickEnvValue(envFile, [
      "GOOGLE_SERVICE_ACCOUNT_JSON",
    ]),
    spreadsheetId: pickEnvValue(envFile, [
      "GOOGLE_SHEETS_SPREADSHEET_ID",
      "SPREADSHEET_ID",
    ]),
    accessToken: pickEnvValue(envFile, ["GOOGLE_ACCESS_TOKEN"]),
    apiKey: pickEnvValue(envFile, ["GOOGLE_SHEETS_API_KEY"]),
  });

  const gmailCredentials = compactCredentials({
    accessToken: pickEnvValue(envFile, ["GMAIL_ACCESS_TOKEN"]),
    refreshToken: pickEnvValue(envFile, ["GMAIL_REFRESH_TOKEN"]),
  });

  const envCredentials = {
    jira: jiraCredentials,
    slack: slackCredentials,
    github: githubCredentials,
    google_sheets: sheetsCredentials,
    gmail: gmailCredentials,
  };

  res.json({
    success: true,
    data: envCredentials,
  });
});

// GET /api/integrations - List all integrations
router.get("/", (_req, res) => {
  const integrations = dataStore.getIntegrations();
  const safeIntegrations = integrations.map(toSafeIntegration);

  res.json({
    success: true,
    data: safeIntegrations,
  });
});

// GET /api/integrations/:id - Get a single integration
router.get("/:id", (req, res) => {
  const integration = dataStore.getIntegration(
    resolveIntegrationId(req.params.id),
  );

  if (!integration) {
    return res.status(404).json({
      success: false,
      error: "Integration not found",
    });
  }

  const safeIntegration = toSafeIntegration(integration);

  res.json({
    success: true,
    data: safeIntegration,
  });
});

// POST /api/integrations/:id/connect - Connect an integration
router.post("/:id/connect", async (req, res) => {
  const id = resolveIntegrationId(req.params.id);
  const integration = dataStore.getIntegration(id);

  if (!integration) {
    return res.status(404).json({
      success: false,
      error: "Integration not found",
    });
  }

  try {
    const credentials = (req.body?.credentials ?? {}) as Record<
      string,
      unknown
    >;
    const userId = (req as { userId?: string }).userId;

    const validated = await validateProvider(integration.service, credentials, {
      userId,
    });
    const connected = dataStore.connectIntegration(id, validated.credentials);

    if (!connected) {
      return res.status(404).json({
        success: false,
        error: "Integration not found",
      });
    }

    dataStore.addLog({
      level: "info",
      service: integration.service,
      action: "integration_ping_success",
      message: `${connected.name} ping validation succeeded`,
      details: validated.metadata,
    });

    const safeIntegration = toSafeIntegration(connected);

    res.json({
      success: true,
      data: safeIntegration,
      message: `${connected.name} connected successfully`,
    });
  } catch (error) {
    dataStore.updateIntegration(id, {
      status: "error",
      lastSync: undefined,
    });

    dataStore.addLog({
      level: "error",
      service: integration.service,
      action: "integration_ping_failed",
      message: `${integration.name} ping validation failed`,
      details: {
        error: error instanceof Error ? error.message : "Unknown error",
      },
    });

    res.status(400).json({
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to connect integration",
    });
  }
});

// POST /api/integrations/:id/disconnect - Disconnect an integration
router.post("/:id/disconnect", (req, res) => {
  const integration = dataStore.disconnectIntegration(
    resolveIntegrationId(req.params.id),
  );

  if (!integration) {
    return res.status(404).json({
      success: false,
      error: "Integration not found",
    });
  }

  res.json({
    success: true,
    data: integration,
    message: `${integration.name} disconnected`,
  });
});

// POST /api/integrations/:id/test - Test an integration connection
router.post("/:id/test", async (req, res) => {
  const integration = dataStore.getIntegration(
    resolveIntegrationId(req.params.id),
  );

  if (!integration) {
    return res.status(404).json({
      success: false,
      error: "Integration not found",
    });
  }

  if (integration.status !== "connected") {
    return res.status(400).json({
      success: false,
      error: "Integration is not connected",
    });
  }

  try {
    const userId = (req as { userId?: string }).userId;
    const validated = await validateProvider(
      integration.service,
      (integration.credentials ?? {}) as Record<string, unknown>,
      {
        userId,
      },
    );

    dataStore.addLog({
      level: "info",
      service: integration.service,
      action: "connection_test",
      message: `Connection test passed for ${integration.name}`,
    });

    return res.json({
      success: true,
      message: "Connection test passed",
      data: validated.metadata,
    });
  } catch (error) {
    dataStore.addLog({
      level: "warning",
      service: integration.service,
      action: "connection_test",
      message: `Connection test failed for ${integration.name}`,
    });

    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Connection test failed",
    });
  }
});

// GET /api/integrations/:id/capabilities - Get integration capabilities
router.get("/:id/capabilities", (req, res) => {
  const integration = dataStore.getIntegration(
    resolveIntegrationId(req.params.id),
  );

  if (!integration) {
    return res.status(404).json({
      success: false,
      error: "Integration not found",
    });
  }

  res.json({
    success: true,
    data: integration.capabilities,
  });
});

export default router;
