"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useIntegrations } from "@/context/integrations-context";
import { useWorkflow } from "@/context/workflow-context";
import { logsApi, workflowsApi } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Plug,
  RefreshCw,
  ScrollText,
  Workflow,
} from "lucide-react";

const STATS_REFRESH_INTERVAL_MS = 15000;

type DashboardStats = {
  activeWorkflows: number;
  failedExecutions: number;
  totalWorkflows: number;
};

export function ManagementZone() {
  const { integrations, getConnectedIntegrations } = useIntegrations();
  const { execution, isExecuting } = useWorkflow();

  const [stats, setStats] = useState<DashboardStats>({
    activeWorkflows: 0,
    failedExecutions: 0,
    totalWorkflows: 0,
  });
  const [isLoadingStats, setIsLoadingStats] = useState(true);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const loadStats = useCallback(async () => {
    const [workflowsResponse, logsStatsResponse] = await Promise.all([
      workflowsApi.list(),
      logsApi.getStats(),
    ]);

    if (!workflowsResponse.success || !workflowsResponse.data) {
      setStatsError(workflowsResponse.error || "Unable to load workflow stats");
      setIsLoadingStats(false);
      return;
    }

    if (!logsStatsResponse.success || !logsStatsResponse.data) {
      setStatsError(logsStatsResponse.error || "Unable to load log stats");
      setIsLoadingStats(false);
      return;
    }

    const activeCount = workflowsResponse.data.filter(
      (workflow) =>
        workflow.status === "running" || workflow.status === "paused",
    ).length;
    const failedWorkflowCount = workflowsResponse.data.filter(
      (workflow) => workflow.status === "failed",
    ).length;
    const failedFromLogs = logsStatsResponse.data.byLevel.error ?? 0;

    setStats({
      activeWorkflows: activeCount,
      failedExecutions: Math.max(failedWorkflowCount, failedFromLogs),
      totalWorkflows: workflowsResponse.data.length,
    });
    setStatsError(null);
    setLastUpdated(new Date());
    setIsLoadingStats(false);
  }, []);

  useEffect(() => {
    void loadStats();

    const intervalId = window.setInterval(() => {
      void loadStats();
    }, STATS_REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [loadStats]);

  const connectedServices = getConnectedIntegrations().length;
  const totalServices = integrations.length;

  const activeWorkflows = useMemo(() => {
    const hasLocalRunningExecution =
      isExecuting ||
      execution?.status === "running" ||
      execution?.status === "paused";

    return hasLocalRunningExecution
      ? Math.max(stats.activeWorkflows, 1)
      : stats.activeWorkflows;
  }, [execution?.status, isExecuting, stats.activeWorkflows]);

  const failedExecutions = stats.failedExecutions;

  return (
    <Card padding="lg" className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-content-primary">
            Quick Actions
          </h2>
          <p className="text-sm text-content-secondary mt-0.5">
            Manage MCP connections and monitor real execution health
          </p>
          {statsError ? (
            <p className="mt-1 text-xs text-error">{statsError}</p>
          ) : (
            <p className="mt-1 text-xs text-content-secondary">
              {lastUpdated
                ? `Last updated ${lastUpdated.toLocaleTimeString()}`
                : "Loading stats..."}
            </p>
          )}
        </div>

        <Button
          variant="ghost"
          onClick={() => {
            setIsLoadingStats(true);
            void loadStats();
          }}
          isLoading={isLoadingStats}
          leftIcon={<RefreshCw className="h-4 w-4" />}
        >
          Refresh Metrics
        </Button>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <Link href="/integrations">
          <Button
            className="w-full sm:w-auto"
            variant="secondary"
            leftIcon={<Plug className="h-4 w-4" />}
          >
            Connect MCP Server
          </Button>
        </Link>
        <Link href="/logs">
          <Button
            className="w-full sm:w-auto"
            variant="outline"
            leftIcon={<ScrollText className="h-4 w-4" />}
          >
            View Logs
          </Button>
        </Link>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {/* Connected Services */}
        <div className="p-4 rounded-lg bg-surface-secondary border border-border">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-success-light">
              <CheckCircle2 className="h-5 w-5 text-success" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-content-primary">
                {connectedServices}/{totalServices}
              </p>
              <p className="text-sm text-content-secondary">
                Connected Services
              </p>
            </div>
          </div>
        </div>

        {/* Active Workflows */}
        <div className="p-4 rounded-lg bg-surface-secondary border border-border">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-info-light">
              <Workflow className="h-5 w-5 text-info" />
            </div>
            <div>
              <p className="flex items-center gap-2 text-2xl font-semibold text-content-primary">
                {activeWorkflows}
                {isLoadingStats ? (
                  <Loader2 className="h-4 w-4 animate-spin text-content-secondary" />
                ) : null}
              </p>
              <p className="text-sm text-content-secondary">Active Workflows</p>
              <p className="text-xs text-content-tertiary">
                {stats.totalWorkflows} total configured
              </p>
            </div>
          </div>
        </div>

        {/* Failed Executions */}
        <div className="p-4 rounded-lg bg-surface-secondary border border-border">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-error-light">
              <AlertTriangle className="h-5 w-5 text-error" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-content-primary">
                {failedExecutions}
              </p>
              <p className="text-sm text-content-secondary">
                Failed Executions
              </p>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}
