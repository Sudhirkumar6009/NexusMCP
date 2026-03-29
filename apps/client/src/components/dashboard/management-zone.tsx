'use client';

import React from 'react';
import Link from 'next/link';
import { useIntegrations } from '@/context/integrations-context';
import { useWorkflow } from '@/context/workflow-context';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Plug, ScrollText, Workflow, AlertTriangle, CheckCircle2 } from 'lucide-react';

export function ManagementZone() {
  const { integrations, getConnectedIntegrations } = useIntegrations();
  const { execution } = useWorkflow();

  const connectedServices = getConnectedIntegrations().length;
  const totalServices = integrations.length;

  // Mock data for stats
  const activeWorkflows = 12;
  const failedExecutions = 2;

  return (
    <Card padding="lg" className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-content-primary">Quick Actions</h2>
          <p className="text-sm text-content-secondary mt-0.5">
            Manage your MCP connections and view logs
          </p>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center gap-3">
        <Link href="/integrations">
          <Button variant="secondary" leftIcon={<Plug className="h-4 w-4" />}>
            Connect MCP Server
          </Button>
        </Link>
        <Link href="/logs">
          <Button variant="outline" leftIcon={<ScrollText className="h-4 w-4" />}>
            View Logs
          </Button>
        </Link>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-4">
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
              <p className="text-sm text-content-secondary">Connected Services</p>
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
              <p className="text-2xl font-semibold text-content-primary">{activeWorkflows}</p>
              <p className="text-sm text-content-secondary">Active Workflows</p>
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
              <p className="text-2xl font-semibold text-content-primary">{failedExecutions}</p>
              <p className="text-sm text-content-secondary">Failed Executions</p>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}
