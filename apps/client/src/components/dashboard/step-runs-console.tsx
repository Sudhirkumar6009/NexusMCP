"use client";

import React from "react";
import { logsApi, type StepRun } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, TerminalSquare } from "lucide-react";

const REFRESH_MS = 5000;

function formatPayloadSummary(payload: unknown): string {
  if (payload === null || payload === undefined) {
    return "-";
  }

  if (typeof payload === "string") {
    return payload.length > 140 ? `${payload.slice(0, 140)}...` : payload;
  }

  try {
    const serialized = JSON.stringify(payload);
    return serialized.length > 140
      ? `${serialized.slice(0, 140)}...`
      : serialized;
  } catch {
    return "[unserializable payload]";
  }
}

function statusVariant(
  status: string,
): "success" | "error" | "warning" | "info" | "default" {
  const normalized = status.toLowerCase();

  if (normalized === "success" || normalized === "completed") {
    return "success";
  }

  if (normalized === "failed" || normalized === "error") {
    return "error";
  }

  if (normalized === "running" || normalized === "retrying") {
    return "warning";
  }

  return "default";
}

export function StepRunsConsole() {
  const [stepRuns, setStepRuns] = React.useState<StepRun[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = React.useState<Date | null>(null);

  const loadStepRuns = React.useCallback(async () => {
    const response = await logsApi.listStepRuns({ limit: 200, offset: 0 });

    if (!response.success || !response.data) {
      setError(response.error || "Unable to load step runs");
      setIsLoading(false);
      return;
    }

    setStepRuns(response.data);
    setError(null);
    setLastUpdated(new Date());
    setIsLoading(false);
  }, []);

  React.useEffect(() => {
    void loadStepRuns();

    const intervalId = window.setInterval(() => {
      void loadStepRuns();
    }, REFRESH_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [loadStepRuns]);

  const counts = React.useMemo(() => {
    return stepRuns.reduce(
      (acc, step) => {
        const normalized = step.status.toLowerCase();

        if (normalized === "success" || normalized === "completed") {
          acc.success += 1;
        } else if (normalized === "failed" || normalized === "error") {
          acc.failed += 1;
        } else if (normalized === "running" || normalized === "retrying") {
          acc.running += 1;
        } else {
          acc.other += 1;
        }

        return acc;
      },
      { success: 0, failed: 0, running: 0, other: 0 },
    );
  }, [stepRuns]);

  return (
    <Card padding="lg" className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <TerminalSquare className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold text-content-primary">
              Step Runs Console
            </h2>
          </div>
          <p className="mt-0.5 text-sm text-content-secondary">
            Live PostgreSQL step_runs stream shown in command-style timeline
          </p>
          {lastUpdated ? (
            <p className="mt-1 text-xs text-content-tertiary">
              Updated at {lastUpdated.toLocaleTimeString()}
            </p>
          ) : null}
        </div>

        <Button
          variant="outline"
          size="sm"
          leftIcon={<RefreshCw className="h-4 w-4" />}
          isLoading={isLoading}
          onClick={() => {
            setIsLoading(true);
            void loadStepRuns();
          }}
        >
          Refresh
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="success">Success: {counts.success}</Badge>
        <Badge variant="error">Failed: {counts.failed}</Badge>
        <Badge variant="warning">Running: {counts.running}</Badge>
        <Badge variant="default">Other: {counts.other}</Badge>
      </div>

      <div className="rounded-lg border border-border bg-surface-secondary p-3">
        <div className="max-h-[320px] overflow-y-auto rounded-md bg-surface-tertiary p-3 font-mono text-xs">
          {error ? (
            <p className="text-error">{error}</p>
          ) : stepRuns.length === 0 ? (
            <p className="text-content-tertiary">No step runs available yet.</p>
          ) : (
            <div className="space-y-2">
              {stepRuns.map((step) => {
                const variant = statusVariant(step.status);
                const timestamp = new Date(step.updatedAt).toLocaleTimeString();
                const execution = step.executionId
                  ? step.executionId.slice(0, 8)
                  : "no-exec";

                return (
                  <div
                    key={step.stepId}
                    className="rounded border border-border/60 bg-surface-secondary/80 px-2 py-1.5"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-content-tertiary">
                        [{timestamp}]
                      </span>
                      <Badge variant={variant}>{step.status}</Badge>
                      <span className="text-content-primary">
                        {step.toolName}
                      </span>
                      <span className="text-content-tertiary">
                        exec:{execution}
                      </span>
                      {step.retryCount > 0 ? (
                        <span className="text-warning">
                          retry:{step.retryCount}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 break-all text-content-secondary">
                      out: {formatPayloadSummary(step.outputPayload)}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
