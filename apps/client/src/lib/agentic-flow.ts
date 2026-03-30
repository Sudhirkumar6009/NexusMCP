import { generateId, randomBetween, sleep } from "@/lib/utils";
import { mcpApi } from "@/lib/api";
import type { Integration, ServiceId } from "@/types";
import type {
  AgentFlowNodeData,
  AgentFlowPlan,
  AgentFlowStatus,
  AgentRunState,
  AgentStatusUpdate,
  AgentStepRuntime,
  AgentToolAuditUpdate,
} from "@/types/agentic-flow";
import { MarkerType, Position, type Edge, type Node } from "reactflow";

const NODE_X_OFFSET = 40;
const NODE_Y_OFFSET = 90;
const NODE_X_GAP = 320;
const NODE_Y_GAP = 144;

const CONNECTOR_KEYWORDS: Record<ServiceId, string[]> = {
  jira: ["jira", "ticket", "issue"],
  slack: ["slack", "message", "channel", "notify"],
  github: ["github", "pull request", "pr", "repository", "branch"],
  google_sheets: ["sheet", "sheets", "spreadsheet", "rows", "cells"],
  gmail: ["gmail", "email", "mail", "inbox"],
  aws: ["aws", "cloud", "lambda", "stack", "infrastructure"],
};

const ALL_CONNECTORS_REGEX =
  /all\s+(the\s+)?(connectors|integrations|services)|every\s+connector/i;
// Removed CONTEXT_FAILURE_REGEX - was causing false failures in production
const EXCLUSION_HINT_REGEX = /(skip|exclude|except|without|omit|ignore)/i;

const CONNECTOR_ALIASES: Record<ServiceId, string[]> = {
  jira: ["jira"],
  slack: ["slack"],
  github: ["github"],
  google_sheets: ["google sheets", "google_sheets", "sheets"],
  gmail: ["gmail", "google mail"],
  aws: ["aws", "amazon web services"],
};

type FlowGraph = {
  nodes: Node<AgentFlowNodeData>[];
  edges: Edge[];
};

type FlowGraphOptions = {
  nodePositionOverrides?: Record<string, { x: number; y: number }>;
  additionalEdges?: Edge[];
};

type ToolExecutionStep = {
  id: string;
  tool: string;
  arguments: Record<string, unknown>;
};

type AgentFlowStep = AgentFlowPlan["steps"][number];

const SERVICE_IDS: ServiceId[] = [
  "jira",
  "slack",
  "github",
  "google_sheets",
  "gmail",
  "aws",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toExecutionSteps(plan: AgentFlowPlan): ToolExecutionStep[] {
  // First check the new toolPlan field (from streamlined flow)
  if (plan.toolPlan && Array.isArray(plan.toolPlan.steps)) {
    return plan.toolPlan.steps.flatMap((rawStep) => {
      if (!isRecord(rawStep)) {
        return [];
      }

      const tool =
        typeof rawStep.tool === "string" && rawStep.tool.trim().length > 0
          ? rawStep.tool.trim()
          : "";
      if (!tool) {
        return [];
      }

      const stepId =
        typeof rawStep.id === "string" && rawStep.id.trim().length > 0
          ? rawStep.id.trim()
          : generateId();

      return [
        {
          id: stepId,
          tool,
          arguments: isRecord(rawStep.arguments)
            ? rawStep.arguments
            : ({} as Record<string, unknown>),
        },
      ];
    });
  }

  // Fallback to metadata.executionPlan for backward compatibility
  if (!isRecord(plan.metadata)) {
    return [];
  }

  const executionPlan = plan.metadata.executionPlan;
  if (!isRecord(executionPlan) || !Array.isArray(executionPlan.steps)) {
    return [];
  }

  return executionPlan.steps.flatMap((rawStep) => {
    if (!isRecord(rawStep)) {
      return [];
    }

    const tool =
      typeof rawStep.tool === "string" && rawStep.tool.trim().length > 0
        ? rawStep.tool.trim()
        : "";
    if (!tool) {
      return [];
    }

    const stepId =
      typeof rawStep.id === "string" && rawStep.id.trim().length > 0
        ? rawStep.id.trim()
        : generateId();

    return [
      {
        id: stepId,
        tool,
        arguments: isRecord(rawStep.arguments)
          ? rawStep.arguments
          : ({} as Record<string, unknown>),
      },
    ];
  });
}

function toServiceIdFromTool(toolName: string): ServiceId | null {
  const serviceCandidate = toolName.includes(".")
    ? toolName.split(".", 1)[0]
    : toolName.split("_", 1)[0];

  return SERVICE_IDS.includes(serviceCandidate as ServiceId)
    ? (serviceCandidate as ServiceId)
    : null;
}

function normalizedPrompt(prompt: string): string {
  return prompt.toLowerCase().trim();
}

function hasKeyword(prompt: string, keywords: string[]): boolean {
  return keywords.some((keyword) => prompt.includes(keyword));
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractExcludedServices(
  prompt: string,
  integrations: Integration[],
): Set<ServiceId> {
  const normalized = normalizedPrompt(prompt);

  if (!EXCLUSION_HINT_REGEX.test(normalized)) {
    return new Set<ServiceId>();
  }

  const exclusionWords = "skip|exclude|except|without|omit|ignore";
  const excluded = new Set<ServiceId>();

  for (const integration of integrations) {
    const aliases = new Set<string>([
      integration.id,
      integration.id.replace(/_/g, " "),
      integration.name.toLowerCase(),
      ...(CONNECTOR_ALIASES[integration.id] ?? []),
      ...(CONNECTOR_KEYWORDS[integration.id] ?? []),
    ]);

    for (const alias of Array.from(aliases)) {
      const escapedAlias = escapeRegex(alias);
      const excludeThenAlias = new RegExp(
        `\\b(?:${exclusionWords})\\b[^.\\n,;:]*\\b${escapedAlias}\\b`,
        "i",
      );
      const aliasThenExclude = new RegExp(
        `\\b${escapedAlias}\\b[^.\\n,;:]*\\b(?:${exclusionWords})\\b`,
        "i",
      );

      if (
        excludeThenAlias.test(normalized) ||
        aliasThenExclude.test(normalized)
      ) {
        excluded.add(integration.id);
        break;
      }
    }
  }

  return excluded;
}

function extractExplicitServices(
  prompt: string,
  integrations: Integration[],
  excluded: Set<ServiceId>,
): ServiceId[] {
  const normalized = normalizedPrompt(prompt);
  const explicit = new Set<ServiceId>();

  for (const integration of integrations) {
    if (excluded.has(integration.id)) {
      continue;
    }

    const aliases = new Set<string>([
      integration.id,
      integration.id.replace(/_/g, " "),
      integration.name.toLowerCase(),
      ...(CONNECTOR_ALIASES[integration.id] ?? []),
    ]);

    for (const alias of Array.from(aliases)) {
      const escapedAlias = escapeRegex(alias);
      const aliasRegex = new RegExp(`\\b${escapedAlias}\\b`, "i");
      if (aliasRegex.test(normalized)) {
        explicit.add(integration.id);
        break;
      }
    }
  }

  return integrations
    .map((integration) => integration.id)
    .filter((serviceId) => explicit.has(serviceId));
}

function chooseTargetServices(
  prompt: string,
  integrations: Integration[],
): ServiceId[] {
  const normalized = normalizedPrompt(prompt);
  const excluded = extractExcludedServices(prompt, integrations);

  const withoutExcluded = (serviceIds: ServiceId[]): ServiceId[] =>
    serviceIds.filter((serviceId) => !excluded.has(serviceId));

  if (ALL_CONNECTORS_REGEX.test(normalized)) {
    return withoutExcluded(integrations.map((integration) => integration.id));
  }

  const explicit = extractExplicitServices(prompt, integrations, excluded);
  if (explicit.length > 0) {
    return explicit;
  }

  const targeted = withoutExcluded(
    integrations
      .filter((integration) => {
        const keywords = CONNECTOR_KEYWORDS[integration.id] ?? [];
        return hasKeyword(normalized, keywords);
      })
      .map((integration) => integration.id),
  );

  if (targeted.length > 0) {
    return targeted;
  }

  const connected = withoutExcluded(
    integrations
      .filter((integration) => integration.status === "connected")
      .map((integration) => integration.id),
  );

  if (connected.length > 0) {
    return connected;
  }

  // Do not add arbitrary connectors when prompt does not imply any.
  return [];
}

function connectorUnavailableReason(integration?: Integration): string | null {
  if (!integration) {
    return "Connector is not available in this workspace.";
  }

  if (integration.status === "error") {
    return `${integration.name} has an error state and cannot execute.`;
  }

  return null;
}

// Disabled forced connector failure - was a test utility that could trigger in production
// Only enable this for explicit testing scenarios
function forcedConnectorFailureReason(_args: {
  prompt: string;
  integration: Integration;
}): string | null {
  // Forced failures disabled in production
  // To enable for testing, check for an explicit test flag
  return null;
}

function contextFailureReason(prompt: string): string | null {
  const normalized = normalizedPrompt(prompt);

  if (normalized.length < 8) {
    return "Prompt is too short for reliable agent planning.";
  }

  // Removed CONTEXT_FAILURE_REGEX check - was causing false failures
  // The regex matched words like "malformed" which could appear in legitimate prompts

  return null;
}

function sortedByLevel(steps: AgentFlowPlan["steps"]) {
  return [...steps].sort((a, b) => {
    if (a.level === b.level) {
      return a.label.localeCompare(b.label);
    }
    return a.level - b.level;
  });
}

export function createAgentFlowPlan(
  prompt: string,
  integrations: Integration[],
): AgentFlowPlan {
  const planId = generateId();
  const targetServiceIds = chooseTargetServices(prompt, integrations);
  const targetIntegrations = targetServiceIds
    .map((id) => integrations.find((integration) => integration.id === id))
    .filter((integration): integration is Integration => Boolean(integration));

  const startId = `start-${planId}`;
  const contextId = `context-${planId}`;
  const requiredApiId = `required-api-${planId}`;
  const mergeId = `merge-${planId}`;
  const endId = `end-${planId}`;

  // Check which services are connected vs disconnected
  const connectedServices = targetIntegrations.filter(i => i.status === "connected");
  const disconnectedServices = targetIntegrations.filter(i => i.status !== "connected");

  const connectorSteps = targetIntegrations.map((integration, index) => ({
    id: `connector-${integration.id}-${index}-${planId}`,
    label: `${integration.name} Agent`,
    description: integration.status === "connected" 
      ? `Execute ${integration.name} connector operations in parallel`
      : `${integration.name} - NOT CONNECTED (connect first)`,
    phase: "connector-agent" as const,
    level: 3,
    serviceId: integration.id,
    serviceName: integration.name,
  }));

  const steps: AgentFlowPlan["steps"] = [
    {
      id: startId,
      label: "Prompt Ingest",
      description: "Capture user query and initialize agent pipeline",
      phase: "start",
      level: 0,
    },
    {
      id: contextId,
      label: "Context Analysis Agent",
      description:
        "Analyze intent, dependencies, and required connector agents",
      phase: "context-analysis",
      level: 1,
    },
    {
      id: requiredApiId,
      label: "Required API Check",
      description: disconnectedServices.length > 0
        ? `Need to connect: ${disconnectedServices.map(i => i.name).join(", ")}`
        : `All ${targetIntegrations.length} required services ready`,
      phase: "required-api",
      level: 2,
    },
    ...connectorSteps,
    {
      id: mergeId,
      label: "Orchestration Agent",
      description:
        "Merge parallel branch results and validate workflow integrity",
      phase: "orchestrator",
      level: 4,
    },
    {
      id: endId,
      label: "Final Response Agent",
      description: "Return execution summary and completion signal",
      phase: "end",
      level: 5,
    },
  ];

  const edges: AgentFlowPlan["edges"] = [
    {
      id: `edge-${startId}-${contextId}`,
      source: startId,
      target: contextId,
    },
    {
      id: `edge-${contextId}-${requiredApiId}`,
      source: contextId,
      target: requiredApiId,
    },
  ];

  if (connectorSteps.length === 0) {
    edges.push({
      id: `edge-${requiredApiId}-${mergeId}`,
      source: requiredApiId,
      target: mergeId,
    });
  } else {
    for (const step of connectorSteps) {
      edges.push({
        id: `edge-${requiredApiId}-${step.id}`,
        source: requiredApiId,
        target: step.id,
      });
      edges.push({
        id: `edge-${step.id}-${mergeId}`,
        source: step.id,
        target: mergeId,
      });
    }
  }

  edges.push({
    id: `edge-${mergeId}-${endId}`,
    source: mergeId,
    target: endId,
  });

  return {
    id: planId,
    prompt,
    createdAt: new Date().toISOString(),
    steps,
    edges,
  };
}

export function createInitialRuntimeMap(plan: AgentFlowPlan) {
  return plan.steps.reduce<Record<string, AgentStepRuntime>>((acc, step) => {
    acc[step.id] = {
      status: "waiting",
    };
    return acc;
  }, {});
}

function edgeStrokeByStatus(status: AgentFlowStatus): string {
  if (status === "failed") return "#ef4444";
  if (status === "done") return "#22c55e";
  if (status === "working") return "#f59e0b";
  return "#9ca3af";
}

function isAbort(signal?: AbortSignal): boolean {
  return Boolean(signal?.aborted);
}

function emitToolAudit(
  onToolAudit: ((update: AgentToolAuditUpdate) => void) | undefined,
  payload: Omit<AgentToolAuditUpdate, "id" | "timestamp">,
) {
  if (!onToolAudit) {
    return;
  }

  onToolAudit({
    ...payload,
    id: generateId(),
    timestamp: new Date().toISOString(),
  });
}

export function createAgentFlowGraph(
  plan: AgentFlowPlan,
  runtime: Record<string, AgentStepRuntime>,
  options?: FlowGraphOptions,
): FlowGraph {
  const levels = new Map<number, AgentFlowPlan["steps"]>();

  for (const step of sortedByLevel(plan.steps)) {
    const levelSteps = levels.get(step.level) ?? [];
    levelSteps.push(step);
    levels.set(step.level, levelSteps);
  }

  const nodes: Node<AgentFlowNodeData>[] = [];

  levels.forEach((levelSteps, level) => {
    const levelHeight = (levelSteps.length - 1) * NODE_Y_GAP;
    const startY = NODE_Y_OFFSET - levelHeight / 2;

    levelSteps.forEach((step: AgentFlowStep, index: number) => {
      const runtimeStep = runtime[step.id] ?? { status: "waiting" as const };
      const positionOverride = options?.nodePositionOverrides?.[step.id];

      nodes.push({
        id: step.id,
        type: "agentStatus",
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        position: positionOverride ?? {
          x: NODE_X_OFFSET + level * NODE_X_GAP,
          y: startY + index * NODE_Y_GAP,
        },
        data: {
          label: step.label,
          description: step.description,
          phase: step.phase,
          level: step.level,
          status: runtimeStep.status,
          detail: runtimeStep.detail,
        },
      });
    });
  });

  const edges: Edge[] = plan.edges.map((edge) => {
    const sourceStatus = runtime[edge.source]?.status ?? "waiting";
    const stroke = edgeStrokeByStatus(sourceStatus);

    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: "smoothstep",
      animated: sourceStatus === "working",
      style: {
        stroke,
        strokeWidth: 2,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: stroke,
      },
    };
  });

  const additionalEdges = (options?.additionalEdges ?? []).filter(
    (edge) => !plan.edges.some((planEdge) => planEdge.id === edge.id),
  );

  return { nodes, edges: [...edges, ...additionalEdges] };
}

async function runSingleStep(args: {
  stepId: string;
  workMsRange: [number, number];
  successMessage: string;
  failureMessage?: string | null;
  signal?: AbortSignal;
  onStatusUpdate: (update: AgentStatusUpdate) => void;
}): Promise<AgentRunState | "done"> {
  if (isAbort(args.signal)) {
    return "stopped";
  }

  args.onStatusUpdate({
    nodeId: args.stepId,
    status: "working",
    detail: "Working...",
  });

  await sleep(randomBetween(args.workMsRange[0], args.workMsRange[1]));

  if (isAbort(args.signal)) {
    return "stopped";
  }

  if (args.failureMessage) {
    args.onStatusUpdate({
      nodeId: args.stepId,
      status: "failed",
      detail: args.failureMessage,
    });
    return "failed";
  }

  args.onStatusUpdate({
    nodeId: args.stepId,
    status: "done",
    detail: args.successMessage,
  });
  return "done";
}

export async function executeAgentFlow(args: {
  plan: AgentFlowPlan;
  prompt: string;
  integrations: Integration[];
  signal?: AbortSignal;
  onStatusUpdate: (update: AgentStatusUpdate) => void;
  onToolAudit?: (update: AgentToolAuditUpdate) => void;
  getCurrentIntegration?: (serviceId: ServiceId) => Integration | undefined;
  resolveConnectorConnection?: (
    integration: Integration,
  ) => Promise<"connected" | "cancelled" | "failed">;
}): Promise<AgentRunState> {
  const startStep = args.plan.steps.find((step) => step.phase === "start");
  const contextStep = args.plan.steps.find(
    (step) => step.phase === "context-analysis",
  );
  const requiredApiStep = args.plan.steps.find(
    (step) => step.phase === "required-api",
  );
  const orchestratorStep = args.plan.steps.find(
    (step) => step.phase === "orchestrator",
  );
  const endStep = args.plan.steps.find((step) => step.phase === "end");

  if (!startStep || !contextStep || !orchestratorStep || !endStep) {
    return "failed";
  }

  const startResult = await runSingleStep({
    stepId: startStep.id,
    workMsRange: [500, 850],
    successMessage: "Prompt accepted",
    signal: args.signal,
    onStatusUpdate: args.onStatusUpdate,
  });

  if (startResult !== "done") {
    return startResult;
  }

  const contextResult = await runSingleStep({
    stepId: contextStep.id,
    workMsRange: [900, 1400],
    successMessage: "Context analyzed successfully",
    failureMessage: contextFailureReason(args.prompt),
    signal: args.signal,
    onStatusUpdate: args.onStatusUpdate,
  });

  if (contextResult !== "done") {
    if (requiredApiStep) {
      args.onStatusUpdate({
        nodeId: requiredApiStep.id,
        status: "failed",
        detail: "Stopped after context-analysis failure",
      });
    }
    args.onStatusUpdate({
      nodeId: orchestratorStep.id,
      status: "failed",
      detail: "Stopped after context-analysis failure",
    });
    args.onStatusUpdate({
      nodeId: endStep.id,
      status: "failed",
      detail: "Flow terminated",
    });
    return contextResult;
  }

  // Handle Required API step
  if (requiredApiStep) {
    // Check if there are any disconnected services
    const connectorSteps = args.plan.steps.filter(
      (step) => step.phase === "connector-agent",
    );
    
    const disconnectedServices = connectorSteps.filter((step) => {
      const integration = step.serviceId 
        ? args.getCurrentIntegration?.(step.serviceId as ServiceId) ?? 
          args.integrations.find((i) => i.id === step.serviceId)
        : null;
      return !integration || integration.status !== "connected";
    });

    args.onStatusUpdate({
      nodeId: requiredApiStep.id,
      status: "working",
      detail: "Checking required API connectivity...",
    });

    await sleep(randomBetween(400, 700));

    if (disconnectedServices.length > 0) {
      const disconnectedNames = disconnectedServices
        .map((s) => s.serviceName || s.serviceId)
        .join(", ");
      
      args.onStatusUpdate({
        nodeId: requiredApiStep.id,
        status: "failed",
        detail: `Missing connections: ${disconnectedNames}. Please connect these integrations first.`,
      });

      // Mark all connector steps as failed
      for (const step of connectorSteps) {
        args.onStatusUpdate({
          nodeId: step.id,
          status: "failed",
          detail: "Blocked - service not connected",
        });
      }

      args.onStatusUpdate({
        nodeId: orchestratorStep.id,
        status: "failed",
        detail: "Flow blocked - required services not connected",
      });
      args.onStatusUpdate({
        nodeId: endStep.id,
        status: "failed",
        detail: "Flow terminated",
      });

      return "blocked";
    }

    args.onStatusUpdate({
      nodeId: requiredApiStep.id,
      status: "done",
      detail: `All required services connected (${connectorSteps.length} services)`,
    });
  }

  const connectorSteps = args.plan.steps.filter(
    (step) => step.phase === "connector-agent",
  );

  const executionSteps = toExecutionSteps(args.plan);
  const readyConnectorSteps = new Map<
    ServiceId,
    { integration: Integration; nodeId: string }
  >();

  let branchFailureDetected = false;
  let failedConnectorNodeId: string | null = null;
  const failedConnectors: string[] = []; // Track which connectors failed

  for (const step of connectorSteps) {
    if (isAbort(args.signal)) {
      return "stopped";
    }

    // Changed: Don't cascade fail other connectors when one fails
    // Instead, track individual failures and continue with available connectors

    args.onStatusUpdate({
      nodeId: step.id,
      status: "working",
      detail: "Checking connector status...",
    });

    await sleep(randomBetween(350, 700));

    if (isAbort(args.signal)) {
      return "stopped";
    }

    const serviceId = step.serviceId;
    const integration =
      (serviceId && args.getCurrentIntegration?.(serviceId as ServiceId)) ??
      args.integrations.find((item) => item.id === serviceId);

    if (!integration) {
      // Track failure but don't cascade to other connectors
      failedConnectors.push(step.id);
      failedConnectorNodeId = step.id;
      args.onStatusUpdate({
        nodeId: step.id,
        status: "failed",
        detail: "Connector is not available in this workspace.",
      });
      continue;
    }

    const unavailableReason = connectorUnavailableReason(integration);
    if (unavailableReason) {
      failedConnectors.push(step.id);
      failedConnectorNodeId = step.id;
      args.onStatusUpdate({
        nodeId: step.id,
        status: "failed",
        detail: unavailableReason,
      });
      continue;
    }

    const forcedFailureReason = forcedConnectorFailureReason({
      prompt: args.prompt,
      integration,
    });
    if (forcedFailureReason) {
      failedConnectors.push(step.id);
      failedConnectorNodeId = step.id;
      args.onStatusUpdate({
        nodeId: step.id,
        status: "failed",
        detail: forcedFailureReason,
      });
      continue;
    }

    if (integration.status === "connected") {
      readyConnectorSteps.set(integration.id, {
        integration,
        nodeId: step.id,
      });

      args.onStatusUpdate({
        nodeId: step.id,
        status: "working",
        detail:
          executionSteps.length > 0
            ? `${integration.name} connected. Waiting for tool execution...`
            : `${integration.name} is connected and ready`,
      });
      continue;
    }

    args.onStatusUpdate({
      nodeId: step.id,
      status: "working",
      detail: `${integration.name} not connected. Waiting for credentials...`,
    });

    if (!args.resolveConnectorConnection) {
      failedConnectors.push(step.id);
      failedConnectorNodeId = step.id;
      args.onStatusUpdate({
        nodeId: step.id,
        status: "failed",
        detail: `${integration.name} is not connected`,
      });
      continue;
    }

    const resolution = await args.resolveConnectorConnection(integration);

    if (isAbort(args.signal)) {
      return "stopped";
    }

    if (resolution !== "connected") {
      failedConnectors.push(step.id);
      failedConnectorNodeId = step.id;
      args.onStatusUpdate({
        nodeId: step.id,
        status: "failed",
        detail:
          resolution === "cancelled"
            ? `Credentials modal closed for ${integration.name}`
            : `Failed to connect ${integration.name}`,
      });
      continue;
    }

    const refreshedIntegration =
      (serviceId
        ? args.getCurrentIntegration?.(serviceId as ServiceId)
        : undefined) ?? integration;

    readyConnectorSteps.set(refreshedIntegration.id, {
      integration: refreshedIntegration,
      nodeId: step.id,
    });

    args.onStatusUpdate({
      nodeId: step.id,
      status: "working",
      detail:
        executionSteps.length > 0
          ? `${refreshedIntegration.name} connected. Waiting for tool execution...`
          : `${refreshedIntegration.name} connected successfully`,
    });
  }

  if (isAbort(args.signal)) {
    return "stopped";
  }

  // Check if ALL connectors failed (total failure) vs some failed (partial success possible)
  const hasReadyConnectors = readyConnectorSteps.size > 0;
  const allConnectorsFailed = failedConnectors.length === connectorSteps.length;
  
  // Only set branchFailureDetected if ALL connectors failed
  if (allConnectorsFailed && connectorSteps.length > 0) {
    branchFailureDetected = true;
  }

  if (!branchFailureDetected && hasReadyConnectors) {
    if (executionSteps.length === 0) {
      for (const connectorState of Array.from(readyConnectorSteps.values())) {
        args.onStatusUpdate({
          nodeId: connectorState.nodeId,
          status: "done",
          detail: `${connectorState.integration.name} is connected and ready`,
        });
      }
    } else {
      const executionCount = new Map<ServiceId, number>();

      for (const executionStep of executionSteps) {
        if (isAbort(args.signal)) {
          return "stopped";
        }

        const serviceId = toServiceIdFromTool(executionStep.tool);
        if (!serviceId) {
          // Log error but continue with other steps if possible
          emitToolAudit(args.onToolAudit, {
            nodeId: connectorSteps[0]?.id ?? "unknown-node",
            serviceId: "unknown-service",
            tool: executionStep.tool,
            stage: "error",
            request: executionStep.arguments,
            error: `Unable to resolve connector from tool ${executionStep.tool}`,
          });
          
          // Only mark as failed if this is a critical tool
          continue;
        }

        const connectorState = readyConnectorSteps.get(serviceId);
        if (!connectorState) {
          // Connector not ready - skip this step but continue with others
          emitToolAudit(args.onToolAudit, {
            nodeId: connectorSteps[0]?.id ?? "unknown-node",
            serviceId,
            tool: executionStep.tool,
            stage: "error",
            request: executionStep.arguments,
            error: `Connector ${serviceId} is not connected for tool execution`,
          });
          
          continue;
        }

        args.onStatusUpdate({
          nodeId: connectorState.nodeId,
          status: "working",
          detail: `Executing ${executionStep.tool}...`,
        });

        const toolRequest = {
          ...executionStep.arguments,
          prompt: args.prompt,
        };

        emitToolAudit(args.onToolAudit, {
          nodeId: connectorState.nodeId,
          serviceId,
          tool: executionStep.tool,
          stage: "request",
          request: toolRequest,
        });

        const executionResponse = await mcpApi.execute(
          executionStep.tool,
          toolRequest,
        );

        if (
          !executionResponse.success ||
          !executionResponse.data ||
          executionResponse.data.error
        ) {
          // Track execution failure but continue with other tools if possible
          failedConnectors.push(connectorState.nodeId);
          failedConnectorNodeId = connectorState.nodeId;

          const failureDetail =
            executionResponse.error ||
            executionResponse.data?.error?.message ||
            `Execution failed for ${executionStep.tool}`;

          emitToolAudit(args.onToolAudit, {
            nodeId: connectorState.nodeId,
            serviceId,
            tool: executionStep.tool,
            stage: "error",
            request: toolRequest,
            response: executionResponse.data,
            error: failureDetail,
          });

          args.onStatusUpdate({
            nodeId: connectorState.nodeId,
            status: "failed",
            detail: failureDetail,
          });

          // Continue with other execution steps instead of breaking
          continue;
        }

        executionCount.set(serviceId, (executionCount.get(serviceId) ?? 0) + 1);

        emitToolAudit(args.onToolAudit, {
          nodeId: connectorState.nodeId,
          serviceId,
          tool: executionStep.tool,
          stage: "response",
          request: toolRequest,
          response: executionResponse.data.result,
        });

        args.onStatusUpdate({
          nodeId: connectorState.nodeId,
          status: "working",
          detail: `Executed ${executionStep.tool}`,
        });
      }

      if (!branchFailureDetected) {
        for (const [serviceId, connectorState] of Array.from(
          readyConnectorSteps.entries(),
        )) {
          const count = executionCount.get(serviceId) ?? 0;
          args.onStatusUpdate({
            nodeId: connectorState.nodeId,
            status: "done",
            detail:
              count > 0
                ? `Executed ${count} tool call${count === 1 ? "" : "s"} on ${connectorState.integration.name}`
                : `${connectorState.integration.name} connected successfully`,
          });
        }
      }
    }
  }

  // Only fail the entire flow if ALL connectors failed (no partial success)
  if (branchFailureDetected && !hasReadyConnectors) {
    args.onStatusUpdate({
      nodeId: orchestratorStep.id,
      status: "failed",
      detail: "All connectors failed. No execution possible.",
    });
    args.onStatusUpdate({
      nodeId: endStep.id,
      status: "failed",
      detail: "Flow terminated",
    });
    return "failed";
  }

  // If some connectors failed but others succeeded, continue with partial results
  // The individual failed connectors already show their error status

  const orchestratorResult = await runSingleStep({
    stepId: orchestratorStep.id,
    workMsRange: [700, 1200],
    successMessage: "Merged all agent outputs",
    signal: args.signal,
    onStatusUpdate: args.onStatusUpdate,
  });

  if (orchestratorResult !== "done") {
    return orchestratorResult;
  }

  const endResult = await runSingleStep({
    stepId: endStep.id,
    workMsRange: [400, 700],
    successMessage: "Flow completed",
    signal: args.signal,
    onStatusUpdate: args.onStatusUpdate,
  });

  if (endResult !== "done") {
    return endResult;
  }

  return "completed";
}
