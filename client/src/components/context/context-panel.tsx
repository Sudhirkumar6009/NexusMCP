'use client';

import React, { useState } from 'react';
import { useWorkflow } from '@/context/workflow-context';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  ChevronDown,
  ChevronRight,
  Database,
  MessageSquare,
  FileJson,
  Minimize2,
  Maximize2,
} from 'lucide-react';

interface JsonViewerProps {
  data: unknown;
  collapsed?: boolean;
}

function JsonViewer({ data, collapsed = true }: JsonViewerProps) {
  const [isExpanded, setIsExpanded] = useState(!collapsed);

  const jsonString = JSON.stringify(data, null, 2);
  const isLarge = jsonString.length > 500;

  return (
    <div className="font-mono text-xs">
      {isLarge && (
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-1 text-primary hover:underline mb-1"
        >
          {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          {isExpanded ? 'Collapse' : 'Expand'}
        </button>
      )}
      <pre
        className={cn(
          'p-2 rounded bg-surface-tertiary overflow-x-auto',
          !isExpanded && isLarge && 'max-h-20 overflow-hidden'
        )}
      >
        {isExpanded || !isLarge
          ? jsonString
          : jsonString.slice(0, 200) + '...'}
      </pre>
    </div>
  );
}

export function ContextPanel() {
  const { currentWorkflow, execution } = useWorkflow();
  const [isExpanded, setIsExpanded] = useState(true);

  if (!currentWorkflow) return null;

  // Mock context data
  const conversationState = [
    { turn: 1, action: 'User prompt received', data: currentWorkflow.prompt },
    { turn: 2, action: 'DAG generated', data: `${currentWorkflow.nodes.length} nodes, ${currentWorkflow.edges.length} edges` },
    ...(execution
      ? [{ turn: 3, action: 'Execution started', data: `Progress: ${execution.progress}%` }]
      : []),
  ];

  // Mock data flow between nodes
  const dataFlows = execution?.steps
    .filter((s) => s.status === 'success' && s.output)
    .map((step, index, arr) => ({
      from: step.nodeName,
      to: arr[index + 1]?.nodeName || 'End',
      data: {
        result: 'success',
        output: step.nodeName.toLowerCase().includes('jira')
          ? { issueId: 'BUG-123', priority: 'P0' }
          : step.nodeName.toLowerCase().includes('github')
          ? { branchName: 'fix/BUG-123', sha: 'abc123' }
          : { status: 'processed' },
      },
    }))
    .slice(0, -1) || [];

  // Mock large payloads
  const largePayloads = [
    { name: 'api_response.json', size: '12KB', chunks: 3, summarized: true },
    { name: 'jira_issue.json', size: '5KB', chunks: 1, summarized: false },
  ];

  return (
    <Card padding="lg" className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Database className="h-5 w-5 text-content-secondary" />
          <h2 className="text-lg font-semibold text-content-primary">Context Management</h2>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsExpanded(!isExpanded)}
          className="h-8 w-8 p-0"
        >
          {isExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </Button>
      </div>

      {isExpanded && (
        <>
          {/* Conversation State */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-content-tertiary" />
              <p className="text-sm font-medium text-content-primary">Conversation State</p>
            </div>
            <div className="space-y-1 pl-6">
              {conversationState.map((state, i) => (
                <div key={i} className="flex items-start gap-2 text-sm">
                  <Badge variant="default" size="sm">
                    Turn {state.turn}
                  </Badge>
                  <span className="text-content-secondary">{state.action}:</span>
                  <span className="text-content-primary truncate max-w-[200px]" title={state.data}>
                    {state.data}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Data Flow Between Nodes */}
          {dataFlows.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <FileJson className="h-4 w-4 text-content-tertiary" />
                <p className="text-sm font-medium text-content-primary">Data Flow Between Nodes</p>
              </div>
              <div className="space-y-3 pl-6">
                {dataFlows.map((flow, i) => (
                  <div key={i} className="space-y-1">
                    <p className="text-xs text-content-secondary">
                      {flow.from} → {flow.to}
                    </p>
                    <JsonViewer data={flow.data} collapsed />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Large Payloads */}
          <div className="space-y-2">
            <p className="text-sm font-medium text-content-primary">Large Payloads</p>
            <div className="space-y-2 pl-6">
              {largePayloads.map((payload, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between p-2 rounded bg-surface-secondary"
                >
                  <div className="flex items-center gap-2">
                    <FileJson className="h-4 w-4 text-content-tertiary" />
                    <span className="text-sm text-content-primary">{payload.name}</span>
                    <Badge variant="default" size="sm">
                      {payload.size}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    {payload.chunks > 1 && (
                      <span className="text-xs text-content-tertiary">
                        {payload.chunks} chunks
                      </span>
                    )}
                    {payload.summarized && (
                      <Badge variant="info" size="sm">
                        Summarized
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* View Options */}
          <div className="flex items-center gap-2 pt-2 border-t border-border">
            <Button variant="ghost" size="sm">
              View Raw
            </Button>
            <Button variant="ghost" size="sm">
              Summarized
            </Button>
            <Button variant="ghost" size="sm">
              Expand All
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}
