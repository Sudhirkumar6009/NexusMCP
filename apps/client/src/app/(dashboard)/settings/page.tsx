'use client';

import React from 'react';
import { useAuth } from '@/context/auth-context';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Toggle } from '@/components/ui/toggle';
import { Badge } from '@/components/ui/badge';
import { Save, Key, Cpu, Shield, Bell } from 'lucide-react';

export default function SettingsPage() {
  const { settings, updateLLMConfig, updateExecutionPolicy, updateSettings } = useAuth();
  const { llmConfig, executionPolicy, notifications } = settings;

  return (
    <div className="space-y-6 max-w-4xl">
      {/* LLM Configuration */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Cpu className="h-5 w-5 text-primary" />
            <CardTitle>LLM Configuration</CardTitle>
          </div>
          <CardDescription>
            Configure the language model used for workflow planning and orchestration
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Select
              label="Provider"
              options={[
                { value: 'anthropic', label: 'Anthropic (Claude)' },
                { value: 'openai', label: 'OpenAI (GPT)' },
                { value: 'azure', label: 'Azure OpenAI' },
                { value: 'custom', label: 'Custom Endpoint' },
              ]}
              value={llmConfig.provider}
              onChange={(value) => updateLLMConfig({ provider: value as typeof llmConfig.provider })}
            />
            <Select
              label="Model"
              options={
                llmConfig.provider === 'anthropic'
                  ? [
                      { value: 'claude-3-opus', label: 'Claude 3 Opus' },
                      { value: 'claude-3-sonnet', label: 'Claude 3 Sonnet' },
                      { value: 'claude-3-haiku', label: 'Claude 3 Haiku' },
                    ]
                  : llmConfig.provider === 'openai'
                  ? [
                      { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
                      { value: 'gpt-4', label: 'GPT-4' },
                      { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
                    ]
                  : [{ value: 'custom', label: 'Custom Model' }]
              }
              value={llmConfig.model}
              onChange={(value) => updateLLMConfig({ model: value })}
            />
          </div>
          <Input
            label="API Key"
            type="password"
            value={llmConfig.apiKey}
            onChange={(e) => updateLLMConfig({ apiKey: e.target.value })}
            placeholder="Enter your API key"
            hint="Your API key is stored securely and never exposed"
          />
          {llmConfig.provider === 'custom' && (
            <Input
              label="Base URL"
              value={llmConfig.baseUrl || ''}
              onChange={(e) => updateLLMConfig({ baseUrl: e.target.value })}
              placeholder="https://api.example.com/v1"
            />
          )}
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Max Tokens"
              type="number"
              value={llmConfig.maxTokens.toString()}
              onChange={(e) => updateLLMConfig({ maxTokens: parseInt(e.target.value) || 4096 })}
            />
            <Input
              label="Temperature"
              type="number"
              step="0.1"
              min="0"
              max="2"
              value={llmConfig.temperature.toString()}
              onChange={(e) => updateLLMConfig({ temperature: parseFloat(e.target.value) || 0.7 })}
            />
          </div>
        </CardContent>
        <CardFooter>
          <Button leftIcon={<Save className="h-4 w-4" />}>Save LLM Settings</Button>
        </CardFooter>
      </Card>

      {/* Execution Policies */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            <CardTitle>Execution Policies</CardTitle>
          </div>
          <CardDescription>
            Configure retry behavior, timeouts, and execution controls
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <Input
              label="Max Retries"
              type="number"
              min="0"
              max="10"
              value={executionPolicy.maxRetries.toString()}
              onChange={(e) =>
                updateExecutionPolicy({ maxRetries: parseInt(e.target.value) || 3 })
              }
              hint="Number of retry attempts for failed steps"
            />
            <Input
              label="Retry Delay (ms)"
              type="number"
              min="100"
              value={executionPolicy.retryDelayMs.toString()}
              onChange={(e) =>
                updateExecutionPolicy({ retryDelayMs: parseInt(e.target.value) || 1000 })
              }
              hint="Delay between retry attempts"
            />
            <Input
              label="Timeout (ms)"
              type="number"
              min="1000"
              value={executionPolicy.timeoutMs.toString()}
              onChange={(e) =>
                updateExecutionPolicy({ timeoutMs: parseInt(e.target.value) || 30000 })
              }
              hint="Maximum time per step"
            />
          </div>
          <div className="space-y-3 pt-4 border-t border-border">
            <Toggle
              checked={executionPolicy.parallelExecutionEnabled}
              onChange={(checked) => updateExecutionPolicy({ parallelExecutionEnabled: checked })}
              label="Enable Parallel Execution"
              description="Run independent workflow steps concurrently"
            />
            <Toggle
              checked={executionPolicy.requireApprovalForSensitive}
              onChange={(checked) =>
                updateExecutionPolicy({ requireApprovalForSensitive: checked })
              }
              label="Require Approval for Sensitive Operations"
              description="Pause workflow for manual approval on sensitive actions"
            />
            <Toggle
              checked={executionPolicy.autoApproveForAdmins}
              onChange={(checked) => updateExecutionPolicy({ autoApproveForAdmins: checked })}
              label="Auto-approve for Admins"
              description="Skip approval gates for admin users"
            />
          </div>
        </CardContent>
        <CardFooter>
          <Button leftIcon={<Save className="h-4 w-4" />}>Save Execution Policies</Button>
        </CardFooter>
      </Card>

      {/* Notifications */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-primary" />
            <CardTitle>Notifications</CardTitle>
          </div>
          <CardDescription>
            Configure how you receive alerts about workflow events
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Toggle
              checked={notifications.emailEnabled}
              onChange={(checked) =>
                updateSettings({ notifications: { ...notifications, emailEnabled: checked } })
              }
              label="Email Notifications"
              description="Receive alerts via email"
            />
            <Toggle
              checked={notifications.slackEnabled}
              onChange={(checked) =>
                updateSettings({ notifications: { ...notifications, slackEnabled: checked } })
              }
              label="Slack Notifications"
              description="Receive alerts in Slack"
            />
          </div>
          <div className="pt-4 border-t border-border">
            <p className="text-sm font-medium text-content-primary mb-3">Notify me when:</p>
            <div className="space-y-3">
              <Toggle
                checked={notifications.onSuccess}
                onChange={(checked) =>
                  updateSettings({ notifications: { ...notifications, onSuccess: checked } })
                }
                label="Workflow completes successfully"
              />
              <Toggle
                checked={notifications.onFailure}
                onChange={(checked) =>
                  updateSettings({ notifications: { ...notifications, onFailure: checked } })
                }
                label="Workflow fails"
              />
              <Toggle
                checked={notifications.onApprovalRequired}
                onChange={(checked) =>
                  updateSettings({
                    notifications: { ...notifications, onApprovalRequired: checked },
                  })
                }
                label="Approval is required"
              />
            </div>
          </div>
        </CardContent>
        <CardFooter>
          <Button leftIcon={<Save className="h-4 w-4" />}>Save Notification Settings</Button>
        </CardFooter>
      </Card>
    </div>
  );
}
