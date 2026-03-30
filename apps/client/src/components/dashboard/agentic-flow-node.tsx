"use client";

import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { Handle, Position, type NodeProps } from "reactflow";
import { cn } from "@/lib/utils";
import type { AgentFlowNodeData } from "@/types/agentic-flow";

const phaseTheme: Record<
  AgentFlowNodeData["phase"],
  { badge: string; shell: string; title: string }
> = {
  start: {
    badge: "bg-info-light text-info",
    shell: "border-info/30",
    title: "text-info",
  },
  "context-analysis": {
    badge: "bg-primary-light text-primary",
    shell: "border-primary/35",
    title: "text-primary",
  },
  "required-api": {
    badge: "bg-info-light text-info",
    shell: "border-info/40",
    title: "text-info",
  },
  planning: {
    badge: "bg-primary-light text-primary",
    shell: "border-primary/40",
    title: "text-primary",
  },
  "connector-agent": {
    badge: "bg-surface-tertiary text-content-primary",
    shell: "border-border",
    title: "text-content-primary",
  },
  execution: {
    badge: "bg-warning-light text-warning",
    shell: "border-warning/40",
    title: "text-warning",
  },
  orchestrator: {
    badge: "bg-warning-light text-warning",
    shell: "border-warning/35",
    title: "text-warning",
  },
  end: {
    badge: "bg-success-light text-success",
    shell: "border-success/35",
    title: "text-success",
  },
};

const statusLabel: Record<AgentFlowNodeData["status"], string> = {
  waiting: "WAITING",
  working: "WORKING",
  done: "DONE",
  failed: "ERROR / FAILED",
};

function StatusIndicator({ status }: { status: AgentFlowNodeData["status"] }) {
  if (status === "working") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-warning-light px-2.5 py-1 text-[10px] font-semibold text-warning">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {statusLabel[status]}
      </span>
    );
  }

  if (status === "done") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-success-light px-2.5 py-1 text-[10px] font-semibold text-success">
        <CheckCircle2 className="h-3.5 w-3.5" />
        {statusLabel[status]}
      </span>
    );
  }

  if (status === "failed") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-error-light px-2.5 py-1 text-[10px] font-semibold text-error">
        <AlertTriangle className="h-3.5 w-3.5" />
        {statusLabel[status]}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-warning-light px-2.5 py-1 text-[10px] font-semibold text-warning">
      <span className="h-2 w-2 animate-pulse rounded-full bg-warning" />
      {statusLabel[status]}
    </span>
  );
}

export function AgenticFlowNode({ data }: NodeProps<AgentFlowNodeData>) {
  const theme = phaseTheme[data.phase];

  return (
    <>
      <Handle
        type="target"
        position={Position.Left}
        className="!h-3 !w-3 !cursor-crosshair !rounded-full !border-2 !border-surface-primary !bg-info"
      />
      <div
        className={cn(
          "w-[260px] rounded-xl border bg-surface-primary p-3 shadow-sm transition-colors",
          theme.shell,
          data.status === "working" && "shadow-md",
        )}
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <span
            className={cn(
              "rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wide",
              theme.badge,
            )}
          >
            L{data.level}
          </span>
          <StatusIndicator status={data.status} />
        </div>

        <p className={cn("text-sm font-semibold", theme.title)}>{data.label}</p>
        <p className="mt-1 text-xs text-content-secondary">
          {data.description}
        </p>

        {data.detail && (
          <p
            className={cn(
              "mt-2 rounded-md px-2 py-1 text-[11px]",
              data.status === "failed"
                ? "bg-error-light text-error"
                : "bg-surface-secondary text-content-secondary",
            )}
          >
            {data.detail}
          </p>
        )}
      </div>
      <Handle
        type="source"
        position={Position.Right}
        className="!h-3 !w-3 !cursor-crosshair !rounded-full !border-2 !border-surface-primary !bg-primary"
      />
    </>
  );
}
