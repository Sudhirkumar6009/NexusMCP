'use client';

import React from 'react';
import { PromptZone } from '@/components/dashboard/prompt-zone';
import { ExecutionZone } from '@/components/dashboard/execution-zone';
import { ManagementZone } from '@/components/dashboard/management-zone';
import { MockTerminal } from '@/components/terminal/mock-terminal';
import { ContextPanel } from '@/components/context/context-panel';
import { useWorkflow } from '@/context/workflow-context';

export default function DashboardPage() {
  const { currentWorkflow, terminalLogs } = useWorkflow();

  return (
    <div className="space-y-6">
      {/* Zone A: Prompting */}
      <PromptZone />

      {/* Zone B: Execution (only show when workflow exists) */}
      {currentWorkflow && (
        <div className="grid grid-cols-2 gap-6">
          <ExecutionZone />
          <ContextPanel />
        </div>
      )}

      {/* Zone C: Management */}
      <ManagementZone />

      {/* Mock Terminal (only show when there are logs) */}
      {terminalLogs.length > 0 && <MockTerminal />}
    </div>
  );
}
