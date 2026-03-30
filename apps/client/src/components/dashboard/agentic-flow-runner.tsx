"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  Play,
  RotateCcw,
  ScrollText,
  Square,
  Workflow,
} from "lucide-react";
import ReactFlow, {
  Background,
  Controls,
  MarkerType,
  Panel,
  addEdge,
  applyEdgeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node as FlowNode,
  type NodeChange,
  type XYPosition,
} from "reactflow";
import "reactflow/dist/style.css";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { ConnectorCredentialsModal } from "@/components/integrations/connector-credentials-modal";
import { workflowsApi } from "@/lib/api";
import {
  createAgentFlowGraph,
  createAgentFlowPlan,
  createInitialRuntimeMap,
  executeAgentFlow,
} from "@/lib/agentic-flow";
import { cn } from "@/lib/utils";
import { useIntegrations } from "@/context/integrations-context";
import type { Integration, IntegrationCredentials, ServiceId } from "@/types";
import type {
  AgenticToolDefinition,
  AgentFlowPlan,
  AgentFlowRequestPayload,
  AgentRunState,
  AgentStepRuntime,
  AgentStatusUpdate,
  AgentToolAuditUpdate,
} from "@/types/agentic-flow";
import { AgenticFlowNode } from "./agentic-flow-node";

const SAMPLE_PROMPT = "Connect all the connectors and report readiness.";

const runStateLabel: Record<AgentRunState, string> = {
  idle: "Idle",
  planning: "Planning",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  stopped: "Stopped",
  blocked: "Blocked - Connect Required Services",
};

const runStateClass: Record<AgentRunState, string> = {
  idle: "bg-surface-secondary text-content-secondary",
  planning: "bg-info-light text-info",
  running: "bg-warning-light text-warning",
  completed: "bg-success-light text-success",
  failed: "bg-error-light text-error",
  stopped: "bg-surface-tertiary text-content-secondary",
  blocked: "bg-warning-light text-warning",
};

const auditStageClass: Record<AgentToolAuditUpdate["stage"], string> = {
  request: "bg-info-light text-info",
  response: "bg-success-light text-success",
  error: "bg-error-light text-error",
};

function formatAuditValue(value: unknown): string {
  if (value === undefined) {
    return "";
  }

  let formatted = "";
  try {
    formatted = JSON.stringify(value, null, 2);
  } catch {
    formatted = String(value);
  }

  if (formatted.length <= 900) {
    return formatted;
  }

  return `${formatted.slice(0, 900)}\n...truncated`;
}

const nodeTypes = {
  agentStatus: AgenticFlowNode,
};

const TOOL_INPUT_FALLBACKS: Record<string, Record<string, string>> = {
  "jira.create_issue": {
    project: "string",
    title: "string",
    summary: "string",
    description: "string",
    issue_type: "string",
  },
  "jira.get_issue": {
    issueKey: "string",
    issue_key: "string",
  },
  "jira.search_issues": {
    jql: "string",
    maxResults: "number",
  },
  "jira.get_issues": {
    jql: "string",
    maxResults: "number",
  },
  "jira.update_issue": {
    issueKey: "string",
    fields: "object",
  },
  "github.create_branch": {
    repo: "string",
    branch: "string",
    branch_name: "string",
    base: "string",
    base_branch: "string",
  },
  "github.create_pr": {
    repo: "string",
    title: "string",
    body: "string",
    head: "string",
    base: "string",
  },
  "github.create_pull_request": {
    repo: "string",
    title: "string",
    body: "string",
    head: "string",
    base: "string",
  },
  "github.create_issue": {
    repo: "string",
    title: "string",
    body: "string",
  },
  "github.get_repository": {
    repo: "string",
  },
};

function getToolNameVariants(serviceId: ServiceId, toolName: string): string[] {
  const variants = new Set<string>([toolName]);

  if (serviceId === "github") {
    if (toolName.endsWith(".create_pr")) {
      variants.add(`${serviceId}.create_pull_request`);
    }
    if (toolName.endsWith(".create_pull_request")) {
      variants.add(`${serviceId}.create_pr`);
    }
  }

  if (serviceId === "jira") {
    if (toolName.endsWith(".search_issues")) {
      variants.add(`${serviceId}.get_issues`);
    }
    if (toolName.endsWith(".get_issues")) {
      variants.add(`${serviceId}.search_issues`);
    }
  }

  return Array.from(variants);
}

function inferToolInputs(
  inputSchema: Record<string, unknown>,
  toolName?: string,
): Record<string, string> {
  const rawProperties =
    inputSchema &&
    typeof inputSchema === "object" &&
    "properties" in inputSchema &&
    inputSchema.properties &&
    typeof inputSchema.properties === "object" &&
    !Array.isArray(inputSchema.properties)
      ? (inputSchema.properties as Record<string, unknown>)
      : {};

  const inputs: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawProperties)) {
    const normalizedKey = key.trim();
    if (!normalizedKey) {
      continue;
    }

    const typeValue =
      value &&
      typeof value === "object" &&
      "type" in value &&
      typeof value.type === "string"
        ? value.type.trim()
        : "string";

    inputs[normalizedKey] = typeValue || "string";
  }

  if (Object.keys(inputs).length > 0) {
    return inputs;
  }

  if (toolName) {
    const fallback = TOOL_INPUT_FALLBACKS[toolName.trim().toLowerCase()];
    if (fallback) {
      return { ...fallback };
    }
  }

  return inputs;
}

export function AgenticFlowRunner() {
  const { integrations, connectIntegration } = useIntegrations();
  const abortRef = useRef<AbortController | null>(null);
  const integrationsRef = useRef(integrations);
  const modalResolveRef = useRef<
    ((result: ConnectorResolution) => void) | null
  >(null);

  const [prompt, setPrompt] = useState(SAMPLE_PROMPT);
  const [runState, setRunState] = useState<AgentRunState>("idle");
  const [plan, setPlan] = useState<AgentFlowPlan | null>(null);
  const [runtime, setRuntime] = useState<Record<string, AgentStepRuntime>>({});
  const [nodePositionOverrides, setNodePositionOverrides] = useState<
    Record<string, XYPosition>
  >({});
  const [manualEdges, setManualEdges] = useState<Edge[]>([]);
  const [pendingConnectorId, setPendingConnectorId] =
    useState<ServiceId | null>(null);
  const [auditTrail, setAuditTrail] = useState<AgentToolAuditUpdate[]>([]);

  useEffect(() => {
    integrationsRef.current = integrations;
  }, [integrations]);

  const pendingConnector = useMemo(() => {
    if (!pendingConnectorId) {
      return null;
    }
    return (
      integrations.find(
        (integration) => integration.id === pendingConnectorId,
      ) ?? null
    );
  }, [integrations, pendingConnectorId]);

  const graph = useMemo(() => {
    if (!plan) {
      return { nodes: [], edges: [] };
    }
    return createAgentFlowGraph(plan, runtime, {
      nodePositionOverrides,
      additionalEdges: manualEdges,
    });
  }, [manualEdges, nodePositionOverrides, plan, runtime]);

  const statusStats = useMemo(() => {
    const values = Object.values(runtime);
    return {
      waiting: values.filter((item) => item.status === "waiting").length,
      working: values.filter((item) => item.status === "working").length,
      done: values.filter((item) => item.status === "done").length,
      failed: values.filter((item) => item.status === "failed").length,
    };
  }, [runtime]);

  const totalAgents = plan ? plan.steps.length : 0;

  const handleStatusUpdate = useCallback((update: AgentStatusUpdate) => {
    setRuntime((prev) => ({
      ...prev,
      [update.nodeId]: {
        status: update.status,
        detail: update.detail,
      },
    }));
  }, []);

  const handleNodesChange = useCallback((changes: NodeChange[]) => {
    setNodePositionOverrides((prev) => {
      let next = prev;

      for (const change of changes) {
        if (change.type === "position" && change.position) {
          if (next === prev) {
            next = { ...prev };
          }
          next[change.id] = change.position;
        }
      }

      return next;
    });
  }, []);

  const handleNodeDragStop = useCallback((_: unknown, node: FlowNode) => {
    setNodePositionOverrides((prev) => ({
      ...prev,
      [node.id]: node.position,
    }));
  }, []);

  const handleConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) {
      return;
    }

    setManualEdges((prev) =>
      addEdge(
        {
          ...connection,
          id: `manual-edge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          type: "smoothstep",
          style: {
            stroke: "#64748b",
            strokeWidth: 2,
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: "#64748b",
          },
        },
        prev,
      ),
    );
  }, []);

  const handleEdgesChange = useCallback((changes: EdgeChange[]) => {
    setManualEdges((prev) => applyEdgeChanges(changes, prev));
  }, []);

  const resolveConnectorModal = useCallback((result: ConnectorResolution) => {
    const resolver = modalResolveRef.current;
    modalResolveRef.current = null;
    setPendingConnectorId(null);
    resolver?.(result);
  }, []);

  const resolveConnectorConnection = useCallback((integration: Integration) => {
    return new Promise<ConnectorResolution>((resolve) => {
      modalResolveRef.current = resolve;
      setPendingConnectorId(integration.id);
    });
  }, []);

  const handleConnectorModalClose = useCallback(() => {
    resolveConnectorModal("cancelled");
  }, [resolveConnectorModal]);

  const handleConnectorCredentialsSave = useCallback(
    async (id: ServiceId, credentials: IntegrationCredentials) => {
      await connectIntegration(id, credentials);

      // Keep a live local snapshot in sync so the running executor sees the
      // connected state immediately, without waiting for a rerender.
      integrationsRef.current = integrationsRef.current.map((integration) =>
        integration.id === id
          ? {
              ...integration,
              status: "connected",
              enabled: true,
              credentials,
              lastSynced: new Date(),
            }
          : integration,
      );

      resolveConnectorModal("connected");
    },
    [connectIntegration, resolveConnectorModal],
  );

  const handleStop = useCallback(() => {
    if (!abortRef.current) {
      return;
    }

    abortRef.current.abort();
    abortRef.current = null;

    setRuntime((prev) => {
      const next = { ...prev };
      for (const [stepId, stepRuntime] of Object.entries(next)) {
        if (stepRuntime.status === "working") {
          next[stepId] = {
            status: "failed",
            detail: "Stopped manually",
          };
        }
      }
      return next;
    });

    resolveConnectorModal("cancelled");

    setRunState("stopped");
  }, [resolveConnectorModal]);

  const handleReset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    resolveConnectorModal("cancelled");
    setNodePositionOverrides({});
    setManualEdges([]);
    setPlan(null);
    setRuntime({});
    setAuditTrail([]);
    setRunState("idle");
  }, [resolveConnectorModal]);

  const handleRun = useCallback(async () => {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      return;
    }

    abortRef.current?.abort();
    abortRef.current = null;
    resolveConnectorModal("cancelled");
    setNodePositionOverrides({});
    setManualEdges([]);
    setAuditTrail([]);

    setRunState("planning");

    const controller = new AbortController();
    abortRef.current = controller;

    const requestPayload: AgentFlowRequestPayload = {
      prompt: trimmedPrompt,
      integrations: integrations.map((integration) => ({
        id: integration.id,
        name: integration.name,
        status: integration.status,
        enabled: integration.enabled,
        tools: integration.tools.map((tool) => tool.name),
      })),
      availableTools: integrations.reduce<
        Record<string, AgenticToolDefinition>
      >((acc, integration) => {
        for (const tool of integration.tools) {
          const toolName = tool.name.includes(".")
            ? tool.name
            : `${integration.id}.${tool.name}`;
          const toolInputs = inferToolInputs(tool.inputSchema, toolName);
          const toolVariants = getToolNameVariants(integration.id, toolName);

          for (const variantName of toolVariants) {
            acc[variantName] = {
              description: tool.description,
              inputs: toolInputs,
            };
          }
        }

        return acc;
      }, {}),
    };

    const response = await workflowsApi.generateAgenticFlow(
      requestPayload,
      controller.signal,
    );

    if (controller.signal.aborted) {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
      setRunState("stopped");
      return;
    }

    const nextPlan =
      response.success && response.data
        ? response.data
        : createAgentFlowPlan(trimmedPrompt, integrations);

    setPlan(nextPlan);
    setRuntime(createInitialRuntimeMap(nextPlan));

    setRunState("running");

    const result = await executeAgentFlow({
      plan: nextPlan,
      prompt: trimmedPrompt,
      integrations,
      signal: controller.signal,
      onStatusUpdate: handleStatusUpdate,
      onToolAudit: (auditEvent) => {
        setAuditTrail((prev) => [auditEvent, ...prev].slice(0, 120));
      },
      getCurrentIntegration: (serviceId) =>
        integrationsRef.current.find(
          (integration) => integration.id === serviceId,
        ),
      resolveConnectorConnection,
    });

    if (abortRef.current === controller) {
      abortRef.current = null;
    }

    setRunState(result);
  }, [
    handleStatusUpdate,
    integrations,
    prompt,
    resolveConnectorConnection,
    resolveConnectorModal,
  ]);

  return (
    <Card padding="lg" className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-content-primary">
            <Workflow className="h-5 w-5 text-primary" />
            Agentic Flow Runtime
          </h2>
          <p className="mt-1 text-sm text-content-secondary">
            Prompt-driven, left-to-right execution map with real-time agent
            phases and branch-level state updates.
          </p>
        </div>

        <span
          className={cn(
            "rounded-full px-3 py-1 text-xs font-semibold",
            runStateClass[runState],
          )}
        >
          {runStateLabel[runState]}
        </span>
      </div>

      <div className="space-y-3">
        <Textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          label="LLM Query"
          placeholder="Describe what agents should do..."
          className="min-h-[96px]"
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              void handleRun();
            }
          }}
        />

        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={handleRun}
            isLoading={runState === "planning" || runState === "running"}
            leftIcon={<Play className="h-4 w-4" />}
          >
            Generate and Run Flow
          </Button>

          <Button
            variant="outline"
            onClick={handleStop}
            disabled={runState !== "running" && runState !== "planning"}
            leftIcon={<Square className="h-4 w-4" />}
          >
            Stop
          </Button>

          <Button
            variant="ghost"
            onClick={handleReset}
            disabled={!plan}
            leftIcon={<RotateCcw className="h-4 w-4" />}
          >
            Reset
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-surface-secondary p-3 text-xs md:grid-cols-4">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-warning" />
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

      <div className="h-[560px] overflow-hidden rounded-xl border border-border bg-surface-secondary">
        {plan ? (
          <ReactFlow
            nodes={graph.nodes}
            edges={graph.edges}
            onNodesChange={handleNodesChange}
            onNodeDragStop={handleNodeDragStop}
            onConnect={handleConnect}
            onEdgesChange={handleEdgesChange}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.25 }}
            panOnDrag={[2]}
            selectionOnDrag
            nodesDraggable
            nodesConnectable
            elementsSelectable
            proOptions={{ hideAttribution: true }}
          >
            <Background color="#d1d5db" gap={18} size={1} />
            <Controls showInteractive={false} />
            <Panel
              position="top-right"
              className="rounded-md border border-border bg-surface-primary px-3 py-2 text-xs shadow-sm"
            >
              <p className="font-semibold text-content-primary">
                Agents: {totalAgents}
              </p>
              <p className="text-content-secondary">
                Connectors in level 2:{" "}
                {plan.steps.filter((step) => step.level === 2).length}
              </p>
            </Panel>
          </ReactFlow>
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center">
            <div className="max-w-md space-y-2">
              <p className="text-base font-semibold text-content-primary">
                Run an LLM query to build and execute the live agent flow
              </p>
              <p className="text-sm text-content-secondary">
                The system creates an agent graph and updates each phase in real
                time: waiting, working, done, and failure.
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-border bg-surface-secondary p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-content-primary">
            <ScrollText className="h-4 w-4 text-primary" />
            Execution Audit
          </h3>
          <span className="text-xs text-content-secondary">
            {auditTrail.length} event{auditTrail.length === 1 ? "" : "s"}
          </span>
        </div>

        {auditTrail.length > 0 ? (
          <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
            {auditTrail.map((entry) => (
              <div
                key={entry.id}
                className="rounded-lg border border-border bg-surface-primary p-3"
              >
                <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 font-semibold uppercase",
                      auditStageClass[entry.stage],
                    )}
                  >
                    {entry.stage}
                  </span>
                  <span className="font-medium text-content-primary">
                    {entry.tool}
                  </span>
                  <span className="text-content-secondary">
                    on {entry.serviceId}
                  </span>
                  <span className="text-content-tertiary">
                    {new Date(entry.timestamp).toLocaleTimeString()}
                  </span>
                </div>

                {entry.error ? (
                  <p className="mb-2 text-xs text-error">{entry.error}</p>
                ) : null}

                <div className="grid gap-2 md:grid-cols-2">
                  {entry.request !== undefined ? (
                    <div>
                      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-content-secondary">
                        Request
                      </p>
                      <pre className="max-h-40 overflow-auto rounded-md bg-surface-tertiary p-2 text-[11px] text-content-secondary">
                        {formatAuditValue(entry.request)}
                      </pre>
                    </div>
                  ) : null}

                  {entry.response !== undefined ? (
                    <div>
                      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-content-secondary">
                        Response
                      </p>
                      <pre className="max-h-40 overflow-auto rounded-md bg-surface-tertiary p-2 text-[11px] text-content-secondary">
                        {formatAuditValue(entry.response)}
                      </pre>
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-content-secondary">
            Tool-level request and response events appear here as connectors
            execute.
          </p>
        )}
      </div>

      <ConnectorCredentialsModal
        integration={pendingConnector}
        isOpen={Boolean(pendingConnector)}
        onClose={handleConnectorModalClose}
        onSave={handleConnectorCredentialsSave}
      />
    </Card>
  );
}

type ConnectorResolution = "connected" | "cancelled" | "failed";
