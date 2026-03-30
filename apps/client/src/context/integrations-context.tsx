"use client";

import React, {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useEffect,
} from "react";
import {
  Integration,
  ServiceId,
  ConnectionStatus,
  IntegrationCredentials,
} from "@/types";
import { integrationsApi } from "@/lib/api";

// Initial integrations data
const initialIntegrations: Integration[] = [
  {
    id: "jira",
    name: "Jira",
    description: "Project management and issue tracking",
    category: "project_management",
    icon: "ClipboardList",
    status: "disconnected",
    enabled: false,
    tools: [
      {
        name: "create_issue",
        description: "Create a new Jira issue",
        inputSchema: {},
        requiresApproval: false,
      },
      {
        name: "get_issue",
        description: "Get Jira issue details by key",
        inputSchema: {},
        requiresApproval: false,
      },
      {
        name: "update_issue",
        description: "Update an existing issue",
        inputSchema: {},
        requiresApproval: false,
      },
      {
        name: "transition_issue",
        description: "Change issue status",
        inputSchema: {},
        requiresApproval: false,
      },
      {
        name: "search_issues",
        description: "Search for issues using JQL",
        inputSchema: {},
        requiresApproval: false,
      },
      {
        name: "add_comment",
        description: "Add comment to issue",
        inputSchema: {},
        requiresApproval: false,
      },
    ],
    config: {
      baseUrl: "https://company.atlassian.net",
      projectId: "PROJ",
    },
  },
  {
    id: "slack",
    name: "Slack",
    description: "Team communication and messaging",
    category: "communication",
    icon: "MessageSquare",
    status: "disconnected",
    enabled: false,
    tools: [
      {
        name: "send_message",
        description: "Send a message to a channel",
        inputSchema: {},
        requiresApproval: false,
      },
      {
        name: "create_channel",
        description: "Create a new channel",
        inputSchema: {},
        requiresApproval: true,
      },
      {
        name: "list_channels",
        description: "List all channels",
        inputSchema: {},
        requiresApproval: false,
      },
      {
        name: "list_users",
        description: "List workspace users",
        inputSchema: {},
        requiresApproval: false,
      },
      {
        name: "send_dm",
        description: "Send direct message",
        inputSchema: {},
        requiresApproval: false,
      },
    ],
    config: {
      channelId: "#general",
    },
  },
  {
    id: "github",
    name: "GitHub",
    description: "Code hosting and version control",
    category: "devops",
    icon: "Github",
    status: "disconnected",
    enabled: false,
    tools: [
      {
        name: "create_branch",
        description: "Create a new branch",
        inputSchema: {},
        requiresApproval: false,
      },
      {
        name: "create_pr",
        description: "Create a pull request",
        inputSchema: {},
        requiresApproval: true,
      },
      {
        name: "merge_pr",
        description: "Merge a pull request",
        inputSchema: {},
        requiresApproval: true,
      },
      {
        name: "create_issue",
        description: "Create a GitHub issue",
        inputSchema: {},
        requiresApproval: false,
      },
      {
        name: "list_repos",
        description: "List repositories",
        inputSchema: {},
        requiresApproval: false,
      },
      {
        name: "run_action",
        description: "Trigger a GitHub Action",
        inputSchema: {},
        requiresApproval: true,
      },
    ],
    config: {
      orgName: "company",
      repoName: "main-repo",
    },
  },
  {
    id: "google_sheets",
    name: "Google Sheets",
    description: "Spreadsheet automation and reporting",
    category: "data_analytics",
    icon: "Table2",
    status: "disconnected",
    enabled: false,
    tools: [
      {
        name: "read_sheet",
        description: "Read rows from a spreadsheet",
        inputSchema: {},
        requiresApproval: false,
      },
      {
        name: "append_rows",
        description: "Append rows to a spreadsheet",
        inputSchema: {},
        requiresApproval: false,
      },
      {
        name: "update_cells",
        description: "Update specific sheet ranges",
        inputSchema: {},
        requiresApproval: false,
      },
    ],
    config: {
      databaseName: "operations",
    },
  },
  {
    id: "gmail",
    name: "Gmail",
    description: "Email automation and inbox operations",
    category: "communication",
    icon: "Mail",
    status: "disconnected",
    enabled: false,
    tools: [
      {
        name: "list_messages",
        description: "List recent emails",
        inputSchema: {},
        requiresApproval: false,
      },
      {
        name: "send_message",
        description: "Send an email",
        inputSchema: {},
        requiresApproval: true,
      },
      {
        name: "search_messages",
        description: "Search emails with Gmail query syntax",
        inputSchema: {},
        requiresApproval: false,
      },
    ],
    config: {
      channelId: "support@company.com",
    },
  },
  {
    id: "aws",
    name: "AWS",
    description: "Cloud infrastructure and service control",
    category: "devops",
    icon: "Cloud",
    status: "disconnected",
    enabled: false,
    tools: [
      {
        name: "list_resources",
        description: "List selected cloud resources",
        inputSchema: {},
        requiresApproval: false,
      },
      {
        name: "invoke_lambda",
        description: "Invoke Lambda function",
        inputSchema: {},
        requiresApproval: true,
      },
      {
        name: "describe_stack",
        description: "Inspect CloudFormation stack state",
        inputSchema: {},
        requiresApproval: false,
      },
    ],
    config: {
      orgName: "aws-account",
    },
  },
];

// State
interface IntegrationsState {
  integrations: Integration[];
  isLoading: boolean;
  error: string | null;
}

// Actions
type IntegrationsAction =
  | { type: "SET_INTEGRATIONS"; payload: Integration[] }
  | {
      type: "UPDATE_INTEGRATION";
      payload: { id: ServiceId; updates: Partial<Integration> };
    }
  | { type: "TOGGLE_INTEGRATION"; payload: ServiceId }
  | {
      type: "CONNECT_INTEGRATION";
      payload: { id: ServiceId; credentials: IntegrationCredentials };
    }
  | { type: "DISCONNECT_INTEGRATION"; payload: ServiceId }
  | { type: "SET_LOADING"; payload: boolean }
  | { type: "SET_ERROR"; payload: string | null };

const initialState: IntegrationsState = {
  integrations: initialIntegrations,
  isLoading: false,
  error: null,
};

function integrationsReducer(
  state: IntegrationsState,
  action: IntegrationsAction,
): IntegrationsState {
  switch (action.type) {
    case "SET_INTEGRATIONS":
      return { ...state, integrations: action.payload };
    case "UPDATE_INTEGRATION":
      return {
        ...state,
        integrations: state.integrations.map((int) =>
          int.id === action.payload.id
            ? { ...int, ...action.payload.updates }
            : int,
        ),
      };
    case "TOGGLE_INTEGRATION":
      return {
        ...state,
        integrations: state.integrations.map((int) =>
          int.id === action.payload ? { ...int, enabled: !int.enabled } : int,
        ),
      };
    case "CONNECT_INTEGRATION":
      return {
        ...state,
        integrations: state.integrations.map((int) =>
          int.id === action.payload.id
            ? {
                ...int,
                status: "connected" as ConnectionStatus,
                enabled: true,
                credentials: action.payload.credentials,
                lastSynced: new Date(),
              }
            : int,
        ),
      };
    case "DISCONNECT_INTEGRATION":
      return {
        ...state,
        integrations: state.integrations.map((int) =>
          int.id === action.payload
            ? {
                ...int,
                status: "disconnected" as ConnectionStatus,
                enabled: false,
                credentials: undefined,
              }
            : int,
        ),
      };
    case "SET_LOADING":
      return { ...state, isLoading: action.payload };
    case "SET_ERROR":
      return { ...state, error: action.payload };
    default:
      return state;
  }
}

// Context
interface IntegrationsContextType extends IntegrationsState {
  toggleIntegration: (id: ServiceId) => void;
  connectIntegration: (
    id: ServiceId,
    credentials: IntegrationCredentials,
  ) => Promise<void>;
  disconnectIntegration: (id: ServiceId) => Promise<void>;
  updateIntegration: (id: ServiceId, updates: Partial<Integration>) => void;
  getConnectedIntegrations: () => Integration[];
  getIntegrationById: (id: ServiceId) => Integration | undefined;
  getAvailableTools: () => {
    service: string;
    tool: string;
    description: string;
  }[];
}

const IntegrationsContext = createContext<IntegrationsContextType | undefined>(
  undefined,
);

export function IntegrationsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [state, dispatch] = useReducer(integrationsReducer, initialState);

  const loadIntegrationStatuses = useCallback(async () => {
    const token =
      typeof window !== "undefined" ? localStorage.getItem("auth_token") : null;
    if (!token) {
      dispatch({ type: "SET_LOADING", payload: false });
      return;
    }

    dispatch({ type: "SET_LOADING", payload: true });

    const response = await integrationsApi.list();
    if (!response.success || !response.data) {
      dispatch({
        type: "SET_ERROR",
        payload: response.error || "Failed to load integrations",
      });
      dispatch({ type: "SET_LOADING", payload: false });
      return;
    }

    const serviceMap: Record<string, ServiceId> = {
      jira: "jira",
      slack: "slack",
      github: "github",
      google_sheets: "google_sheets",
      gmail: "gmail",
      aws: "aws",
    };

    const merged = initialIntegrations.map((integration) => {
      const backend = response.data?.find(
        (item) => serviceMap[item.service] === integration.id,
      );
      if (!backend) {
        return integration;
      }

      return {
        ...integration,
        status: backend.status as ConnectionStatus,
        enabled: backend.status === "connected",
        lastSynced: backend.lastSync ? new Date(backend.lastSync) : undefined,
      };
    });

    dispatch({ type: "SET_INTEGRATIONS", payload: merged });
    dispatch({ type: "SET_LOADING", payload: false });
  }, []);

  useEffect(() => {
    void loadIntegrationStatuses();
  }, [loadIntegrationStatuses]);

  const toggleIntegration = useCallback(
    (id: ServiceId) => {
      const integration = state.integrations.find((int) => int.id === id);
      if (integration?.status !== "connected") return;
      dispatch({ type: "TOGGLE_INTEGRATION", payload: id });
    },
    [state.integrations],
  );

  const connectIntegration = useCallback(
    async (id: ServiceId, credentials: IntegrationCredentials) => {
      dispatch({ type: "SET_LOADING", payload: true });

      const response = await integrationsApi.connect(
        id,
        credentials as unknown as Record<string, unknown>,
      );
      if (!response.success) {
        const errorMessage = response.error || "Failed to connect integration";
        dispatch({ type: "SET_ERROR", payload: errorMessage });
        dispatch({
          type: "UPDATE_INTEGRATION",
          payload: {
            id,
            updates: {
              status: "error",
              enabled: false,
              lastSynced: undefined,
            },
          },
        });
        dispatch({ type: "SET_LOADING", payload: false });
        throw new Error(errorMessage);
      }

      dispatch({ type: "SET_ERROR", payload: null });
      dispatch({ type: "CONNECT_INTEGRATION", payload: { id, credentials } });
      dispatch({ type: "SET_LOADING", payload: false });
    },
    [],
  );

  const disconnectIntegration = useCallback(async (id: ServiceId) => {
    dispatch({ type: "SET_LOADING", payload: true });

    const response = await integrationsApi.disconnect(id);
    if (!response.success) {
      dispatch({
        type: "SET_ERROR",
        payload: response.error || "Failed to disconnect integration",
      });
      dispatch({ type: "SET_LOADING", payload: false });
      return;
    }

    dispatch({ type: "SET_ERROR", payload: null });
    dispatch({ type: "DISCONNECT_INTEGRATION", payload: id });
    dispatch({ type: "SET_LOADING", payload: false });
  }, []);

  const updateIntegration = useCallback(
    (id: ServiceId, updates: Partial<Integration>) => {
      dispatch({ type: "UPDATE_INTEGRATION", payload: { id, updates } });
    },
    [],
  );

  const getConnectedIntegrations = useCallback(() => {
    return state.integrations.filter(
      (int) => int.status === "connected" && int.enabled,
    );
  }, [state.integrations]);

  const getIntegrationById = useCallback(
    (id: ServiceId) => {
      return state.integrations.find((int) => int.id === id);
    },
    [state.integrations],
  );

  const getAvailableTools = useCallback(() => {
    const tools: { service: string; tool: string; description: string }[] = [];
    state.integrations
      .filter((int) => int.status === "connected" && int.enabled)
      .forEach((int) => {
        int.tools.forEach((tool) => {
          tools.push({
            service: int.name,
            tool: tool.name,
            description: tool.description,
          });
        });
      });
    return tools;
  }, [state.integrations]);

  return (
    <IntegrationsContext.Provider
      value={{
        ...state,
        toggleIntegration,
        connectIntegration,
        disconnectIntegration,
        updateIntegration,
        getConnectedIntegrations,
        getIntegrationById,
        getAvailableTools,
      }}
    >
      {children}
    </IntegrationsContext.Provider>
  );
}

export function useIntegrations() {
  const context = useContext(IntegrationsContext);
  if (context === undefined) {
    throw new Error(
      "useIntegrations must be used within an IntegrationsProvider",
    );
  }
  return context;
}
