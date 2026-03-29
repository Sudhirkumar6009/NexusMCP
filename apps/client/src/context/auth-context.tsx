'use client';

import React, { createContext, useContext, useState, useCallback } from 'react';
import { User, UserRole, UserPermissions, Session, GlobalSettings, LLMConfig, ExecutionPolicy } from '@/types';

// Default user
const defaultUser: User = {
  id: 'user-1',
  email: 'admin@nexusmcp.io',
  name: 'Admin User',
  role: 'admin',
  permissions: {
    canExecuteWorkflows: true,
    canApproveOperations: true,
    canModifyIntegrations: true,
    canViewAuditLogs: true,
    canModifySettings: true,
    canManageUsers: true,
    allowedServices: [],
    allowedTools: [],
  },
  createdAt: new Date('2024-01-01'),
  lastLoginAt: new Date(),
};

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
  const [user, setUser] = useState<User | null>(defaultUser);
  const [sessions, setSessions] = useState<Session[]>(defaultSessions);
  const [settings, setSettings] = useState<GlobalSettings>(defaultSettings);

  const login = useCallback(async (email: string, password: string): Promise<boolean> => {
    // Simulate login - always succeeds for demo
    await new Promise((resolve) => setTimeout(resolve, 1000));
    setUser({
      ...defaultUser,
      email,
      lastLoginAt: new Date(),
    });
    return true;
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    setSessions([]);
  }, []);

  const updateUser = useCallback((updates: Partial<User>) => {
    setUser((prev) => (prev ? { ...prev, ...updates } : null));
  }, []);

  const updateRole = useCallback((role: UserRole) => {
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
