"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal, ModalFooter } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { authApi } from "@/lib/api";
import type {
  Integration,
  IntegrationCredentials,
  ServiceId,
} from "@/types/integration";

interface ConnectorCredentialsModalProps {
  integration: Integration | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (id: ServiceId, credentials: IntegrationCredentials) => Promise<void>;
}

const availableScopes: Record<ServiceId, string[]> = {
  jira: [
    "read:jira-work",
    "write:jira-work",
    "read:jira-user",
    "manage:jira-project",
  ],
  slack: ["chat:write", "channels:read", "users:read", "channels:manage"],
  github: ["repo", "read:org", "write:org", "admin:repo_hook"],
  google_sheets: [
    "https://www.googleapis.com/auth/spreadsheets.readonly",
    "https://www.googleapis.com/auth/spreadsheets",
  ],
  gmail: [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
  ],
  aws: ["sts:GetCallerIdentity", "lambda:InvokeFunction", "s3:ListBucket"],
};

export function ConnectorCredentialsModal({
  integration,
  isOpen,
  onClose,
  onSave,
}: ConnectorCredentialsModalProps) {
  const [apiKey, setApiKey] = useState("");
  const [jiraEmail, setJiraEmail] = useState("");
  const [jiraBaseUrl, setJiraBaseUrl] = useState("");
  const [githubBaseUrl, setGithubBaseUrl] = useState("https://api.github.com");
  const [spreadsheetId, setSpreadsheetId] = useState("");
  const [googleServiceAccountJson, setGoogleServiceAccountJson] = useState("");
  const [googleCredentialsFileName, setGoogleCredentialsFileName] =
    useState("");
  const [awsAccessKeyId, setAwsAccessKeyId] = useState("");
  const [awsSecretAccessKey, setAwsSecretAccessKey] = useState("");
  const [awsSessionToken, setAwsSessionToken] = useState("");
  const [awsRegion, setAwsRegion] = useState("us-east-1");
  const [submitError, setSubmitError] = useState("");
  const [scopes, setScopes] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingGmailToken, setIsFetchingGmailToken] = useState(false);

  const isJira = integration?.id === "jira";
  const isGitHub = integration?.id === "github";
  const isGoogleSheets = integration?.id === "google_sheets";
  const isGmail = integration?.id === "gmail";
  const isAws = integration?.id === "aws";

  const gmailOAuthUrl = `${(
    process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000/api"
  )
    .replace(/\/$/, "")
    .replace(/\/api$/, "")}/auth/google/gmail`;

  const handleGoogleCredentialsFile = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as {
        client_email?: string;
        private_key?: string;
        spreadsheet_id?: string;
      };

      if (!parsed.client_email || !parsed.private_key) {
        throw new Error(
          "JSON must include client_email and private_key fields",
        );
      }

      setGoogleServiceAccountJson(text);
      setGoogleCredentialsFileName(file.name);
      if (!spreadsheetId && parsed.spreadsheet_id) {
        setSpreadsheetId(parsed.spreadsheet_id);
      }
      setSubmitError("");
    } catch (error) {
      setGoogleServiceAccountJson("");
      setGoogleCredentialsFileName("");
      setSubmitError(
        error instanceof Error
          ? error.message
          : "Invalid Google service account JSON",
      );
    }
  };

  const resetForm = () => {
    setApiKey("");
    setJiraEmail("");
    setJiraBaseUrl("");
    setGithubBaseUrl("https://api.github.com");
    setSpreadsheetId("");
    setGoogleServiceAccountJson("");
    setGoogleCredentialsFileName("");
    setAwsAccessKeyId("");
    setAwsSecretAccessKey("");
    setAwsSessionToken("");
    setAwsRegion("us-east-1");
    setScopes([]);
    setSubmitError("");
    setIsFetchingGmailToken(false);
  };

  const handleClose = () => {
    if (isLoading || isFetchingGmailToken) {
      return;
    }
    resetForm();
    onClose();
  };

  const handleAutoFetchGmailToken = async () => {
    setSubmitError("");
    setIsFetchingGmailToken(true);

    try {
      const tokenResponse = await authApi.fetchGmailOAuthToken();
      setApiKey(tokenResponse.access_token);
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Failed to fetch Gmail OAuth token";

      const needsReauthorization =
        errorMessage.includes(
          "authorization_code is required when no refresh_token exists",
        ) ||
        errorMessage.includes(
          "Google did not return refresh_token. Re-authorize with access_type=offline and prompt=consent.",
        );

      if (needsReauthorization && typeof window !== "undefined") {
        window.location.href = gmailOAuthUrl;
        return;
      }

      setSubmitError(errorMessage);
    } finally {
      setIsFetchingGmailToken(false);
    }
  };

  const handleSave = async () => {
    if (!integration) return;
    setIsLoading(true);
    setSubmitError("");

    try {
      const credentials: IntegrationCredentials = {
        scopes,
      };

      if (isJira) {
        credentials.apiKey = apiKey;
        credentials.username = jiraEmail;
        credentials.baseUrl = jiraBaseUrl;
      } else if (isGitHub) {
        credentials.accessToken = apiKey;
        credentials.baseUrl = githubBaseUrl || "https://api.github.com";
      } else if (isGoogleSheets) {
        credentials.googleServiceAccountJson = googleServiceAccountJson;
        credentials.spreadsheetId = spreadsheetId;
      } else if (isGmail) {
        credentials.accessToken = apiKey;
      } else if (isAws) {
        credentials.accessKeyId = awsAccessKeyId;
        credentials.secretAccessKey = awsSecretAccessKey;
        credentials.sessionToken = awsSessionToken || undefined;
        credentials.region = awsRegion;
      } else {
        credentials.accessToken = apiKey;
      }

      await onSave(integration.id, credentials);
      resetForm();
      onClose();
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : "Failed to connect integration",
      );
    } finally {
      setIsLoading(false);
    }
  };

  const isSaveDisabled =
    !integration ||
    (isJira && (!apiKey || !jiraEmail || !jiraBaseUrl)) ||
    (isGoogleSheets && (!googleServiceAccountJson || !spreadsheetId)) ||
    (integration?.id === "slack" && !apiKey) ||
    (integration?.id === "github" && !apiKey) ||
    (isAws && (!awsAccessKeyId || !awsSecretAccessKey || !awsRegion)) ||
    isFetchingGmailToken;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={`Configure ${integration?.name || ""}`}
      description="Enter your credentials to connect this service"
      size="md"
    >
      <div className="space-y-4">
        {!isAws && !isGoogleSheets && !isGmail && (
          <Input
            label={
              isJira
                ? "Jira API Token"
                : isGitHub
                  ? "GitHub Personal Access Token"
                  : "Access Token"
            }
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Enter credentials used for provider ping"
          />
        )}

        {isGmail && (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                isLoading={isFetchingGmailToken}
                disabled={isLoading}
                onClick={() => {
                  void handleAutoFetchGmailToken();
                }}
              >
                Auto Fetch Gmail Token
              </Button>
            </div>
            <p className="text-xs text-content-tertiary">
              Do not paste the Nexus token from /auth/callback?token=... here.
              That token authenticates this app, not Gmail API. If a Gmail
              refresh token is missing, this button redirects you to Google
              consent automatically. Manual re-authorize URL: {gmailOAuthUrl}.
            </p>
          </div>
        )}

        {isJira && (
          <>
            <Input
              label="Jira Email"
              type="email"
              value={jiraEmail}
              onChange={(e) => setJiraEmail(e.target.value)}
              placeholder="Enter Jira account email"
            />
            <Input
              label="Jira Base URL"
              value={jiraBaseUrl}
              onChange={(e) => setJiraBaseUrl(e.target.value)}
              placeholder="https://your-company.atlassian.net"
            />
          </>
        )}

        {isGoogleSheets && (
          <>
            <div>
              <label className="mb-2 block text-sm font-medium text-content-primary">
                Google Service Account JSON
              </label>
              <input
                type="file"
                accept=".json,application/json"
                onChange={(e) => {
                  void handleGoogleCredentialsFile(e);
                }}
                className="w-full rounded-lg border border-border bg-surface-primary px-3 py-2 text-sm text-content-primary"
              />
              {googleCredentialsFileName && (
                <p className="mt-1 text-xs text-content-tertiary">
                  Loaded: {googleCredentialsFileName}
                </p>
              )}
              <p className="mt-1 text-xs text-content-tertiary">
                Share the sheet with the service account email from this JSON.
              </p>
            </div>
            <Input
              label="Spreadsheet ID"
              value={spreadsheetId}
              onChange={(e) => setSpreadsheetId(e.target.value)}
              placeholder="Google Sheets spreadsheet ID"
            />
          </>
        )}

        {isGitHub && (
          <Input
            label="GitHub API Base URL (optional)"
            value={githubBaseUrl}
            onChange={(e) => setGithubBaseUrl(e.target.value)}
            placeholder="https://api.github.com or https://github.your-company.com/api/v3"
          />
        )}

        {isAws && (
          <>
            <Input
              label="AWS Access Key ID"
              value={awsAccessKeyId}
              onChange={(e) => setAwsAccessKeyId(e.target.value)}
              placeholder="AKIA..."
            />
            <Input
              label="AWS Secret Access Key"
              type="password"
              value={awsSecretAccessKey}
              onChange={(e) => setAwsSecretAccessKey(e.target.value)}
              placeholder="Enter secret access key"
            />
            <Input
              label="AWS Session Token (optional)"
              type="password"
              value={awsSessionToken}
              onChange={(e) => setAwsSessionToken(e.target.value)}
              placeholder="Temporary credentials session token"
            />
            <Input
              label="AWS Region"
              value={awsRegion}
              onChange={(e) => setAwsRegion(e.target.value)}
              placeholder="us-east-1"
            />
          </>
        )}

        {submitError && <p className="text-sm text-error">{submitError}</p>}

        <div>
          <label className="mb-2 block text-sm font-medium text-content-primary">
            Permission Scopes
          </label>
          <div className="grid grid-cols-2 gap-2">
            {integration &&
              availableScopes[integration.id]?.map((scope) => (
                <label
                  key={scope}
                  className="flex cursor-pointer items-center gap-2"
                >
                  <input
                    type="checkbox"
                    checked={scopes.includes(scope)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setScopes([...scopes, scope]);
                      } else {
                        setScopes(scopes.filter((s) => s !== scope));
                      }
                    }}
                    className="rounded border-border text-primary focus:ring-primary"
                  />
                  <span className="text-sm text-content-secondary">
                    {scope}
                  </span>
                </label>
              ))}
          </div>
        </div>
      </div>

      <ModalFooter>
        <Button variant="outline" onClick={handleClose} disabled={isLoading}>
          Cancel
        </Button>
        <Button
          onClick={() => {
            void handleSave();
          }}
          isLoading={isLoading}
          disabled={isSaveDisabled}
        >
          Validate & Connect
        </Button>
      </ModalFooter>
    </Modal>
  );
}
