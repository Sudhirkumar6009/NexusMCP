'use client';

import React from 'react';
import { useAuth } from '@/context/auth-context';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Toggle } from '@/components/ui/toggle';
import { Badge } from '@/components/ui/badge';
import { formatDateTime, formatRelativeTime, getInitials } from '@/lib/utils';
import {
  User,
  Shield,
  Key,
  Monitor,
  Trash2,
  LogOut,
  Save,
  CheckCircle2,
} from 'lucide-react';

export default function ProfilePage() {
  const { user, sessions, updateUser, updateRole, updatePermissions, terminateSession } = useAuth();

  if (!user) return null;

  const roleOptions = [
    { value: 'admin', label: 'Admin - Full access' },
    { value: 'operator', label: 'Operator - Execute & approve' },
    { value: 'viewer', label: 'Viewer - Read only' },
  ];

  return (
    <div className="space-y-6 max-w-4xl">
      {/* User Info */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <User className="h-5 w-5 text-primary" />
            <CardTitle>User Information</CardTitle>
          </div>
          <CardDescription>Manage your personal information and account settings</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-6">
            <div className="flex items-center justify-center w-20 h-20 rounded-full bg-primary text-white text-2xl font-semibold">
              {getInitials(user.name)}
            </div>
            <div className="flex-1 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Input
                  label="Name"
                  value={user.name}
                  onChange={(e) => updateUser({ name: e.target.value })}
                />
                <Input
                  label="Email"
                  type="email"
                  value={user.email}
                  onChange={(e) => updateUser({ email: e.target.value })}
                />
              </div>
            </div>
          </div>
          <div className="flex items-center gap-4 pt-4 border-t border-border">
            <div>
              <p className="text-sm text-content-secondary">Member since</p>
              <p className="text-sm font-medium text-content-primary">
                {formatDateTime(user.createdAt)}
              </p>
            </div>
            <div>
              <p className="text-sm text-content-secondary">Last login</p>
              <p className="text-sm font-medium text-content-primary">
                {user.lastLoginAt ? formatRelativeTime(user.lastLoginAt) : 'Never'}
              </p>
            </div>
          </div>
        </CardContent>
        <CardFooter>
          <Button leftIcon={<Save className="h-4 w-4" />}>Save Changes</Button>
        </CardFooter>
      </Card>

      {/* Role & Permissions */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            <CardTitle>Role & Permissions</CardTitle>
          </div>
          <CardDescription>Manage your role and access permissions</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Select
            label="Role"
            options={roleOptions}
            value={user.role}
            onChange={(value) => updateRole(value as 'admin' | 'operator' | 'viewer')}
          />

          <div className="pt-4 border-t border-border">
            <p className="text-sm font-medium text-content-primary mb-3">Permissions</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center gap-2">
                <CheckCircle2
                  className={`h-4 w-4 ${
                    user.permissions.canExecuteWorkflows ? 'text-success' : 'text-content-tertiary'
                  }`}
                />
                <span className="text-sm text-content-secondary">Execute Workflows</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2
                  className={`h-4 w-4 ${
                    user.permissions.canApproveOperations ? 'text-success' : 'text-content-tertiary'
                  }`}
                />
                <span className="text-sm text-content-secondary">Approve Operations</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2
                  className={`h-4 w-4 ${
                    user.permissions.canModifyIntegrations ? 'text-success' : 'text-content-tertiary'
                  }`}
                />
                <span className="text-sm text-content-secondary">Modify Integrations</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2
                  className={`h-4 w-4 ${
                    user.permissions.canViewAuditLogs ? 'text-success' : 'text-content-tertiary'
                  }`}
                />
                <span className="text-sm text-content-secondary">View Audit Logs</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2
                  className={`h-4 w-4 ${
                    user.permissions.canModifySettings ? 'text-success' : 'text-content-tertiary'
                  }`}
                />
                <span className="text-sm text-content-secondary">Modify Settings</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2
                  className={`h-4 w-4 ${
                    user.permissions.canManageUsers ? 'text-success' : 'text-content-tertiary'
                  }`}
                />
                <span className="text-sm text-content-secondary">Manage Users</span>
              </div>
            </div>
          </div>

          {/* MCP Scopes */}
          <div className="pt-4 border-t border-border">
            <p className="text-sm font-medium text-content-primary mb-3">Allowed MCP Scopes</p>
            <p className="text-sm text-content-tertiary mb-3">
              {user.permissions.allowedServices.length === 0
                ? 'All services allowed'
                : 'Restricted to specific services'}
            </p>
            <div className="flex flex-wrap gap-2">
              {user.permissions.allowedServices.length === 0 ? (
                <>
                  <Badge variant="success">jira</Badge>
                  <Badge variant="success">slack</Badge>
                  <Badge variant="success">github</Badge>
                  <Badge variant="success">postgresql</Badge>
                </>
              ) : (
                user.permissions.allowedServices.map((service) => (
                  <Badge key={service} variant="success">
                    {service}
                  </Badge>
                ))
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Active Sessions */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Monitor className="h-5 w-5 text-primary" />
            <CardTitle>Active Sessions</CardTitle>
          </div>
          <CardDescription>Manage your active sessions across devices</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {sessions.map((session) => (
              <div
                key={session.id}
                className="flex items-center justify-between p-3 rounded-lg bg-surface-secondary"
              >
                <div className="flex items-center gap-4">
                  <Monitor className="h-5 w-5 text-content-tertiary" />
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-content-primary">{session.device}</p>
                      {session.isCurrent && (
                        <Badge variant="primary" size="sm">
                          Current
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-content-tertiary">
                      {session.browser} · {session.ip}
                      {session.location && ` · ${session.location}`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <p className="text-xs text-content-tertiary">
                    Last active: {formatRelativeTime(session.lastActiveAt)}
                  </p>
                  {!session.isCurrent && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => terminateSession(session.id)}
                      className="text-error hover:bg-error-light"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
        <CardFooter className="justify-between">
          <Button variant="outline" leftIcon={<LogOut className="h-4 w-4" />}>
            Sign Out All Other Sessions
          </Button>
          <Button variant="danger" leftIcon={<LogOut className="h-4 w-4" />}>
            Sign Out
          </Button>
        </CardFooter>
      </Card>

      {/* Security */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Key className="h-5 w-5 text-primary" />
            <CardTitle>Security</CardTitle>
          </div>
          <CardDescription>Manage your password and security settings</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input label="Current Password" type="password" placeholder="Enter current password" />
          <div className="grid grid-cols-2 gap-4">
            <Input label="New Password" type="password" placeholder="Enter new password" />
            <Input
              label="Confirm New Password"
              type="password"
              placeholder="Confirm new password"
            />
          </div>
        </CardContent>
        <CardFooter>
          <Button leftIcon={<Save className="h-4 w-4" />}>Update Password</Button>
        </CardFooter>
      </Card>
    </div>
  );
}
