'use client';

import React, { useRef, useEffect, useState } from 'react';
import { useWorkflow } from '@/context/workflow-context';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn, formatDateTime } from '@/lib/utils';
import { Terminal, Copy, Trash2, Pause, Play, ChevronDown } from 'lucide-react';

export function MockTerminal() {
  const { terminalLogs } = useWorkflow();
  const containerRef = useRef<HTMLDivElement>(null);
  const [isAutoScroll, setIsAutoScroll] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (isAutoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [terminalLogs, isAutoScroll]);

  const handleCopy = async (content: string, id: string) => {
    await navigator.clipboard.writeText(content);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const getLogColor = (type: string) => {
    switch (type) {
      case 'request':
        return 'text-info';
      case 'response':
        return 'text-success';
      case 'error':
        return 'text-error';
      default:
        return 'text-content-secondary';
    }
  };

  const getLogPrefix = (type: string) => {
    switch (type) {
      case 'request':
        return '→ REQUEST';
      case 'response':
        return '← RESPONSE';
      case 'error':
        return '✗ ERROR';
      default:
        return 'ℹ INFO';
    }
  };

  if (terminalLogs.length === 0) return null;

  return (
    <Card padding="none" className="overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-[#1a1a1f] border-b border-[#2d2d35]">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-green-400" />
          <span className="text-sm font-medium text-white">MCP JSON-RPC Terminal</span>
          <span className="text-xs text-gray-500">({terminalLogs.length} entries)</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsAutoScroll(!isAutoScroll)}
            className="h-7 w-7 p-0 text-gray-400 hover:text-white hover:bg-white/10"
          >
            {isAutoScroll ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => containerRef.current?.scrollTo({ top: containerRef.current.scrollHeight, behavior: 'smooth' })}
            className="h-7 w-7 p-0 text-gray-400 hover:text-white hover:bg-white/10"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Terminal Content */}
      <div
        ref={containerRef}
        className="p-4 bg-[#0f0f12] max-h-80 overflow-y-auto font-mono text-xs"
        onMouseEnter={() => setIsAutoScroll(false)}
        onMouseLeave={() => setIsAutoScroll(true)}
      >
        {terminalLogs.map((log) => (
          <div key={log.id} className="group mb-4 last:mb-0">
            {/* Timestamp and type */}
            <div className="flex items-center gap-2 mb-1">
              <span className="text-gray-600">
                [{formatDateTime(log.timestamp).split(',')[1]?.trim() || formatDateTime(log.timestamp)}]
              </span>
              <span className={cn('font-semibold', getLogColor(log.type))}>
                {getLogPrefix(log.type)}
              </span>
              <button
                onClick={() => handleCopy(log.content, log.id)}
                className="opacity-0 group-hover:opacity-100 transition-opacity ml-auto"
              >
                <Copy className={cn('h-3 w-3', copiedId === log.id ? 'text-green-400' : 'text-gray-500 hover:text-gray-300')} />
              </button>
            </div>

            {/* Content */}
            <pre
              className={cn(
                'pl-4 border-l-2 whitespace-pre-wrap break-words',
                log.type === 'request' && 'border-info text-gray-300',
                log.type === 'response' && 'border-success text-gray-300',
                log.type === 'error' && 'border-error text-error',
                log.type === 'info' && 'border-gray-600 text-gray-400'
              )}
            >
              {/* Try to format as JSON if possible */}
              {(() => {
                try {
                  const parsed = JSON.parse(log.content);
                  return (
                    <code>
                      {JSON.stringify(parsed, null, 2).split('\n').map((line, i) => (
                        <span key={i} className="block">
                          {line.includes('"jsonrpc"') && <span className="text-purple-400">{line}</span>}
                          {line.includes('"id"') && <span className="text-yellow-400">{line}</span>}
                          {line.includes('"method"') && <span className="text-blue-400">{line}</span>}
                          {line.includes('"result"') && <span className="text-green-400">{line}</span>}
                          {line.includes('"error"') && <span className="text-red-400">{line}</span>}
                          {line.includes('"params"') && <span className="text-cyan-400">{line}</span>}
                          {!line.includes('"jsonrpc"') &&
                            !line.includes('"id"') &&
                            !line.includes('"method"') &&
                            !line.includes('"result"') &&
                            !line.includes('"error"') &&
                            !line.includes('"params"') && line}
                        </span>
                      ))}
                    </code>
                  );
                } catch {
                  return <code>{log.content}</code>;
                }
              })()}
            </pre>
          </div>
        ))}
      </div>

      {/* Status Bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#1a1a1f] border-t border-[#2d2d35] text-xs text-gray-500">
        <span>
          {isAutoScroll ? 'Auto-scrolling enabled' : 'Auto-scroll paused (hover to pause)'}
        </span>
        <span>MCP Protocol v1.0</span>
      </div>
    </Card>
  );
}
