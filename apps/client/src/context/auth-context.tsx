'use client';

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { User, UserRole, UserPermissions, Session, GlobalSettings, LLMConfig, ExecutionPolicy } from '@/types';

const AUTH_TOKEN_UPDATED_EVENT = 'auth-token-updated';

const rolePermissions: Record<UserRole, UserPermissions> = {
  admin: {
    canExecuteWorkflows: true,
    canApproveOperations: true,
    canModifyIntegrations: true,
    canViewAuditLogs: true,
    canModifySettings: true,
    canManageUsers: true,
    allowedServices: [],
    allowedTools: [],
  },
  operator: {
    canExecuteWorkflows: true,
    canApproveOperations: true,
    canModifyIntegrations: false,
    canViewAuditLogs: true,
    canModifySettings: false,
    canManageUsers: false,
    allowedServices: [],
    allowedTools: [],
  },
  viewer: {
    canExecuteWorkflows: false,
    canApproveOperations: false,
    canModifyIntegrations: false,
    canViewAuditLogs: true,
    canModifySettings: false,
    canManageUsers: false,
    allowedServices: [],
    allowedTools: [],
  },
};

interface BackendUser {
  id?: string;
  _id?: string;
  email?: string;
  name?: string;
  avatar?: string;
  role?: string;
  createdAt?: string | Date;
  lastLogin?: string | Date;
  lastLoginAt?: string | Date;
}

function toRole(role?: string): UserRole {
  return role === 'admin' || role === 'operator' || role === 'viewer' ? role : 'viewer';
}

function mapBackendUser(data: BackendUser): User {
  const role = toRole(data.role);

  return {
    id: data.id || data._id || 'user-1',
    email: data.email || '',
    name: data.name || 'User',
    avatar: data.avatar,
    role,
    permissions: rolePermissions[role],
    createdAt: data.createdAt ? new Date(data.createdAt) : new Date(),
    lastLoginAt: data.lastLoginAt
      ? new Date(data.lastLoginAt)
      : data.lastLogin
        ? new Date(data.lastLogin)
        : undefined,
  };
}

// Default sessions
const defaultSessions: Session[] = [
  {
    id: 'session-1',
    userId: 'user-1',
    device: 'Windows PC',
    browser: 'Chrome 120',
    ip: '192.168.1.100',
    location: 'San Francisco, CA',
    createdAt: new Date(),
    lastActiveAt: new Date(),
    isCurrent: true,
  },
  {
    id: 'session-2',
    userId: 'user-1',
    device: 'MacBook Pro',
    browser: 'Safari 17',
    ip: '192.168.1.101',
    location: 'San Francisco, CA',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24), // 1 day ago
    lastActiveAt: new Date(Date.now() - 1000 * 60 * 30), // 30 mins ago
    isCurrent: false,
  },
];

// Default settings
const defaultSettings: GlobalSettings = {
  llmConfig: {
    provider: 'anthropic',
    model: 'claude-3-sonnet',
    apiKey: '',
    maxTokens: 4096,
    temperature: 0.7,
  },
  executionPolicy: {
    maxRetries: 3,
    retryDelayMs: 1000,
    timeoutMs: 30000,
    parallelExecutionEnabled: true,
    requireApprovalForSensitive: true,
    autoApproveForAdmins: false,
  },
  notifications: {
    emailEnabled: true,
    slackEnabled: true,
    onSuccess: false,
    onFailure: true,
    onApprovalRequired: true,
  },
};

interface AuthContextType {
  user: User | null;
  sessions: Session[];
  settings: GlobalSettings;
  isAuthenticated: boolean;
  refreshUser: () => Promise<void>;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => void;
  updateUser: (updates: Partial<User>) => void;
  updateRole: (role: UserRole) => void;
  updatePermissions: (permissions: Partial<UserPermissions>) => void;
  updateSettings: (settings: Partial<GlobalSettings>) => void;
  updateLLMConfig: (config: Partial<LLMConfig>) => void;
  updateExecutionPolicy: (policy: Partial<ExecutionPolicy>) => void;
  terminateSession: (sessionId: string) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [sessions, setSessions] = useState<Session[]>(defaultSessions);
  const [settings, setSettings] = useState<GlobalSettings>(defaultSettings);

  const refreshUser = useCallback(async () => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;

    if (!token) {
      setUser(null);
      return;
    }

    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

    try {
      const response = await fetch(`${apiUrl}/api/auth/me`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to load user profile');
      }

      const payload = await response.json();
      if (payload?.success && payload.data) {
        setUser(mapBackendUser(payload.data as BackendUser));
        return;
      }

      throw new Error('Invalid profile response');
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    void refreshUser();

    const onTokenUpdated = () => {
      void refreshUser();
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key === 'auth_token') {
        void refreshUser();
      }
    };

    window.addEventListener(AUTH_TOKEN_UPDATED_EVENT, onTokenUpdated);
    window.addEventListener('storage', onStorage);

    return () => {
      window.removeEventListener(AUTH_TOKEN_UPDATED_EVENT, onTokenUpdated);
      window.removeEventListener('storage', onStorage);
    };
  }, [refreshUser]);

  const login = useCallback(async (email: string, password: string): Promise<boolean> => {
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
      const response = await fetch(`${apiUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
        credentials: 'include',
      });

      const payload = await response.json();
      if (!payload?.success) {
        return false;
      }

      if (payload.data?.token && typeof window !== 'undefined') {
        localStorage.setItem('auth_token', payload.data.token);
        window.dispatchEvent(new Event(AUTH_TOKEN_UPDATED_EVENT));
      }

      if (payload.data?.user) {
        setUser(mapBackendUser(payload.data.user as BackendUser));
      } else {
        await refreshUser();
      }

      return true;
    } catch {
      return false;
    }
  }, []);

  const logout = useCallback(() => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('auth_token');
      window.dispatchEvent(new Event(AUTH_TOKEN_UPDATED_EVENT));
    }
    setUser(null);
    setSessions([]);
  }, []);

  const updateUser = useCallback((updates: Partial<User>) => {
    setUser((prev) => (prev ? { ...prev, ...updates } : null));
  }, []);

  const updateRole = useCallback((role: UserRole) => {
    setUser((prev) =>
      prev
        ? {
            ...prev,
            role,
            permissions: rolePermissions[role],
          }
        : null
    );
  }, []);

  const updatePermissions = useCallback((permissions: Partial<UserPermissions>) => {
    setUser((prev) =>
      prev
        ? {
            ...prev,
            permissions: { ...prev.permissions, ...permissions },
          }
        : null
    );
  }, []);

  const updateSettings = useCallback((newSettings: Partial<GlobalSettings>) => {
    setSettings((prev) => ({ ...prev, ...newSettings }));
  }, []);

  const updateLLMConfig = useCallback((config: Partial<LLMConfig>) => {
    setSettings((prev) => ({
      ...prev,
      llmConfig: { ...prev.llmConfig, ...config },
    }));
  }, []);

  const updateExecutionPolicy = useCallback((policy: Partial<ExecutionPolicy>) => {
    setSettings((prev) => ({
      ...prev,
      executionPolicy: { ...prev.executionPolicy, ...policy },
    }));
  }, []);

  const terminateSession = useCallback((sessionId: string) => {
    setSessions((prev) => prev.filter((s) => s.id !== sessionId));
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        sessions,
        settings,
        isAuthenticated: !!user,
        refreshUser,
        login,
        logout,
        updateUser,
        updateRole,
        updatePermissions,
        updateSettings,
        updateLLMConfig,
        updateExecutionPolicy,
        terminateSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
