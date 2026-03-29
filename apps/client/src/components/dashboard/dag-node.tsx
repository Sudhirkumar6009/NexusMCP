'use client';

import React from 'react';
import type { DAGNode, NodeType, NodeStatus } from '@/types';
import { cn } from '@/lib/utils';
import {
  Play,
  GitBranch,
  CheckCircle2,
  XCircle,
  Clock,
  RotateCw,
  UserCheck,
  CircleDot,
  Database,
  MessageSquare,
  Github,
  ClipboardList,
} from 'lucide-react';

interface DAGNodeProps {
  node: DAGNode;
  isSelected: boolean;
  onSelect: () => void;
  onDragStart: (e: React.MouseEvent) => void;
  isDragging: boolean;
}

const nodeTypeConfig: Record<NodeType, { icon: React.ComponentType<{ className?: string }>; color: string }> = {
  trigger: { icon: Play, color: 'bg-success text-success' },
  action: { icon: CircleDot, color: 'bg-info text-info' },
  condition: { icon: GitBranch, color: 'bg-warning text-warning' },
  parallel: { icon: GitBranch, color: 'bg-info text-info' },
  approval: { icon: UserCheck, color: 'bg-primary text-primary' },
  end: { icon: CheckCircle2, color: 'bg-content-tertiary text-content-tertiary' },
};

const statusConfig: Record<NodeStatus, { icon: React.ComponentType<{ className?: string }>; bgColor: string; borderColor: string }> = {
  pending: { icon: Clock, bgColor: 'bg-surface-primary', borderColor: 'border-border' },
  running: { icon: RotateCw, bgColor: 'bg-info-light', borderColor: 'border-info' },
  success: { icon: CheckCircle2, bgColor: 'bg-success-light', borderColor: 'border-success' },
  failed: { icon: XCircle, bgColor: 'bg-error-light', borderColor: 'border-error' },
  retrying: { icon: RotateCw, bgColor: 'bg-warning-light', borderColor: 'border-warning' },
  waiting_approval: { icon: UserCheck, bgColor: 'bg-primary-light', borderColor: 'border-primary' },
  skipped: { icon: Clock, bgColor: 'bg-surface-tertiary', borderColor: 'border-border' },
};

const serviceIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  jira: ClipboardList,
  slack: MessageSquare,
  github: Github,
  postgresql: Database,
};

export function DAGNode({ node, isSelected, onSelect, onDragStart, isDragging }: DAGNodeProps) {
  const typeConfig = nodeTypeConfig[node.type];
  const status = statusConfig[node.status];
  const TypeIcon = typeConfig.icon;
  const StatusIcon = status.icon;
  const ServiceIcon = node.service ? serviceIcons[node.service] : null;

  const isCondition = node.type === 'condition';

  return (
    <div
      className={cn(
        'absolute flex flex-col items-center cursor-pointer select-none',
        isDragging && 'z-50'
      )}
      style={{
        left: node.position.x,
        top: node.position.y,
        width: 150,
      }}
      onClick={onSelect}
      onMouseDown={onDragStart}
    >
      {/* Node Card */}
      <div
        className={cn(
          'w-full border-2 rounded-lg p-3 transition-all',
          status.bgColor,
          status.borderColor,
          isSelected && 'ring-2 ring-primary ring-offset-2 ring-offset-surface-primary',
          isDragging && 'shadow-lg',
          isCondition && 'rotate-0' // Could add diamond shape styling here
        )}
      >
        {/* Header */}
        <div className="flex items-center gap-2 mb-1.5">
          <div
            className={cn(
              'flex items-center justify-center w-5 h-5 rounded',
              typeConfig.color.replace('text-', 'bg-').replace('bg-', 'bg-') + '-light'
            )}
          >
            <TypeIcon className={cn('w-3 h-3', typeConfig.color.split(' ')[1])} />
          </div>
          <span className="text-2xs font-medium text-content-secondary uppercase tracking-wider">
            {node.type}
          </span>
        </div>

        {/* Label */}
        <p className="text-sm font-medium text-content-primary truncate">{node.label}</p>

        {/* Service Badge */}
        {node.service && ServiceIcon && (
          <div className="flex items-center gap-1.5 mt-2">
            <ServiceIcon className="w-3.5 h-3.5 text-content-secondary" />
            <span className="text-2xs text-content-secondary capitalize">{node.service}</span>
          </div>
        )}

        {/* Status Indicator */}
        {node.status !== 'pending' && (
          <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-border">
            <StatusIcon
              className={cn(
                'w-3.5 h-3.5',
                node.status === 'running' && 'animate-spin',
                node.status === 'retrying' && 'animate-spin',
                node.status === 'success' && 'text-success',
                node.status === 'failed' && 'text-error',
                node.status === 'waiting_approval' && 'text-primary',
                node.status === 'running' && 'text-info',
                node.status === 'retrying' && 'text-warning'
              )}
            />
            <span
              className={cn(
                'text-2xs font-medium capitalize',
                node.status === 'success' && 'text-success',
                node.status === 'failed' && 'text-error',
                node.status === 'waiting_approval' && 'text-primary',
                node.status === 'running' && 'text-info',
                node.status === 'retrying' && 'text-warning'
              )}
            >
              {node.status === 'waiting_approval' ? 'Awaiting Approval' : node.status}
              {node.retryCount !== undefined && node.retryCount > 0 && ` (${node.retryCount}/${node.maxRetries})`}
            </span>
          </div>
        )}
      </div>

      {/* Connection Handle - Bottom */}
      <div className="w-3 h-3 rounded-full bg-surface-primary border-2 border-content-tertiary -mt-1.5 z-10" />
    </div>
  );
}
