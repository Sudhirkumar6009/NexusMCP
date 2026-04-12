"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlertCircle,
  Clock3,
  FileJson,
  Loader2,
  RefreshCw,
  Search,
} from "lucide-react";

import {
  logsApi,
  workflowsApi,
  type AuditLog,
  type StepRun,
  type Workflow,
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
  Select,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui";

type ExecutionStatus = "success" | "failed" | "running" | "unknown";

type TriggerInfo = {
  source?: string;
  event?: string;
  trigger?: string;
  repository?: string;
};

type ExecutionView = {
  executionId: string;
  workflowId: string;
  workflowName: string;
  startedAt: string;
  endedAt: string;
  status: ExecutionStatus;
  totalLogs: number;
  stepCount: number;
  errorCount: number;
  triggerInfo: TriggerInfo;
  triggerPayload: Record<string, unknown>;
  logs: AuditLog[];
  stepRuns: StepRun[];
};

type MissingDetailPrompt = {
  key: string;
  label: string;
  reason: string;
  toolName: string;
  stepId: string;
};

type GroupAccumulator = {
  executionId: string;
  workflowId: string;
  workflowName: string;
  logs: AuditLog[];
  stepRuns: StepRun[];
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function asString(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return "";
}

function toTimestamp(value: string | undefined): number {
  if (!value) {
    return 0;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatDateTime(value: string): string {
  const time = toTimestamp(value);
  if (!time) {
    return "N/A";
  }

  return new Date(time).toLocaleString();
}

function statusVariant(
  status: ExecutionStatus,
): "success" | "error" | "info" | "default" {
  if (status === "success") return "success";
  if (status === "failed") return "error";
  if (status === "running") return "info";
  return "default";
}

function normalizeMissingFieldKey(rawField: string): string {
  const normalized = rawField
    .trim()
    .toLowerCase()
    .replace(/["'`]/g, "")
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_.]/g, "")
    .replace(/^_+|_+$/g, "");

  if (!normalized) {
    return "";
  }

  if (
    normalized === "recipient" ||
    normalized === "recipient_email" ||
    normalized === "to_email" ||
    normalized === "email_to" ||
    normalized === "email_address" ||
    normalized === "receiver" ||
    normalized === "receiver_email"
  ) {
    return "to";
  }

  if (normalized === "sheetid" || normalized === "spreadsheetid") {
    return "sheet_id";
  }

  return normalized;
}

function missingFieldLabel(fieldKey: string): string {
  if (fieldKey === "to") {
    return "Recipient Email (to)";
  }

  if (fieldKey === "cc") {
    return "CC Email";
  }

  if (fieldKey === "bcc") {
    return "BCC Email";
  }

  if (fieldKey === "channel") {
    return "Slack Channel";
  }

  if (fieldKey === "project") {
    return "Jira Project";
  }

  if (fieldKey === "sheet_id") {
    return "Spreadsheet ID";
  }

  if (fieldKey === "sheet_name") {
    return "Sheet Name";
  }

  return fieldKey
    .split(/[._]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function extractErrorMessage(step: StepRun): string {
  if (typeof step.outputPayload === "string") {
    return step.outputPayload.trim();
  }

  const outputPayload = asRecord(step.outputPayload);
  const nestedError = asRecord(outputPayload.error);

  const messageCandidates = [
    nestedError.message,
    outputPayload.message,
    outputPayload.errorMessage,
    outputPayload.detail,
  ];

  for (const candidate of messageCandidates) {
    const message = asString(candidate);
    if (message) {
      return message;
    }
  }

  return "";
}

function fallbackFieldForTool(toolName: string): string {
  const normalized = toolName.trim().toLowerCase();
  if (normalized.startsWith("gmail.")) {
    return "to";
  }
  if (normalized.startsWith("slack.")) {
    return "channel";
  }
  if (normalized.startsWith("jira.")) {
    return "project";
  }
  if (
    normalized.startsWith("sheets.") ||
    normalized.startsWith("google_sheets.")
  ) {
    return "sheet_id";
  }
  return "details";
}

function extractMissingFieldKeys(message: string): string[] {
  const fieldKeys = new Set<string>();

  for (const match of message.matchAll(/\(([^)]+)\)/g)) {
    const captured = match[1] || "";
    const parts = captured.split(/[,/]|\band\b/gi);

    for (const part of parts) {
      const key = normalizeMissingFieldKey(part);
      if (key) {
        fieldKeys.add(key);
      }
    }
  }

  for (const match of message.matchAll(
    /(?:missing|required)\s+(?:field|parameter|value)?\s*[:\-]?\s*([a-z0-9_.\-\s,]+)/gi,
  )) {
    const captured = match[1] || "";
    const parts = captured.split(/[,/]|\band\b/gi);

    for (const part of parts) {
      const key = normalizeMissingFieldKey(part);
      if (key) {
        fieldKeys.add(key);
      }
    }
  }

  return [...fieldKeys];
}

function detectMissingDetailPrompts(
  stepRuns: StepRun[],
): MissingDetailPrompt[] {
  const promptsByKey = new Map<string, MissingDetailPrompt>();

  for (const step of stepRuns) {
    const status = asString(step.status).toLowerCase();
    if (status !== "failed" && status !== "error") {
      continue;
    }

    const message = extractErrorMessage(step);
    const mentionsMissing = /missing|require/i.test(message);
    if (!mentionsMissing) {
      continue;
    }

    const extractedKeys = extractMissingFieldKeys(message);
    const candidateKeys =
      extractedKeys.length > 0
        ? extractedKeys
        : [fallbackFieldForTool(step.toolName)];

    for (const key of candidateKeys) {
      if (!key || promptsByKey.has(key)) {
        continue;
      }

      promptsByKey.set(key, {
        key,
        label: missingFieldLabel(key),
        reason: message || `Missing detail detected for ${step.toolName}`,
        toolName: step.toolName,
        stepId: step.stepId,
      });
    }
  }

  return [...promptsByKey.values()];
}

function pickTriggerPayload(
  details: Record<string, unknown>,
): Record<string, unknown> {
  const candidates = [
    details.triggerPayload,
    details.payload,
    details.eventPayload,
    details.event,
    details.input,
    details.request,
  ];

  for (const candidate of candidates) {
    const record = asRecord(candidate);
    if (Object.keys(record).length > 0) {
      return record;
    }
  }

  return {};
}

function deriveTriggerInfo(
  logs: AuditLog[],
  stepRuns: StepRun[],
): {
  triggerInfo: TriggerInfo;
  triggerPayload: Record<string, unknown>;
} {
  const sortedLogs = [...logs].sort(
    (a, b) => toTimestamp(a.timestamp) - toTimestamp(b.timestamp),
  );

  const triggerInfo: TriggerInfo = {};
  let triggerPayload: Record<string, unknown> = {};

  for (const log of sortedLogs) {
    const details = asRecord(log.details);
    const source = asString(details.source);
    const event = asString(details.event);
    const trigger = asString(details.trigger);
    const repository = asString(details.repository);

    if (!triggerInfo.source && source) {
      triggerInfo.source = source;
    }

    if (!triggerInfo.event && event) {
      triggerInfo.event = event;
    }

    if (!triggerInfo.trigger && trigger) {
      triggerInfo.trigger = trigger;
    }

    if (!triggerInfo.repository && repository) {
      triggerInfo.repository = repository;
    }

    if (Object.keys(triggerPayload).length === 0) {
      triggerPayload = pickTriggerPayload(details);
    }
  }

  if (Object.keys(triggerPayload).length === 0) {
    const firstStepInput = asRecord(stepRuns[0]?.inputPayload);
    if (Object.keys(firstStepInput).length > 0) {
      triggerPayload = firstStepInput;
    }

    if (!triggerInfo.trigger) {
      const trigger = asString(firstStepInput.trigger);
      if (trigger) {
        triggerInfo.trigger = trigger;
      }
    }

    if (!triggerInfo.event) {
      const event = asString(firstStepInput.event);
      if (event) {
        triggerInfo.event = event;
      }
    }

    if (!triggerInfo.source) {
      const source = asString(firstStepInput.source);
      if (source) {
        triggerInfo.source = source;
      }
    }

    if (!triggerInfo.repository) {
      const repository = asString(firstStepInput.repository);
      if (repository) {
        triggerInfo.repository = repository;
      }
    }
  }

  return {
    triggerInfo,
    triggerPayload,
  };
}

function buildExecutionViews(args: {
  workflows: Workflow[];
  logs: AuditLog[];
  stepRuns: StepRun[];
}): ExecutionView[] {
  const workflowById = new Map(
    args.workflows.map((workflow) => [workflow.id, workflow]),
  );
  const grouped = new Map<string, GroupAccumulator>();

  const upsert = (executionId: string, workflowId?: string) => {
    const existing = grouped.get(executionId);
    if (existing) {
      if (workflowId && !existing.workflowId) {
        existing.workflowId = workflowId;
      }
      return existing;
    }

    const workflowName = workflowId
      ? workflowById.get(workflowId)?.name || workflowId
      : "Unknown Workflow";

    const created: GroupAccumulator = {
      executionId,
      workflowId: workflowId || "",
      workflowName,
      logs: [],
      stepRuns: [],
    };

    grouped.set(executionId, created);
    return created;
  };

  for (const log of args.logs) {
    if (!log.executionId) {
      continue;
    }

    const current = upsert(log.executionId, log.workflowId);
    current.logs.push(log);

    if (!current.workflowId && log.workflowId) {
      current.workflowId = log.workflowId;
      current.workflowName =
        workflowById.get(log.workflowId)?.name ||
        asString(asRecord(log.details).workflowName) ||
        log.workflowId;
    }
  }

  for (const step of args.stepRuns) {
    if (!step.executionId) {
      continue;
    }

    const current = upsert(step.executionId, step.workflowId);
    current.stepRuns.push(step);

    if (!current.workflowId && step.workflowId) {
      current.workflowId = step.workflowId;
      current.workflowName =
        workflowById.get(step.workflowId)?.name || step.workflowId;
    }
  }

  return [...grouped.values()]
    .map((entry) => {
      const logTimes = entry.logs
        .map((log) => toTimestamp(log.timestamp))
        .filter(Boolean);
      const stepStartTimes = entry.stepRuns
        .map((step) => toTimestamp(step.createdAt))
        .filter(Boolean);
      const stepEndTimes = entry.stepRuns
        .map((step) => toTimestamp(step.updatedAt))
        .filter(Boolean);

      const allStartTimes = [...logTimes, ...stepStartTimes];
      const allEndTimes = [...logTimes, ...stepEndTimes];

      const startedAtTime =
        allStartTimes.length > 0 ? Math.min(...allStartTimes) : Date.now();
      const endedAtTime =
        allEndTimes.length > 0 ? Math.max(...allEndTimes) : startedAtTime;

      const failedLogs = entry.logs.filter((log) => log.level === "error");
      const failedSteps = entry.stepRuns.filter((step) =>
        ["failed", "error"].includes(step.status.toLowerCase()),
      );
      const hasRunningStep = entry.stepRuns.some(
        (step) => step.status.toLowerCase() === "running",
      );

      const status: ExecutionStatus =
        failedLogs.length > 0 || failedSteps.length > 0
          ? "failed"
          : hasRunningStep
            ? "running"
            : entry.logs.length > 0 || entry.stepRuns.length > 0
              ? "success"
              : "unknown";

      const { triggerInfo, triggerPayload } = deriveTriggerInfo(
        entry.logs,
        entry.stepRuns,
      );

      return {
        executionId: entry.executionId,
        workflowId: entry.workflowId || "unknown-workflow",
        workflowName: entry.workflowName,
        startedAt: new Date(startedAtTime).toISOString(),
        endedAt: new Date(endedAtTime).toISOString(),
        status,
        totalLogs: entry.logs.length,
        stepCount: entry.stepRuns.length,
        errorCount: failedLogs.length + failedSteps.length,
        triggerInfo,
        triggerPayload,
        logs: entry.logs.sort(
          (a, b) => toTimestamp(b.timestamp) - toTimestamp(a.timestamp),
        ),
        stepRuns: entry.stepRuns.sort(
          (a, b) => toTimestamp(b.updatedAt) - toTimestamp(a.updatedAt),
        ),
      } satisfies ExecutionView;
    })
    .sort((a, b) => toTimestamp(b.startedAt) - toTimestamp(a.startedAt));
}

export default function PastExecutionsPage() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [stepRuns, setStepRuns] = useState<StepRun[]>([]);
  const [search, setSearch] = useState("");
  const [workflowFilter, setWorkflowFilter] = useState("all");
  const [selectedExecutionId, setSelectedExecutionId] = useState<string | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isMissingDetailsModalOpen, setIsMissingDetailsModalOpen] =
    useState(false);
  const [missingDetailValues, setMissingDetailValues] = useState<
    Record<string, string>
  >({});
  const [prefilledMissingKeys, setPrefilledMissingKeys] = useState<string[]>(
    [],
  );
  const [retryError, setRetryError] = useState<string | null>(null);
  const [retryInfo, setRetryInfo] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const autoRetriedExecutionIdsRef = useRef<Set<string>>(new Set());
  const retryInFlightExecutionIdRef = useRef<string | null>(null);

  const loadData = useCallback(async () => {
    setIsRefreshing(true);

    try {
      const [workflowsResponse, logsResponse, stepRunsResponse] =
        await Promise.all([
          workflowsApi.list({ scope: "all" }),
          logsApi.list({ limit: 1000, offset: 0 }),
          logsApi.listStepRuns({ limit: 1000, offset: 0 }),
        ]);

      const errorMessages: string[] = [];

      if (workflowsResponse.success && Array.isArray(workflowsResponse.data)) {
        setWorkflows(workflowsResponse.data);
      } else {
        setWorkflows([]);
        errorMessages.push(
          workflowsResponse.error || "Failed to load workflows.",
        );
      }

      if (logsResponse.success && Array.isArray(logsResponse.data)) {
        setLogs(logsResponse.data);
      } else {
        setLogs([]);
        errorMessages.push(logsResponse.error || "Failed to load audit logs.");
      }

      if (stepRunsResponse.success && Array.isArray(stepRunsResponse.data)) {
        setStepRuns(stepRunsResponse.data);
      } else {
        setStepRuns([]);
        errorMessages.push(
          stepRunsResponse.error || "Failed to load step runs.",
        );
      }

      setError(errorMessages.length > 0 ? errorMessages.join(" ") : null);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadData();

    const intervalId = window.setInterval(() => {
      void loadData();
    }, 15000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [loadData]);

  const executions = useMemo(
    () => buildExecutionViews({ workflows, logs, stepRuns }),
    [logs, stepRuns, workflows],
  );

  const workflowOptions = useMemo(() => {
    const options = [
      {
        value: "all",
        label: "All Workflows",
      },
    ];

    const uniqueWorkflows = Array.from(
      new Map(
        executions.map((execution) => [
          execution.workflowId,
          execution.workflowName,
        ]),
      ).entries(),
    );

    for (const [workflowId, workflowName] of uniqueWorkflows) {
      options.push({
        value: workflowId,
        label: workflowName,
      });
    }

    return options;
  }, [executions]);

  const filteredExecutions = useMemo(() => {
    const query = search.trim().toLowerCase();

    return executions.filter((execution) => {
      if (workflowFilter !== "all" && execution.workflowId !== workflowFilter) {
        return false;
      }

      if (!query) {
        return true;
      }

      return (
        execution.executionId.toLowerCase().includes(query) ||
        execution.workflowName.toLowerCase().includes(query) ||
        execution.workflowId.toLowerCase().includes(query) ||
        (execution.triggerInfo.source || "").toLowerCase().includes(query) ||
        (execution.triggerInfo.event || "").toLowerCase().includes(query) ||
        (execution.triggerInfo.repository || "").toLowerCase().includes(query)
      );
    });
  }, [executions, search, workflowFilter]);

  useEffect(() => {
    if (
      selectedExecutionId &&
      filteredExecutions.some(
        (execution) => execution.executionId === selectedExecutionId,
      )
    ) {
      return;
    }

    setSelectedExecutionId(filteredExecutions[0]?.executionId || null);
  }, [filteredExecutions, selectedExecutionId]);

  const selectedExecution = useMemo(
    () =>
      filteredExecutions.find(
        (execution) => execution.executionId === selectedExecutionId,
      ) || null,
    [filteredExecutions, selectedExecutionId],
  );

  const selectedErrorLogs = useMemo(() => {
    if (!selectedExecution) {
      return [];
    }

    return selectedExecution.logs.filter((log) => log.level === "error");
  }, [selectedExecution]);

  const selectedFailedSteps = useMemo(() => {
    if (!selectedExecution) {
      return [];
    }

    return selectedExecution.stepRuns.filter((step) =>
      ["failed", "error"].includes(step.status.toLowerCase()),
    );
  }, [selectedExecution]);

  const missingDetailPrompts = useMemo(
    () => detectMissingDetailPrompts(selectedFailedSteps),
    [selectedFailedSteps],
  );

  const missingPromptSignature = useMemo(
    () => missingDetailPrompts.map((prompt) => prompt.key).join("|"),
    [missingDetailPrompts],
  );

  useEffect(() => {
    let isActive = true;

    const hydrateMissingDetailValues = async () => {
      const keys = missingPromptSignature
        ? missingPromptSignature.split("|").filter(Boolean)
        : [];

      const nextValues: Record<string, string> = {};
      for (const key of keys) {
        nextValues[key] = "";
      }

      const prefilledKeys: string[] = [];

      if (keys.length > 0) {
        try {
          const response = await workflowsApi.listMissingDetailsMemory({
            scope: "missing-details",
            keys,
          });

          if (response.success && Array.isArray(response.data)) {
            for (const entry of response.data) {
              if (!entry.detailKey || !keys.includes(entry.detailKey)) {
                continue;
              }

              nextValues[entry.detailKey] = entry.detailValue || "";
              if (entry.detailValue) {
                prefilledKeys.push(entry.detailKey);
              }
            }
          }
        } catch {
          // Ignore prefill failures and continue with blank values.
        }
      }

      if (!isActive) {
        return;
      }

      setMissingDetailValues(nextValues);
      setPrefilledMissingKeys(prefilledKeys);
      setRetryError(null);
      setRetryInfo(null);
      setIsMissingDetailsModalOpen(false);
    };

    void hydrateMissingDetailValues();

    return () => {
      isActive = false;
    };
  }, [missingPromptSignature, selectedExecutionId]);

  const openMissingDetailsModal = useCallback(() => {
    setRetryError(null);
    setRetryInfo(null);
    setIsMissingDetailsModalOpen(true);
  }, []);

  const updateMissingDetailValue = useCallback((key: string, value: string) => {
    setMissingDetailValues((current) => ({
      ...current,
      [key]: value,
    }));
  }, []);

  const startMissingDetailsRetry = useCallback(
    (args: {
      executionId: string;
      payload: Record<string, string>;
      autoTriggered?: boolean;
    }) => {
      if (retryInFlightExecutionIdRef.current) {
        return;
      }

      retryInFlightExecutionIdRef.current = args.executionId;

      // Close immediately so rerun happens in background without blocking the user.
      setIsMissingDetailsModalOpen(false);
      setIsRetrying(true);
      setRetryError(null);
      setRetryInfo(
        args.autoTriggered
          ? "Saved details found in memory. Re-run started automatically in background."
          : "Re-run started in background. You can continue working.",
      );

      const selectedExecutionIdForRetry = args.executionId;
      void (async () => {
        try {
          const response = await workflowsApi.retryMissingDetails(
            selectedExecutionIdForRetry,
            args.payload,
          );

          if (!response.success || !response.data) {
            setRetryInfo(null);
            setRetryError(response.error || "Failed to retry execution.");

            // Keep the auto-trigger guard even on failure to avoid runaway retries.
            // User can still trigger manual retry after updating details.

            return;
          }

          setRetryInfo(
            `Background re-run queued as execution ${response.data.executionId}.`,
          );
          await loadData();
          setSelectedExecutionId(response.data.executionId);
        } finally {
          setIsRetrying(false);

          if (
            retryInFlightExecutionIdRef.current === selectedExecutionIdForRetry
          ) {
            retryInFlightExecutionIdRef.current = null;
          }
        }
      })();
    },
    [loadData],
  );

  const submitMissingDetailsRetry = useCallback(() => {
    if (isRetrying) {
      return;
    }

    if (!selectedExecution) {
      return;
    }

    const payload: Record<string, string> = {};
    for (const prompt of missingDetailPrompts) {
      const value = (missingDetailValues[prompt.key] || "").trim();
      if (value) {
        payload[prompt.key] = value;
      }
    }

    const missingKeys = missingDetailPrompts
      .map((prompt) => prompt.key)
      .filter((key) => !payload[key]);

    if (missingKeys.length > 0) {
      setRetryError(
        `Please provide values for: ${missingKeys
          .map((key) => missingFieldLabel(key))
          .join(", ")}`,
      );
      return;
    }

    startMissingDetailsRetry({
      executionId: selectedExecution.executionId,
      payload,
    });
  }, [
    isRetrying,
    missingDetailPrompts,
    missingDetailValues,
    selectedExecution,
    startMissingDetailsRetry,
  ]);

  useEffect(() => {
    const executionId = selectedExecution?.executionId;
    if (
      !executionId ||
      isRetrying ||
      retryInFlightExecutionIdRef.current ||
      !missingPromptSignature
    ) {
      return;
    }

    const requiredKeys = missingPromptSignature.split("|").filter(Boolean);
    const prefilledSet = new Set(prefilledMissingKeys);
    const payload: Record<string, string> = {};

    for (const key of requiredKeys) {
      const value = (missingDetailValues[key] || "").trim();
      if (value) {
        payload[key] = value;
      }
    }

    const hasAllSavedValues = requiredKeys.every(
      (key) => prefilledSet.has(key) && Boolean(payload[key]),
    );

    if (!hasAllSavedValues) {
      return;
    }

    if (autoRetriedExecutionIdsRef.current.has(executionId)) {
      return;
    }

    autoRetriedExecutionIdsRef.current.add(executionId);
    startMissingDetailsRetry({
      executionId,
      payload,
      autoTriggered: true,
    });
  }, [
    isRetrying,
    missingPromptSignature,
    missingDetailValues,
    prefilledMissingKeys,
    selectedExecution?.executionId,
    startMissingDetailsRetry,
  ]);

  const executionJson = useMemo(() => {
    if (!selectedExecution) {
      return "{}";
    }

    return JSON.stringify(
      {
        executionId: selectedExecution.executionId,
        workflowId: selectedExecution.workflowId,
        workflowName: selectedExecution.workflowName,
        status: selectedExecution.status,
        startedAt: selectedExecution.startedAt,
        endedAt: selectedExecution.endedAt,
        trigger: selectedExecution.triggerInfo,
        triggerPayload: selectedExecution.triggerPayload,
        steps: selectedExecution.stepRuns.map((step) => ({
          stepId: step.stepId,
          toolName: step.toolName,
          status: step.status,
          retryCount: step.retryCount,
          createdAt: step.createdAt,
          updatedAt: step.updatedAt,
          inputPayload: step.inputPayload,
          outputPayload: step.outputPayload,
        })),
      },
      null,
      2,
    );
  }, [selectedExecution]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="mb-0">
          <div>
            <CardTitle>Past Executions</CardTitle>
            <CardDescription>
              Review historical workflow executions with trigger context, JSON
              payloads, audit logs, and failures.
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent>
          <div className="grid gap-3 md:grid-cols-[2fr,1fr,auto]">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by workflow, execution ID, source, event, repository"
              isSearch
              leftIcon={<Search className="h-4 w-4" />}
            />

            <Select
              value={workflowFilter}
              onChange={(value) => setWorkflowFilter(value)}
              options={workflowOptions}
            />

            <Button
              variant="outline"
              isLoading={isRefreshing}
              leftIcon={<RefreshCw className="h-4 w-4" />}
              onClick={() => void loadData()}
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
            Loading past executions...
          </CardContent>
        </Card>
      ) : null}

      {!isLoading && filteredExecutions.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-content-secondary">
            No execution history found for your filters.
          </CardContent>
        </Card>
      ) : null}

      {!isLoading && filteredExecutions.length > 0 && selectedExecution ? (
        <div className="grid gap-4 xl:h-[calc(100vh-15rem)] xl:grid-cols-[340px,1fr]">
          <Card className="h-fit xl:sticky xl:top-4 xl:h-[calc(100vh-15rem)]">
            <CardHeader>
              <div>
                <CardTitle className="text-base">Execution Runs</CardTitle>
                <CardDescription>
                  {filteredExecutions.length} historical executions
                </CardDescription>
              </div>
            </CardHeader>

            <CardContent>
              <div className="max-h-[65vh] space-y-2 overflow-auto pr-1 xl:max-h-[calc(100vh-21rem)]">
                {filteredExecutions.map((execution) => {
                  const isSelected =
                    execution.executionId === selectedExecution.executionId;
                  return (
                    <button
                      key={execution.executionId}
                      type="button"
                      onClick={() =>
                        setSelectedExecutionId(execution.executionId)
                      }
                      className={`w-full rounded-lg border p-3 text-left transition-colors ${
                        isSelected
                          ? "border-primary bg-primary-light/40"
                          : "border-border hover:bg-surface-secondary"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-content-primary">
                            {execution.workflowName}
                          </p>
                          <p className="mt-1 text-xs text-content-secondary">
                            {execution.executionId}
                          </p>
                        </div>
                        <Badge variant={statusVariant(execution.status)}>
                          {execution.status}
                        </Badge>
                      </div>

                      <div className="mt-2 space-y-1 text-xs text-content-secondary">
                        <p className="flex items-center gap-1">
                          <Clock3 className="h-3.5 w-3.5" />
                          {formatDateTime(execution.startedAt)}
                        </p>
                        <p>
                          Logs: {execution.totalLogs} • Steps:{" "}
                          {execution.stepCount} • Errors: {execution.errorCount}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <div className="space-y-4 overflow-hidden xl:h-[calc(100vh-15rem)] xl:overflow-y-auto xl:pr-1">
            <div className="grid gap-3 md:grid-cols-4">
              <Card>
                <CardContent className="py-4">
                  <p className="text-xs text-content-secondary">Status</p>
                  <div className="mt-1 flex items-center gap-2">
                    <Badge variant={statusVariant(selectedExecution.status)}>
                      {selectedExecution.status}
                    </Badge>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="py-4">
                  <p className="text-xs text-content-secondary">Started</p>
                  <p className="mt-1 text-sm font-medium text-content-primary">
                    {formatDateTime(selectedExecution.startedAt)}
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="py-4">
                  <p className="text-xs text-content-secondary">Audit Logs</p>
                  <p className="mt-1 text-sm font-medium text-content-primary">
                    {selectedExecution.totalLogs}
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="py-4">
                  <p className="text-xs text-content-secondary">Errors</p>
                  <p className="mt-1 text-sm font-medium text-content-primary">
                    {selectedExecution.errorCount}
                  </p>
                </CardContent>
              </Card>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <Card>
                <CardHeader>
                  <div>
                    <CardTitle className="text-base">Trigger Info</CardTitle>
                    <CardDescription>
                      Source event details captured for this execution.
                    </CardDescription>
                  </div>
                </CardHeader>

                <CardContent className="space-y-3">
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-md border border-border bg-surface-secondary p-3">
                      <p className="text-xs text-content-secondary">Source</p>
                      <p className="mt-1 text-sm font-medium text-content-primary">
                        {selectedExecution.triggerInfo.source || "N/A"}
                      </p>
                    </div>
                    <div className="rounded-md border border-border bg-surface-secondary p-3">
                      <p className="text-xs text-content-secondary">Event</p>
                      <p className="mt-1 text-sm font-medium text-content-primary">
                        {selectedExecution.triggerInfo.event || "N/A"}
                      </p>
                    </div>
                    <div className="rounded-md border border-border bg-surface-secondary p-3">
                      <p className="text-xs text-content-secondary">Trigger</p>
                      <p className="mt-1 text-sm font-medium text-content-primary">
                        {selectedExecution.triggerInfo.trigger || "N/A"}
                      </p>
                    </div>
                    <div className="rounded-md border border-border bg-surface-secondary p-3">
                      <p className="text-xs text-content-secondary">
                        Repository
                      </p>
                      <p className="mt-1 text-sm font-medium text-content-primary">
                        {selectedExecution.triggerInfo.repository || "N/A"}
                      </p>
                    </div>
                  </div>

                  <details
                    className="rounded-md border border-border bg-surface-secondary p-3"
                    open
                  >
                    <summary className="cursor-pointer text-sm font-medium text-content-primary">
                      Trigger Payload JSON
                    </summary>
                    <pre className="mt-2 max-h-44 overflow-auto text-xs text-content-primary">
                      {JSON.stringify(
                        selectedExecution.triggerPayload,
                        null,
                        2,
                      )}
                    </pre>
                  </details>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <div>
                    <CardTitle className="text-base">Execution JSON</CardTitle>
                    <CardDescription>
                      Full run snapshot with step inputs and outputs.
                    </CardDescription>
                  </div>
                </CardHeader>

                <CardContent>
                  <pre className="max-h-[22rem] overflow-auto rounded-md border border-border bg-surface-secondary p-3 text-xs text-content-primary">
                    {executionJson}
                  </pre>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <div>
                  <CardTitle className="text-base">Errors</CardTitle>
                  <CardDescription>
                    Failed audit entries and failed step runs for this
                    execution.
                  </CardDescription>
                </div>
              </CardHeader>

              <CardContent className="space-y-4">
                {missingDetailPrompts.length > 0 ? (
                  <div className="animate-pulse rounded-md border-2 border-error/70 bg-error/15 p-3 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="flex items-center gap-2 text-sm font-semibold text-error">
                          <AlertCircle className="h-4 w-4" />
                          Missing Details Required
                        </p>
                        <p className="mt-1 text-sm text-content-primary">
                          This execution failed because required inputs are
                          missing. Click below, provide details, and rerun.
                        </p>
                        <p className="mt-2 text-xs text-content-secondary">
                          Required:{" "}
                          {missingDetailPrompts
                            .map((prompt) => prompt.label)
                            .join(", ")}
                        </p>
                      </div>

                      <Button
                        variant="danger"
                        size="sm"
                        onClick={openMissingDetailsModal}
                      >
                        Fix Missing Details
                      </Button>
                    </div>
                  </div>
                ) : null}

                {retryInfo ? (
                  <p className="flex items-center gap-2 text-sm text-success">
                    {isRetrying ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : null}
                    {retryInfo}
                  </p>
                ) : null}

                {retryError ? (
                  <p className="text-sm text-error">{retryError}</p>
                ) : null}

                <div>
                  <p className="mb-2 text-sm font-medium text-content-primary">
                    Audit Errors ({selectedErrorLogs.length})
                  </p>
                  {selectedErrorLogs.length === 0 ? (
                    <p className="text-sm text-content-secondary">
                      No error-level audit logs for this execution.
                    </p>
                  ) : (
                    <div className="max-h-56 space-y-2 overflow-auto pr-1">
                      {selectedErrorLogs.map((log) => (
                        <div
                          key={log.id}
                          className="rounded-md border border-error/30 bg-error/10 p-3"
                        >
                          <p className="text-sm font-medium text-error">
                            {log.action}
                          </p>
                          <p className="mt-1 text-sm text-content-primary">
                            {log.message}
                          </p>
                          <p className="mt-1 text-xs text-content-secondary">
                            {formatDateTime(log.timestamp)}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <p className="mb-2 text-sm font-medium text-content-primary">
                    Failed Steps ({selectedFailedSteps.length})
                  </p>
                  {selectedFailedSteps.length === 0 ? (
                    <p className="text-sm text-content-secondary">
                      No failed steps for this execution.
                    </p>
                  ) : (
                    <div className="max-h-64 space-y-2 overflow-auto pr-1">
                      {selectedFailedSteps.map((step) => (
                        <div
                          key={step.stepId}
                          className="rounded-md border border-error/30 bg-error/10 p-3"
                        >
                          <p className="text-sm font-medium text-error">
                            {step.toolName}
                          </p>
                          <p className="mt-1 text-xs text-content-secondary">
                            Step ID: {step.stepId}
                          </p>
                          <pre className="mt-2 max-h-40 overflow-auto rounded-md border border-border bg-surface-secondary p-2 text-xs text-content-primary">
                            {JSON.stringify(step.outputPayload || {}, null, 2)}
                          </pre>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div>
                  <CardTitle className="text-base">Audit Logs</CardTitle>
                  <CardDescription>
                    Detailed execution timeline with action-level logs.
                  </CardDescription>
                </div>
              </CardHeader>

              <CardContent className="max-h-[28rem] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time</TableHead>
                      <TableHead>Level</TableHead>
                      <TableHead>Service</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Message</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedExecution.logs.length === 0 ? (
                      <TableEmpty
                        icon={<FileJson className="h-5 w-5" />}
                        title="No audit logs"
                        description="No audit entries are available for the selected execution."
                      />
                    ) : (
                      selectedExecution.logs.map((log) => (
                        <TableRow key={log.id}>
                          <TableCell className="whitespace-nowrap text-xs text-content-secondary">
                            {formatDateTime(log.timestamp)}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={log.level === "error" ? "error" : "info"}
                              size="sm"
                            >
                              {log.level}
                            </Badge>
                          </TableCell>
                          <TableCell>{log.service}</TableCell>
                          <TableCell>{log.action}</TableCell>
                          <TableCell className="max-w-[420px] truncate">
                            {log.message}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </div>
      ) : null}

      <Modal
        isOpen={isMissingDetailsModalOpen}
        onClose={() => setIsMissingDetailsModalOpen(false)}
        title="Missing Details"
        description="Provide required values and rerun this failed execution."
        size="lg"
      >
        <div className="space-y-4">
          <p className="text-sm text-content-secondary">
            This run failed because one or more required fields were missing.
            Add the values below, then rerun.
          </p>

          {missingDetailPrompts.length === 0 ? (
            <p className="text-sm text-content-secondary">
              No missing fields are currently detected for this execution.
            </p>
          ) : (
            <div className="space-y-3">
              {missingDetailPrompts.map((prompt) => (
                <div
                  key={prompt.key}
                  className="rounded-md border border-border p-3"
                >
                  <Input
                    label={prompt.label}
                    value={missingDetailValues[prompt.key] || ""}
                    placeholder={`Enter ${prompt.label.toLowerCase()}`}
                    onChange={(event) =>
                      updateMissingDetailValue(prompt.key, event.target.value)
                    }
                  />
                  <p className="mt-2 text-xs text-content-secondary">
                    {prompt.toolName} • {prompt.stepId}
                  </p>
                  {prefilledMissingKeys.includes(prompt.key) ? (
                    <p className="mt-1 text-xs text-success">
                      Prefilled from Saved Data
                    </p>
                  ) : null}
                  <p className="mt-1 text-xs text-content-secondary">
                    {prompt.reason}
                  </p>
                </div>
              ))}
            </div>
          )}

          {retryError ? (
            <p className="text-sm text-error">{retryError}</p>
          ) : null}

          <ModalFooter>
            <Button
              variant="outline"
              onClick={() => setIsMissingDetailsModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              isLoading={isRetrying}
              onClick={() => void submitMissingDetailsRetry()}
            >
              Save Details and Re-run
            </Button>
          </ModalFooter>
        </div>
      </Modal>
    </div>
  );
}
