"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import ReactFlow, {
  Background,
  Controls,
  type Edge,
  type Node,
} from "reactflow";
import "reactflow/dist/style.css";
import {
  AlertCircle,
  Clock3,
  Pause,
  Pencil,
  Save,
  Search,
  Trash2,
  FileText,
  Plus,
  Loader2,
} from "lucide-react";

import {
  workflowsApi,
  type Workflow,
  type AuditLog,
  type WorkflowAuditRun,
} from "@/lib/api";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Modal,
  ModalFooter,
  Textarea,
} from "@/components/ui";

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

function toReactFlowNodes(workflow: Workflow): Node[] {
  const sourceNodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];

  if (sourceNodes.length === 0) {
    return [
      {
        id: `empty-${workflow.id}`,
        type: "default",
        position: { x: 140, y: 90 },
        draggable: false,
        data: {
          label: "No workflow nodes available for this run",
        },
      },
    ];
  }

  return sourceNodes.map((node, index) => {
    const hasValidPosition =
      node.position &&
      typeof node.position.x === "number" &&
      typeof node.position.y === "number";

    return {
      id: node.id,
      type: "default",
      position: hasValidPosition
        ? node.position
        : {
            x: 120 + (index % 3) * 210,
            y: 60 + Math.floor(index / 3) * 130,
          },
      draggable: true,
      data: {
        label: `${node.label || node.operation || "Step"} (${node.service || "system"})`,
      },
    };
  });
}

function toReactFlowEdges(workflow: Workflow): Edge[] {
  const sourceEdges = Array.isArray(workflow.edges) ? workflow.edges : [];

  return sourceEdges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    animated: false,
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

  return (
    <div className="h-64 w-full overflow-hidden rounded-lg border border-border bg-surface-secondary">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        minZoom={0.4}
        maxZoom={1.2}
        defaultViewport={{ x: 0, y: 0, zoom: 0.7 }}
      >
        <Background gap={18} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

export default function WorkflowsPage() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftPrompt, setDraftPrompt] = useState<string>("");

  const [auditModalOpen, setAuditModalOpen] = useState(false);
  const [auditWorkflowName, setAuditWorkflowName] = useState("");
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [auditRuns, setAuditRuns] = useState<WorkflowAuditRun[]>([]);
  const [isAuditLoading, setIsAuditLoading] = useState(false);

  const loadWorkflows = useCallback(async () => {
    setIsLoading(true);
    const response = await workflowsApi.list();

    if (!response.success || !response.data) {
      setError(response.error || "Failed to load workflows");
      setIsLoading(false);
      return;
    }

    setWorkflows(response.data);
    setError(null);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    void loadWorkflows();
  }, [loadWorkflows]);

  const filteredWorkflows = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return workflows;

    return workflows.filter((workflow) => {
      return (
        workflow.name.toLowerCase().includes(query) ||
        workflow.description.toLowerCase().includes(query)
      );
    });
  }, [workflows, search]);

  const handlePause = useCallback(async (workflow: Workflow) => {
    if (workflow.status !== "running") {
      setError("Only running workflows can be paused.");
      return;
    }

    setBusyId(workflow.id);
    const response = await workflowsApi.pause(workflow.id);
    setBusyId(null);

    if (!response.success || !response.data) {
      setError(response.error || "Failed to pause workflow");
      return;
    }

    setWorkflows((current) =>
      current.map((item) =>
        item.id === workflow.id ? (response.data as Workflow) : item,
      ),
    );
    setError(null);
  }, []);

  const handleDelete = useCallback(
    async (workflowId: string) => {
      setBusyId(workflowId);
      const response = await workflowsApi.delete(workflowId);
      setBusyId(null);

      if (!response.success) {
        setError(response.error || "Failed to delete workflow");
        return;
      }

      setWorkflows((current) =>
        current.filter((item) => item.id !== workflowId),
      );
      if (editingId === workflowId) {
        setEditingId(null);
        setDraftPrompt("");
      }
      setError(null);
    },
    [editingId],
  );

  const handleEditToggle = useCallback(
    (workflow: Workflow) => {
      if (editingId === workflow.id) {
        setEditingId(null);
        setDraftPrompt("");
        return;
      }

      setEditingId(workflow.id);
      setDraftPrompt(workflow.description || "");
    },
    [editingId],
  );

  const handleCreateWorkflow = useCallback(
    async (sourceWorkflow: Workflow) => {
      const prompt =
        draftPrompt.trim() ||
        sourceWorkflow.description?.trim() ||
        sourceWorkflow.name;
      if (!prompt) {
        setError("Prompt cannot be empty.");
        return;
      }

      setBusyId(sourceWorkflow.id);
      const response = await workflowsApi.create({
        name: `${sourceWorkflow.name} (edited)`,
        description: prompt,
        nodes: sourceWorkflow.nodes,
        edges: sourceWorkflow.edges,
        status: "draft",
      });
      setBusyId(null);

      if (!response.success || !response.data) {
        setError(
          response.error || "Failed to create workflow from edited prompt",
        );
        return;
      }

      setWorkflows((current) => [response.data as Workflow, ...current]);
      setEditingId(null);
      setDraftPrompt("");
      setError(null);
    },
    [draftPrompt],
  );

  const handleSavePrompt = useCallback(
    async (workflow: Workflow) => {
      const prompt = draftPrompt.trim();
      if (!prompt) {
        setError("Prompt cannot be empty.");
        return;
      }

      setBusyId(workflow.id);
      const response = await workflowsApi.update(workflow.id, {
        description: prompt,
      });
      setBusyId(null);

      if (!response.success || !response.data) {
        setError(response.error || "Failed to save workflow prompt");
        return;
      }

      setWorkflows((current) =>
        current.map((item) =>
          item.id === workflow.id ? (response.data as Workflow) : item,
        ),
      );
      setEditingId(null);
      setDraftPrompt("");
      setError(null);
    },
    [draftPrompt],
  );

  const handleAudits = useCallback(async (workflow: Workflow) => {
    setAuditModalOpen(true);
    setAuditWorkflowName(workflow.name);
    setAuditLogs([]);
    setAuditRuns([]);
    setIsAuditLoading(true);

    const response = await workflowsApi.audits(workflow.id, {
      limit: 100,
      offset: 0,
    });
    setIsAuditLoading(false);

    if (!response.success || !response.data) {
      setError(response.error || "Failed to load workflow audits");
      return;
    }

    setAuditLogs(response.data.logs || []);
    setAuditRuns(response.data.runs || []);
    setError(null);
  }, []);

  const groupedAuditLogs = useMemo(() => {
    if (auditRuns.length === 0) {
      return [] as Array<{ run: WorkflowAuditRun; logs: AuditLog[] }>;
    }

    const groups = auditRuns.map((run) => ({
      run,
      logs: auditLogs.filter(
        (log) =>
          (typeof log.runNumber === "number" &&
            log.runNumber === run.runNumber) ||
          log.executionId === run.executionId,
      ),
    }));

    return groups;
  }, [auditLogs, auditRuns]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="mb-0">
          <div>
            <CardTitle>Workflows</CardTitle>
            <CardDescription>
              Search and manage workflows from PostgreSQL with prompt editing,
              audits, and drag view.
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
              onClick={() => void loadWorkflows()}
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

      {!isLoading && filteredWorkflows.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-content-secondary">
            No workflows found for your search.
          </CardContent>
        </Card>
      ) : null}

      <div className="space-y-5">
        {filteredWorkflows.map((workflow) => {
          const isEditing = editingId === workflow.id;
          const promptValue = isEditing ? draftPrompt : workflow.description;
          const isBusy = busyId === workflow.id;

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

                <div className="flex flex-wrap items-center gap-2 pt-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void handlePause(workflow)}
                    disabled={workflow.status !== "running"}
                    isLoading={isBusy && workflow.status === "running"}
                    leftIcon={<Pause className="h-3.5 w-3.5" />}
                  >
                    Pause
                  </Button>
                  <Button
                    size="sm"
                    variant={isEditing ? "secondary" : "outline"}
                    onClick={() => handleEditToggle(workflow)}
                    leftIcon={<Pencil className="h-3.5 w-3.5" />}
                  >
                    {isEditing ? "Cancel" : "Edit Prompt"}
                  </Button>
                  {isEditing ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void handleSavePrompt(workflow)}
                      isLoading={isBusy}
                      leftIcon={<Save className="h-3.5 w-3.5" />}
                    >
                      Save Prompt
                    </Button>
                  ) : null}
                  {isEditing ? (
                    <Button
                      size="sm"
                      onClick={() => void handleCreateWorkflow(workflow)}
                      isLoading={isBusy}
                      leftIcon={<Plus className="h-3.5 w-3.5" />}
                    >
                      Create Workflow
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void handleAudits(workflow)}
                    leftIcon={<FileText className="h-3.5 w-3.5" />}
                  >
                    Audits
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => void handleDelete(workflow.id)}
                    isLoading={isBusy}
                    leftIcon={<Trash2 className="h-3.5 w-3.5" />}
                  >
                    Delete
                  </Button>
                </div>
              </CardHeader>

              <CardContent className="space-y-4">
                <div>
                  <p className="mb-2 text-sm font-medium text-content-primary">
                    Prompt
                  </p>
                  <Textarea
                    value={promptValue}
                    disabled={!isEditing}
                    onChange={(event) => setDraftPrompt(event.target.value)}
                    className="min-h-[92px]"
                    placeholder="Workflow prompt"
                  />
                </div>

                <div>
                  <p className="mb-2 text-sm font-medium text-content-primary">
                    Workflow Module
                  </p>
                  <WorkflowGraph workflow={workflow} />
                </div>

                <div>
                  <p className="mb-2 text-sm font-medium text-content-primary">
                    Generated JSON
                  </p>
                  <pre className="max-h-56 overflow-auto rounded-lg border border-border bg-surface-secondary p-3 text-xs text-content-secondary">
                    {JSON.stringify(
                      workflow.generatedJson ?? {
                        prompt: workflow.description,
                        nodes: workflow.nodes,
                        edges: workflow.edges,
                      },
                      null,
                      2,
                    )}
                  </pre>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Modal
        isOpen={auditModalOpen}
        onClose={() => setAuditModalOpen(false)}
        title={`Audits - ${auditWorkflowName}`}
        description="Workflow execution and action logs"
        size="xl"
      >
        <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
          {isAuditLoading ? (
            <p className="text-sm text-content-secondary">Loading audits...</p>
          ) : null}

          {!isAuditLoading && auditLogs.length === 0 ? (
            <p className="text-sm text-content-secondary">
              No audits found for this workflow.
            </p>
          ) : null}

          {groupedAuditLogs.map((group) => (
            <div
              key={group.run.executionId}
              className="rounded-lg border border-border bg-surface-secondary p-3"
            >
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Badge variant="primary">Run #{group.run.runNumber}</Badge>
                <span className="text-xs text-content-secondary">
                  {new Date(group.run.startedAt).toLocaleString()} -{" "}
                  {new Date(group.run.endedAt).toLocaleString()}
                </span>
                <span className="text-xs text-content-tertiary">
                  Logs: {group.run.totalLogs}
                </span>
                {group.run.errorCount > 0 ? (
                  <Badge size="sm" variant="error">
                    Errors: {group.run.errorCount}
                  </Badge>
                ) : (
                  <Badge size="sm" variant="success">
                    No errors
                  </Badge>
                )}
              </div>

              <div className="space-y-2">
                {group.logs.map((log) => (
                  <div
                    key={log.id}
                    className="rounded-md border border-border bg-surface-primary p-3"
                  >
                    <div className="mb-1 flex items-center gap-2 text-xs">
                      <Badge
                        size="sm"
                        variant={
                          log.level === "error"
                            ? "error"
                            : log.level === "warning"
                              ? "warning"
                              : log.level === "debug"
                                ? "info"
                                : "success"
                        }
                      >
                        {log.level}
                      </Badge>
                      <span className="text-content-tertiary">
                        {new Date(log.timestamp).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-sm text-content-primary">
                      {log.message}
                    </p>
                    <p className="mt-1 text-xs text-content-secondary">
                      {log.action}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {!isAuditLoading && auditRuns.length === 0 && auditLogs.length > 0
            ? auditLogs.map((log) => (
                <div
                  key={log.id}
                  className="rounded-md border border-border bg-surface-secondary p-3"
                >
                  <div className="mb-1 flex items-center gap-2 text-xs">
                    <Badge
                      size="sm"
                      variant={
                        log.level === "error"
                          ? "error"
                          : log.level === "warning"
                            ? "warning"
                            : log.level === "debug"
                              ? "info"
                              : "success"
                      }
                    >
                      {log.level}
                    </Badge>
                    <span className="text-content-tertiary">
                      {new Date(log.timestamp).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-sm text-content-primary">{log.message}</p>
                  <p className="mt-1 text-xs text-content-secondary">
                    {log.action}
                  </p>
                </div>
              ))
            : null}
        </div>

        <ModalFooter>
          <Button variant="outline" onClick={() => setAuditModalOpen(false)}>
            Close
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
