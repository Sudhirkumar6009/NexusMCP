'use client';

import React, { createContext, useContext, useReducer, useCallback } from 'react';
import { Integration, ServiceId, ConnectionStatus, IntegrationCredentials } from '@/types';

// Initial integrations data
const initialIntegrations: Integration[] = [
  {
    id: 'jira',
    name: 'Jira',
    description: 'Project management and issue tracking',
    category: 'project_management',
    icon: 'ClipboardList',
    status: 'connected',
    enabled: true,
    lastSynced: new Date(Date.now() - 1000 * 60 * 5), // 5 mins ago
    credentials: {
      apiKey: 'jira_api_key_xxxxxxxxxxxxx',
      scopes: ['read:jira-work', 'write:jira-work', 'read:jira-user'],
    },
    tools: [
      { name: 'create_issue', description: 'Create a new Jira issue', inputSchema: {}, requiresApproval: false },
      { name: 'update_issue', description: 'Update an existing issue', inputSchema: {}, requiresApproval: false },
      { name: 'transition_issue', description: 'Change issue status', inputSchema: {}, requiresApproval: false },
      { name: 'search_issues', description: 'Search for issues using JQL', inputSchema: {}, requiresApproval: false },
      { name: 'add_comment', description: 'Add comment to issue', inputSchema: {}, requiresApproval: false },
    ],
    config: {
      baseUrl: 'https://company.atlassian.net',
      projectId: 'PROJ',
    },
  },
  {
    id: 'slack',
    name: 'Slack',
    description: 'Team communication and messaging',
    category: 'communication',
    icon: 'MessageSquare',
    status: 'connected',
    enabled: true,
    lastSynced: new Date(Date.now() - 1000 * 60 * 2), // 2 mins ago
    credentials: {
      accessToken: 'xoxb-slack-token-xxxxxxxxx',
      scopes: ['chat:write', 'channels:read', 'users:read'],
    },
    tools: [
      { name: 'send_message', description: 'Send a message to a channel', inputSchema: {}, requiresApproval: false },
      { name: 'create_channel', description: 'Create a new channel', inputSchema: {}, requiresApproval: true },
      { name: 'list_channels', description: 'List all channels', inputSchema: {}, requiresApproval: false },
      { name: 'list_users', description: 'List workspace users', inputSchema: {}, requiresApproval: false },
      { name: 'send_dm', description: 'Send direct message', inputSchema: {}, requiresApproval: false },
    ],
    config: {
      channelId: '#general',
    },
  },
  {
    id: 'github',
    name: 'GitHub',
    description: 'Code hosting and version control',
    category: 'devops',
    icon: 'Github',
    status: 'disconnected',
    enabled: false,
    tools: [
      { name: 'create_branch', description: 'Create a new branch', inputSchema: {}, requiresApproval: false },
      { name: 'create_pr', description: 'Create a pull request', inputSchema: {}, requiresApproval: true },
      { name: 'merge_pr', description: 'Merge a pull request', inputSchema: {}, requiresApproval: true },
      { name: 'create_issue', description: 'Create a GitHub issue', inputSchema: {}, requiresApproval: false },
      { name: 'list_repos', description: 'List repositories', inputSchema: {}, requiresApproval: false },
      { name: 'run_action', description: 'Trigger a GitHub Action', inputSchema: {}, requiresApproval: true },
    ],
    config: {
      orgName: 'company',
      repoName: 'main-repo',
    },
  },
  {
    id: 'postgresql',
    name: 'PostgreSQL',
    description: 'Relational database for data storage',
    category: 'data_analytics',
    icon: 'Database',
    status: 'connected',
    enabled: true,
    lastSynced: new Date(Date.now() - 1000 * 60 * 10), // 10 mins ago
    credentials: {
      apiKey: 'postgresql_connection_string_xxx',
      scopes: ['SELECT', 'INSERT', 'UPDATE'],
    },
    tools: [
      { name: 'query', description: 'Execute a SELECT query', inputSchema: {}, requiresApproval: false },
      { name: 'insert_record', description: 'Insert a new record', inputSchema: {}, requiresApproval: false },
      { name: 'update_record', description: 'Update existing records', inputSchema: {}, requiresApproval: false },
      { name: 'delete_record', description: 'Delete records', inputSchema: {}, requiresApproval: true },
      { name: 'execute_function', description: 'Execute a stored function', inputSchema: {}, requiresApproval: false },
    ],
    config: {
      databaseName: 'production_db',
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
  | { type: 'SET_INTEGRATIONS'; payload: Integration[] }
  | { type: 'UPDATE_INTEGRATION'; payload: { id: ServiceId; updates: Partial<Integration> } }
  | { type: 'TOGGLE_INTEGRATION'; payload: ServiceId }
  | { type: 'CONNECT_INTEGRATION'; payload: { id: ServiceId; credentials: IntegrationCredentials } }
  | { type: 'DISCONNECT_INTEGRATION'; payload: ServiceId }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string | null };

const initialState: IntegrationsState = {
  integrations: initialIntegrations,
  isLoading: false,
  error: null,
};

function integrationsReducer(state: IntegrationsState, action: IntegrationsAction): IntegrationsState {
  switch (action.type) {
    case 'SET_INTEGRATIONS':
      return { ...state, integrations: action.payload };
    case 'UPDATE_INTEGRATION':
      return {
        ...state,
        integrations: state.integrations.map((int) =>
          int.id === action.payload.id ? { ...int, ...action.payload.updates } : int
        ),
      };
    case 'TOGGLE_INTEGRATION':
      return {
        ...state,
        integrations: state.integrations.map((int) =>
          int.id === action.payload ? { ...int, enabled: !int.enabled } : int
        ),
      };
    case 'CONNECT_INTEGRATION':
      return {
        ...state,
        integrations: state.integrations.map((int) =>
          int.id === action.payload.id
            ? {
                ...int,
                status: 'connected' as ConnectionStatus,
                enabled: true,
                credentials: action.payload.credentials,
                lastSynced: new Date(),
              }
            : int
        ),
      };
    case 'DISCONNECT_INTEGRATION':
      return {
        ...state,
        integrations: state.integrations.map((int) =>
          int.id === action.payload
            ? {
                ...int,
                status: 'disconnected' as ConnectionStatus,
                enabled: false,
                credentials: undefined,
              }
            : int
        ),
      };
    case 'SET_LOADING':
      return { ...state, isLoading: action.payload };
    case 'SET_ERROR':
      return { ...state, error: action.payload };
    default:
      return state;
  }
}

// Context
interface IntegrationsContextType extends IntegrationsState {
  toggleIntegration: (id: ServiceId) => void;
  connectIntegration: (id: ServiceId, credentials: IntegrationCredentials) => Promise<void>;
  disconnectIntegration: (id: ServiceId) => void;
  updateIntegration: (id: ServiceId, updates: Partial<Integration>) => void;
  getConnectedIntegrations: () => Integration[];
  getIntegrationById: (id: ServiceId) => Integration | undefined;
  getAvailableTools: () => { service: string; tool: string; description: string }[];
}

const IntegrationsContext = createContext<IntegrationsContextType | undefined>(undefined);

export function IntegrationsProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(integrationsReducer, initialState);

  const toggleIntegration = useCallback((id: ServiceId) => {
    const integration = state.integrations.find((int) => int.id === id);
    if (integration?.status !== 'connected') return;
    dispatch({ type: 'TOGGLE_INTEGRATION', payload: id });
  }, [state.integrations]);

  const connectIntegration = useCallback(async (id: ServiceId, credentials: IntegrationCredentials) => {
    dispatch({ type: 'SET_LOADING', payload: true });
    
    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 1500));
    
    dispatch({ type: 'CONNECT_INTEGRATION', payload: { id, credentials } });
    dispatch({ type: 'SET_LOADING', payload: false });
  }, []);

  const disconnectIntegration = useCallback((id: ServiceId) => {
    dispatch({ type: 'DISCONNECT_INTEGRATION', payload: id });
  }, []);

  const updateIntegration = useCallback((id: ServiceId, updates: Partial<Integration>) => {
    dispatch({ type: 'UPDATE_INTEGRATION', payload: { id, updates } });
  }, []);

  const getConnectedIntegrations = useCallback(() => {
    return state.integrations.filter((int) => int.status === 'connected' && int.enabled);
  }, [state.integrations]);

  const getIntegrationById = useCallback((id: ServiceId) => {
    return state.integrations.find((int) => int.id === id);
  }, [state.integrations]);

  const getAvailableTools = useCallback(() => {
    const tools: { service: string; tool: string; description: string }[] = [];
    state.integrations
      .filter((int) => int.status === 'connected' && int.enabled)
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
    throw new Error('useIntegrations must be used within an IntegrationsProvider');
  }
  return context;
}
