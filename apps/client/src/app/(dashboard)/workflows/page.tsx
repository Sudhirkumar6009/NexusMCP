"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import ReactFlow, {
  Background,
  Controls,
  MarkerType,
  Panel,
  type Edge,
  type Node,
} from "reactflow";
import "reactflow/dist/style.css";
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Clock3,
  Loader2,
  Search,
} from "lucide-react";

import { workflowsApi, type Workflow } from "@/lib/api";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
} from "@/components/ui";
import { AgenticFlowNode } from "@/components/dashboard/agentic-flow-node";
import type { AgentFlowNodeData } from "@/types/agentic-flow";

type WorkflowGraphProps = {
  workflow: Workflow;
};

type StatusVariant =
  | "default"
  | "success"
  | "error"
  | "warning"
  | "info"
  | "primary";

const WORKFLOW_PAGE_SIZE = 3;

const nodeTypes = {
  agentStatus: AgenticFlowNode,
};

function mapNodePhase(
  nodeType: Workflow["nodes"][number]["type"],
): AgentFlowNodeData["phase"] {
  if (nodeType === "trigger") return "start";
  if (nodeType === "condition") return "planning";
  if (nodeType === "output") return "end";
  return "connector-agent";
}

function mapNodeStatus(
  status?: Workflow["nodes"][number]["status"],
): AgentFlowNodeData["status"] {
  if (status === "running") return "working";
  if (status === "completed") return "done";
  if (status === "failed") return "failed";
  return "waiting";
}

function edgeStrokeByStatus(status: AgentFlowNodeData["status"]): string {
  if (status === "failed") return "#ef4444";
  if (status === "done") return "#22c55e";
  if (status === "working") return "#f59e0b";
  return "#9ca3af";
}

function toReactFlowNodes(workflow: Workflow): Node[] {
  const sourceNodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];

  if (sourceNodes.length === 0) {
    return [
      {
        id: `empty-${workflow.id}`,
        type: "agentStatus",
        position: { x: 140, y: 90 },
        draggable: false,
        data: {
          label: "No workflow nodes available for this run",
          description: "This workflow has no generated steps yet.",
          phase: "start",
          level: 1,
          status: "waiting",
        },
      },
    ];
  }

  const sortedX = Array.from(
    new Set(
      sourceNodes
        .map((node) => node.position?.x)
        .filter((value): value is number => typeof value === "number")
        .sort((a, b) => a - b),
    ),
  );

  return sourceNodes.map((node, index) => {
    const hasValidPosition =
      node.position &&
      typeof node.position.x === "number" &&
      typeof node.position.y === "number";

    const levelFromPosition =
      hasValidPosition && sortedX.length > 0
        ? Math.max(1, sortedX.findIndex((x) => x === node.position.x) + 1)
        : Math.floor(index / 3) + 1;

    const nodeStatus = mapNodeStatus(node.status);

    return {
      id: node.id,
      type: "agentStatus",
      position: hasValidPosition
        ? node.position
        : {
            x: 120 + (index % 3) * 210,
            y: 60 + Math.floor(index / 3) * 130,
          },
      draggable: false,
      data: {
        label: node.label || node.operation || "Step",
        description: `${node.service || "system"}${node.operation ? ` · ${node.operation}` : ""}`,
        phase: mapNodePhase(node.type),
        level: levelFromPosition,
        status: nodeStatus,
        detail: node.error,
      },
    };
  });
}

function toReactFlowEdges(workflow: Workflow): Edge[] {
  const sourceEdges = Array.isArray(workflow.edges) ? workflow.edges : [];
  const statusByNodeId = new Map(
    (workflow.nodes || []).map((node) => [node.id, mapNodeStatus(node.status)]),
  );

  return sourceEdges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: "smoothstep",
    animated: (statusByNodeId.get(edge.source) ?? "waiting") === "working",
    style: {
      stroke: edgeStrokeByStatus(statusByNodeId.get(edge.source) ?? "waiting"),
      strokeWidth: 2,
    },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: edgeStrokeByStatus(statusByNodeId.get(edge.source) ?? "waiting"),
    },
  }));
}

function statusVariant(status: Workflow["status"]): StatusVariant {
  if (status === "completed") return "success";
  if (status === "failed") return "error";
  if (status === "running") return "info";
  if (status === "paused") return "warning";
  if (status === "ready") return "primary";
  return "default";
}

function WorkflowGraph({ workflow }: WorkflowGraphProps) {
  const [nodes] = useState<Node[]>(() => toReactFlowNodes(workflow));
  const [edges] = useState<Edge[]>(() => toReactFlowEdges(workflow));
  const statusStats = useMemo(() => {
    const sourceNodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];
    return sourceNodes.reduce(
      (acc, node) => {
        const status = mapNodeStatus(node.status);
        if (status === "done") acc.done += 1;
        else if (status === "failed") acc.failed += 1;
        else if (status === "working") acc.working += 1;
        else acc.waiting += 1;
        return acc;
      },
      { waiting: 0, working: 0, done: 0, failed: 0 },
    );
  }, [workflow.nodes]);

  const connectorCount = useMemo(() => {
    const sourceNodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];
    return sourceNodes.filter((node) => node.type === "action").length;
  }, [workflow.nodes]);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-surface-secondary p-3 text-xs md:grid-cols-4">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-warning" />
          WAITING: {statusStats.waiting}
        </div>
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-warning" />
          WORKING: {statusStats.working}
        </div>
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-3.5 w-3.5 text-success" />
          DONE: {statusStats.done}
        </div>
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-error" />
          ERROR: {statusStats.failed}
        </div>
      </div>

      <div className="h-80 w-full overflow-hidden rounded-lg border border-border bg-surface-secondary">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.25 }}
          minZoom={0.4}
          maxZoom={1.2}
          defaultViewport={{ x: 0, y: 0, zoom: 0.7 }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#d1d5db" gap={18} size={1} />
          <Controls showInteractive={false} />
          <Panel
            position="top-right"
            className="rounded-md border border-border bg-surface-primary px-3 py-2 text-xs shadow-sm"
          >
            <p className="font-semibold text-content-primary">
              Agents: {nodes.length}
            </p>
            <p className="text-content-secondary">
              Connectors: {connectorCount}
            </p>
          </Panel>
        </ReactFlow>
      </div>
    </div>
  );
}

export default function WorkflowsPage() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [search, setSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [totalWorkflows, setTotalWorkflows] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadWorkflows = useCallback(
    async ({
      page = 1,
      query = "",
    }: {
      page?: number;
      query?: string;
    } = {}) => {
      setIsLoading(true);

      const safePage = Math.max(page, 1);
      const offset = (safePage - 1) * WORKFLOW_PAGE_SIZE;

      const response = await workflowsApi.list({
        limit: WORKFLOW_PAGE_SIZE,
        offset,
        search: query || undefined,
      });

      if (!response.success || !response.data) {
        setError(response.error || "Failed to load workflows");
        setWorkflows([]);
        setTotalWorkflows(0);
        setIsLoading(false);
        return;
      }

      const pagination = (
        response as unknown as {
          pagination?: { hasMore?: boolean; total?: number };
        }
      ).pagination;

      const chunk = response.data;
      const hasMore =
        typeof pagination?.hasMore === "boolean"
          ? pagination.hasMore
          : chunk.length === WORKFLOW_PAGE_SIZE;
      const resolvedTotal =
        typeof pagination?.total === "number"
          ? pagination.total
          : offset + chunk.length + (hasMore ? 1 : 0);

      setWorkflows(chunk);
      setTotalWorkflows(resolvedTotal);
      setError(null);
      setIsLoading(false);
    },
    [],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setCurrentPage(1);
      void loadWorkflows({
        page: 1,
        query: search.trim(),
      });
    }, 300);

    return () => {
      window.clearTimeout(timer);
    };
  }, [loadWorkflows, search]);

  const totalPages = Math.max(1, Math.ceil(totalWorkflows / WORKFLOW_PAGE_SIZE));
  const showingFrom =
    workflows.length === 0 ? 0 : (currentPage - 1) * WORKFLOW_PAGE_SIZE + 1;
  const showingTo =
    workflows.length === 0 ? 0 : Math.min(showingFrom + workflows.length - 1, totalWorkflows);

  const goToPage = (nextPage: number) => {
    const normalizedPage = Math.min(Math.max(nextPage, 1), totalPages);
    if (normalizedPage === currentPage) {
      return;
    }

    setCurrentPage(normalizedPage);
    void loadWorkflows({ page: normalizedPage, query: search.trim() });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="mb-0">
          <div>
            <CardTitle>Workflows</CardTitle>
            <CardDescription>
              Search generated workflow history from PostgreSQL with flow
              visualization.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search workflow by name or prompt"
              isSearch
              leftIcon={<Search className="h-4 w-4" />}
            />
            <Button
              variant="outline"
              onClick={() =>
                void loadWorkflows({
                  page: currentPage,
                  query: search.trim(),
                })
              }
              isLoading={isLoading}
            >
              Refresh
            </Button>
          </div>
        </CardContent>
      </Card>

      {error ? (
        <Card className="border-error/40">
          <CardContent className="py-4">
            <p className="flex items-center gap-2 text-sm text-error">
              <AlertCircle className="h-4 w-4" />
              {error}
            </p>
          </CardContent>
        </Card>
      ) : null}

      {isLoading ? (
        <Card>
          <CardContent className="flex items-center gap-2 py-8 text-content-secondary">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading workflows...
          </CardContent>
        </Card>
      ) : null}

      {!isLoading && workflows.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-content-secondary">
            No workflows found for your search.
          </CardContent>
        </Card>
      ) : null}

      <div className="space-y-5">
        {workflows.map((workflow) => {
          return (
            <Card key={workflow.id} className="border-border">
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">{workflow.name}</CardTitle>
                    <CardDescription className="mt-1 flex items-center gap-2">
                      <Badge variant={statusVariant(workflow.status)} dot>
                        {workflow.status}
                      </Badge>
                      <span className="inline-flex items-center gap-1">
                        <Clock3 className="h-3.5 w-3.5" />
                        Updated {new Date(workflow.updatedAt).toLocaleString()}
                      </span>
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="space-y-4">
                <div>
                  <p className="mb-2 text-sm font-medium text-content-primary">
                    Workflow Module
                  </p>
                  <WorkflowGraph workflow={workflow} />
                </div>
              </CardContent>
            </Card>
          );
        })}

        {!isLoading && totalWorkflows > 0 ? (
          <div className="flex items-center justify-between border-t border-border px-4 py-3">
            <p className="text-sm text-content-secondary">
              Showing {showingFrom} to {showingTo} of {totalWorkflows} workflows
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => goToPage(currentPage - 1)}
                disabled={currentPage === 1 || isLoading}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="px-2 text-sm text-content-primary">
                Page {currentPage} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => goToPage(currentPage + 1)}
                disabled={currentPage >= totalPages || isLoading}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
