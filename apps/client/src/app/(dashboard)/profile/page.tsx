'use client';

import React, { useState } from 'react';
import { useAuth } from '@/context/auth-context';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { getInitials } from '@/lib/utils';
import { authApi } from '@/lib/api';
import {
  User,
  Shield,
  Key,
  Save,
  CheckCircle2,
} from 'lucide-react';

export default function ProfilePage() {
  const { user, updateUser, updateRole } = useAuth();
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [isSavingPassword, setIsSavingPassword] = useState(false);

  if (!user) return null;

  const roleOptions = [
    { value: 'admin', label: 'Admin - Full access' },
    { value: 'operator', label: 'Operator - Execute & approve' },
    { value: 'viewer', label: 'Viewer - Read only' },
  ];

  const handlePasswordUpdate = async () => {
    setPasswordError('');
    setPasswordSuccess('');

    if (!passwordForm.currentPassword || !passwordForm.newPassword) {
      setPasswordError('Current password and new password are required.');
      return;
    }

    if (passwordForm.newPassword.length < 8) {
      setPasswordError('New password must be at least 8 characters.');
      return;
    }

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordError('New password and confirmation do not match.');
      return;
    }

    setIsSavingPassword(true);

    const response = await authApi.changePassword(
      passwordForm.currentPassword,
      passwordForm.newPassword,
    );

    if (response.success) {
      setPasswordSuccess('Password updated successfully.');
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } else {
      setPasswordError(response.error || 'Failed to update password.');
    }

    setIsSavingPassword(false);
  };

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
          {passwordError ? (
            <div className="rounded-md border border-error/40 bg-error/10 px-3 py-2 text-sm text-error">
              {passwordError}
            </div>
          ) : null}
          {passwordSuccess ? (
            <div className="rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm text-success">
              {passwordSuccess}
            </div>
          ) : null}
          <Input
            label="Current Password"
            type="password"
            placeholder="Enter current password"
            value={passwordForm.currentPassword}
            onChange={(e) =>
              setPasswordForm((prev) => ({ ...prev, currentPassword: e.target.value }))
            }
          />
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="New Password"
              type="password"
              placeholder="Enter new password"
              value={passwordForm.newPassword}
              onChange={(e) =>
                setPasswordForm((prev) => ({ ...prev, newPassword: e.target.value }))
              }
            />
            <Input
              label="Confirm New Password"
              type="password"
              placeholder="Confirm new password"
              value={passwordForm.confirmPassword}
              onChange={(e) =>
                setPasswordForm((prev) => ({ ...prev, confirmPassword: e.target.value }))
              }
            />
          </div>
        </CardContent>
        <CardFooter>
          <Button
            leftIcon={<Save className="h-4 w-4" />}
            isLoading={isSavingPassword}
            onClick={handlePasswordUpdate}
            disabled={!passwordForm.currentPassword || !passwordForm.newPassword}
          >
            Update Password
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
