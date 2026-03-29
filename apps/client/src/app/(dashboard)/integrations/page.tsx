"use client";

import React, { useState } from "react";
import { useIntegrations } from "@/context/integrations-context";
import { Integration, ServiceId, IntegrationCredentials } from "@/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Toggle } from "@/components/ui/toggle";
import { Modal, ModalFooter } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { cn, formatRelativeTime } from "@/lib/utils";
import {
  ClipboardList,
  MessageSquare,
  Github,
  Table2,
  Mail,
  Cloud,
  Settings,
  Plug,
  PlugZap,
  RefreshCw,
} from "lucide-react";

const serviceIcons: Record<
  ServiceId,
  React.ComponentType<{ className?: string }>
> = {
  jira: ClipboardList,
  slack: MessageSquare,
  github: Github,
  google_sheets: Table2,
  gmail: Mail,
  aws: Cloud,
};

const categoryLabels: Record<string, string> = {
  project_management: "Project Management",
  communication: "Communication",
  data_analytics: "Data & Analytics",
  devops: "DevOps",
};

interface CredentialModalProps {
  integration: Integration | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (id: ServiceId, credentials: IntegrationCredentials) => void;
}

function CredentialModal({
  integration,
  isOpen,
  onClose,
  onSave,
}: CredentialModalProps) {
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

  const isJira = integration?.id === "jira";
  const isGitHub = integration?.id === "github";
  const isGoogleSheets = integration?.id === "google_sheets";
  const isAws = integration?.id === "aws";

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
      } else if (integration.id === "gmail") {
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

      onClose();
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

  const isSaveDisabled =
    !integration ||
    (isJira && (!apiKey || !jiraEmail || !jiraBaseUrl)) ||
    (isGoogleSheets && (!googleServiceAccountJson || !spreadsheetId)) ||
    (integration?.id === "gmail" && !apiKey) ||
    (integration?.id === "slack" && !apiKey) ||
    (integration?.id === "github" && !apiKey) ||
    (isAws && (!awsAccessKeyId || !awsSecretAccessKey || !awsRegion));

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Configure ${integration?.name || ""}`}
      description="Enter your credentials to connect this service"
      size="md"
    >
      <div className="space-y-4">
        {!isAws && !isGoogleSheets && (
          <Input
            label={
              isJira
                ? "Jira API Token"
                : isGitHub
                  ? "GitHub Personal Access Token"
                  : integration?.id === "gmail"
                    ? "Gmail OAuth Access Token"
                    : "Access Token"
            }
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Enter credentials used for provider ping"
          />
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
              <label className="block text-sm font-medium text-content-primary mb-2">
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
          <label className="block text-sm font-medium text-content-primary mb-2">
            Permission Scopes
          </label>
          <div className="grid grid-cols-2 gap-2">
            {integration &&
              availableScopes[integration.id]?.map((scope) => (
                <label
                  key={scope}
                  className="flex items-center gap-2 cursor-pointer"
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
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          onClick={handleSave}
          isLoading={isLoading}
          disabled={isSaveDisabled}
        >
          Validate & Connect
        </Button>
      </ModalFooter>
    </Modal>
  );
}

function IntegrationCard({ integration }: { integration: Integration }) {
  const { toggleIntegration, connectIntegration } = useIntegrations();
  const [showCredentialModal, setShowCredentialModal] = useState(false);

  const Icon = serviceIcons[integration.id];
  const isConnected = integration.status === "connected";
  const isErrored = integration.status === "error";

  const handleConfigure = () => {
    setShowCredentialModal(true);
  };

  const handleSaveCredentials = async (
    id: ServiceId,
    credentials: IntegrationCredentials,
  ) => {
    await connectIntegration(id, credentials);
  };

  return (
    <>
      <Card
        className={cn(
          "p-4 transition-all",
          isConnected
            ? "border-success/30"
            : isErrored
              ? "border-error/30"
              : "border-border",
        )}
      >
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "flex items-center justify-center w-10 h-10 rounded-lg",
                isConnected
                  ? "bg-success-light"
                  : isErrored
                    ? "bg-error-light"
                    : "bg-surface-tertiary",
              )}
            >
              <Icon
                className={cn(
                  "h-5 w-5",
                  isConnected
                    ? "text-success"
                    : isErrored
                      ? "text-error"
                      : "text-content-tertiary",
                )}
              />
            </div>
            <div>
              <h3 className="font-medium text-content-primary">
                {integration.name}
              </h3>
              <p className="text-xs text-content-tertiary">
                {categoryLabels[integration.category]}
              </p>
            </div>
          </div>
          <Badge
            variant={isConnected ? "success" : isErrored ? "error" : "default"}
            dot
          >
            {isConnected ? "Connected" : isErrored ? "Error" : "Disconnected"}
          </Badge>
        </div>

        <p className="text-sm text-content-secondary mb-4">
          {integration.description}
        </p>

        {/* Tools count */}
        <div className="text-xs text-content-tertiary mb-4">
          {integration.tools.length} tools available
        </div>

        {/* Last synced */}
        {isConnected && integration.lastSynced && (
          <p className="text-xs text-content-tertiary mb-4">
            Last synced: {formatRelativeTime(integration.lastSynced)}
          </p>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between pt-3 border-t border-border">
          {isConnected ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleConfigure}
                leftIcon={<Settings className="h-4 w-4" />}
              >
                Configure
              </Button>
              <Toggle
                checked={integration.enabled}
                onChange={() => toggleIntegration(integration.id)}
                size="sm"
              />
            </>
          ) : (
            <Button
              size="sm"
              onClick={handleConfigure}
              leftIcon={<PlugZap className="h-4 w-4" />}
              className="w-full"
            >
              Connect
            </Button>
          )}
        </div>
      </Card>

      <CredentialModal
        integration={integration}
        isOpen={showCredentialModal}
        onClose={() => setShowCredentialModal(false)}
        onSave={handleSaveCredentials}
      />
    </>
  );
}

export default function IntegrationsPage() {
  const { integrations, isLoading } = useIntegrations();

  const connectedCount = integrations.filter(
    (i) => i.status === "connected",
  ).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-content-secondary">
            Connect your MCP servers to enable workflow automation
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="success" className="text-sm">
            {connectedCount}/{integrations.length} Connected
          </Badge>
          <Button
            variant="outline"
            size="sm"
            leftIcon={<RefreshCw className="h-4 w-4" />}
          >
            Sync All
          </Button>
        </div>
      </div>

      {/* Integration Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {integrations.map((integration) => (
          <IntegrationCard key={integration.id} integration={integration} />
        ))}
      </div>

      {/* Add More Section */}
      <Card className="p-6 border-dashed">
        <div className="flex flex-col items-center justify-center text-center">
          <div className="flex items-center justify-center w-12 h-12 rounded-full bg-surface-tertiary mb-3">
            <Plug className="h-6 w-6 text-content-tertiary" />
          </div>
          <h3 className="font-medium text-content-primary mb-1">
            Add More Integrations
          </h3>
          <p className="text-sm text-content-secondary mb-4 max-w-md">
            Connect additional MCP servers to expand your workflow capabilities.
            Configure custom endpoints and authentication.
          </p>
          <Button variant="outline" leftIcon={<Plug className="h-4 w-4" />}>
            Browse Available Integrations
          </Button>
        </div>
      </Card>
    </div>
  );
}
