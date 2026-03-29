import { Router } from "express";
import { createHmac, createHash, createSign } from "crypto";
import { dataStore } from "../data/store.js";

const router = Router();

const integrationIdAliases: Record<string, string> = {
  jira: "int-jira",
  slack: "int-slack",
  github: "int-github",
  google_sheets: "int-google-sheets",
  gmail: "int-gmail",
  aws: "int-aws",
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

async function validateGmailCredentials(credentials: Record<string, unknown>) {
  const accessToken =
    (typeof credentials.accessToken === "string" &&
      credentials.accessToken.trim()) ||
    (typeof credentials.apiKey === "string" && credentials.apiKey.trim()) ||
    process.env.GMAIL_ACCESS_TOKEN;

  if (!accessToken) {
    throw new Error("Gmail access token is required");
  }

  const response = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/profile",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Gmail validation failed (${response.status}): ${body}`);
  }

  const profile = (await response.json()) as Record<string, unknown>;
  return {
    credentials: {
      accessToken,
    },
    metadata: {
      emailAddress: profile.emailAddress,
      messagesTotal: profile.messagesTotal,
    },
  };
}

function hashSha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function hmacSha256(
  key: string | Buffer,
  content: string,
  encoding?: "hex",
): Buffer | string {
  const digest = createHmac("sha256", key).update(content, "utf8");
  return encoding ? digest.digest(encoding) : digest.digest();
}

async function validateAwsCredentials(credentials: Record<string, unknown>) {
  const accessKeyId =
    (typeof credentials.accessKeyId === "string" &&
      credentials.accessKeyId.trim()) ||
    (typeof credentials.apiKey === "string" && credentials.apiKey.trim()) ||
    process.env.AWS_ACCESS_KEY_ID;

  const secretAccessKey =
    (typeof credentials.secretAccessKey === "string" &&
      credentials.secretAccessKey.trim()) ||
    (typeof credentials.apiSecret === "string" &&
      credentials.apiSecret.trim()) ||
    process.env.AWS_SECRET_ACCESS_KEY;

  const sessionToken =
    (typeof credentials.sessionToken === "string" &&
      credentials.sessionToken.trim()) ||
    process.env.AWS_SESSION_TOKEN;

  const region =
    (typeof credentials.region === "string" && credentials.region.trim()) ||
    process.env.AWS_REGION ||
    "us-east-1";

  if (!accessKeyId || !secretAccessKey) {
    throw new Error("AWS accessKeyId and secretAccessKey are required");
  }

  const host = `sts.${region}.amazonaws.com`;
  const endpoint = `https://${host}/`;
  const service = "sts";
  const payload = "Action=GetCallerIdentity&Version=2011-06-15";

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);

  const canonicalHeaders = [
    "content-type:application/x-www-form-urlencoded; charset=utf-8",
    `host:${host}`,
    `x-amz-date:${amzDate}`,
    ...(sessionToken ? [`x-amz-security-token:${sessionToken}`] : []),
  ]
    .join("\n")
    .concat("\n");

  const signedHeaders = [
    "content-type",
    "host",
    "x-amz-date",
    ...(sessionToken ? ["x-amz-security-token"] : []),
  ].join(";");

  const canonicalRequest = [
    "POST",
    "/",
    "",
    canonicalHeaders,
    signedHeaders,
    hashSha256(payload),
  ].join("\n");

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    hashSha256(canonicalRequest),
  ].join("\n");

  const kDate = hmacSha256(`AWS4${secretAccessKey}`, dateStamp) as Buffer;
  const kRegion = hmacSha256(kDate, region) as Buffer;
  const kService = hmacSha256(kRegion, service) as Buffer;
  const kSigning = hmacSha256(kService, "aws4_request") as Buffer;
  const signature = hmacSha256(kSigning, stringToSign, "hex") as string;

  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
    "X-Amz-Date": amzDate,
    Authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };

  if (sessionToken) {
    headers["X-Amz-Security-Token"] = sessionToken;
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: payload,
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(
      `AWS validation failed (${response.status}): ${responseText}`,
    );
  }

  const arnMatch = responseText.match(/<Arn>([^<]+)<\/Arn>/);
  const accountMatch = responseText.match(/<Account>([^<]+)<\/Account>/);

  return {
    credentials: {
      accessKeyId,
      secretAccessKey,
      ...(sessionToken ? { sessionToken } : {}),
      region,
    },
    metadata: {
      arn: arnMatch?.[1],
      account: accountMatch?.[1],
      region,
    },
  };
}

async function validateProvider(
  service: string,
  credentials: Record<string, unknown>,
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
    return validateGmailCredentials(credentials);
  }

  if (service === "aws") {
    return validateAwsCredentials(credentials);
  }

  throw new Error(`No validator configured for provider: ${service}`);
}

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

    const validated = await validateProvider(integration.service, credentials);
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
    const validated = await validateProvider(
      integration.service,
      (integration.credentials ?? {}) as Record<string, unknown>,
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
