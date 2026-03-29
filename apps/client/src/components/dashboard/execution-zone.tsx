'use client';

import React from 'react';
import { useWorkflow } from '@/context/workflow-context';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn, formatDuration } from '@/lib/utils';
import {
  Play,
  CheckCircle2,
  XCircle,
  Clock,
  RotateCw,
  UserCheck,
  ThumbsUp,
  ThumbsDown,
  AlertCircle,
} from 'lucide-react';
import { NodeStatus } from '@/types';

const statusIcons: Record<NodeStatus, React.ComponentType<{ className?: string }>> = {
  pending: Clock,
  running: RotateCw,
  success: CheckCircle2,
  failed: XCircle,
  retrying: RotateCw,
  waiting_approval: UserCheck,
  skipped: Clock,
};

export function ExecutionZone() {
  const {
    currentWorkflow,
    execution,
    isExecuting,
    executeWorkflow,
    approveExecution,
    rejectExecution,
  } = useWorkflow();

  if (!currentWorkflow) {
    return null;
  }

  const showApprovalButtons = execution?.approvalRequired;

  return (
    <Card padding="lg" className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-content-primary">Execution Control</h2>
          <p className="text-sm text-content-secondary mt-0.5">
            Run and monitor your workflow
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          {showApprovalButtons ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={rejectExecution}
                leftIcon={<ThumbsDown className="h-4 w-4" />}
                className="border-error text-error hover:bg-error-light"
              >
                Reject
              </Button>
              <Button
                size="sm"
                onClick={approveExecution}
                leftIcon={<ThumbsUp className="h-4 w-4" />}
              >
                Approve
              </Button>
            </>
          ) : (
            <Button
              onClick={executeWorkflow}
              isLoading={isExecuting}
              disabled={isExecuting || !currentWorkflow || currentWorkflow.status === 'running'}
              leftIcon={<Play className="h-4 w-4" />}
            >
              Execute Workflow
            </Button>
          )}
        </div>
      </div>

      {/* Approval Alert */}
      {execution?.approvalRequired && (
        <div className="flex items-start gap-3 p-3 rounded-lg bg-primary-light border border-primary">
          <AlertCircle className="h-5 w-5 text-primary shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-primary">Approval Required</p>
            <p className="text-sm text-content-secondary mt-0.5">
              {execution.approvalMessage}
            </p>
          </div>
        </div>
      )}

      {/* Execution Progress */}
      {execution && (
        <div className="space-y-4">
          {/* Progress Bar */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-content-secondary">Progress</span>
              <span className="font-medium text-content-primary">{execution.progress}%</span>
            </div>
            <div className="h-2 bg-surface-tertiary rounded-full overflow-hidden">
              <div
                className={cn(
                  'h-full transition-all duration-300 rounded-full',
                  execution.status === 'failed' || execution.status === 'cancelled'
                    ? 'bg-error'
                    : execution.status === 'completed'
                    ? 'bg-success'
                    : 'bg-primary'
                )}
                style={{ width: `${execution.progress}%` }}
              />
            </div>
          </div>

          {/* Status Badge */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-content-secondary">Status:</span>
            <Badge
              variant={
                execution.status === 'completed'
                  ? 'success'
                  : execution.status === 'failed' || execution.status === 'cancelled'
                  ? 'error'
                  : execution.status === 'paused'
                  ? 'warning'
                  : 'info'
              }
              dot
            >
              {execution.status}
            </Badge>
          </div>

          {/* Steps */}
          <div className="space-y-2">
            <p className="text-sm font-medium text-content-primary">Execution Steps</p>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {execution.steps.map((step, index) => {
                const StatusIcon = statusIcons[step.status];
                return (
                  <div
                    key={`${step.nodeId}-${index}`}
                    className={cn(
                      'flex items-center gap-3 p-2 rounded-md',
                      step.status === 'running' && 'bg-info-light',
                      step.status === 'waiting_approval' && 'bg-primary-light',
                      step.status === 'failed' && 'bg-error-light',
                      step.status === 'retrying' && 'bg-warning-light'
                    )}
                  >
                    <StatusIcon
                      className={cn(
                        'h-4 w-4 shrink-0',
                        step.status === 'pending' && 'text-content-tertiary',
                        step.status === 'running' && 'text-info animate-spin',
                        step.status === 'success' && 'text-success',
                        step.status === 'failed' && 'text-error',
                        step.status === 'retrying' && 'text-warning animate-spin',
                        step.status === 'waiting_approval' && 'text-primary'
                      )}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-content-primary truncate">
                        {step.nodeName}
                      </p>
                      <p className="text-xs text-content-secondary truncate">
                        {step.service} / {step.tool}
                        {step.retryAttempt > 0 && (
                          <span className="text-warning ml-1">
                            (Retry {step.retryAttempt}/{step.maxRetries})
                          </span>
                        )}
                      </p>
                    </div>
                    {step.duration && (
                      <span className="text-xs text-content-tertiary">
                        {formatDuration(step.duration)}
                      </span>
                    )}
                    {step.error && (
                      <span className="text-xs text-error truncate max-w-[150px]" title={step.error}>
                        {step.error}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!execution && (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <Play className="h-10 w-10 text-content-tertiary mb-3" />
          <p className="text-sm text-content-secondary">
            Click "Execute Workflow" to start running your DAG
          </p>
        </div>
      )}
    </Card>
  );
}
