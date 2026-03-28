'use client';

import React, { useState } from 'react';
import { useIntegrations } from '@/context/integrations-context';
import { Integration, ServiceId, IntegrationCredentials } from '@/types';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Toggle } from '@/components/ui/toggle';
import { Modal, ModalFooter } from '@/components/ui/modal';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { cn, formatRelativeTime } from '@/lib/utils';
import {
  ClipboardList,
  MessageSquare,
  Github,
  Database,
  Settings,
  Plug,
  PlugZap,
  RefreshCw,
} from 'lucide-react';

const serviceIcons: Record<ServiceId, React.ComponentType<{ className?: string }>> = {
  jira: ClipboardList,
  slack: MessageSquare,
  github: Github,
  postgresql: Database,
};

const categoryLabels: Record<string, string> = {
  project_management: 'Project Management',
  communication: 'Communication',
  data_analytics: 'Data & Analytics',
  devops: 'DevOps',
};

interface CredentialModalProps {
  integration: Integration | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (id: ServiceId, credentials: IntegrationCredentials) => void;
}

function CredentialModal({ integration, isOpen, onClose, onSave }: CredentialModalProps) {
  const [apiKey, setApiKey] = useState('');
  const [scopes, setScopes] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const handleSave = async () => {
    if (!integration) return;
    setIsLoading(true);
    await onSave(integration.id, {
      apiKey,
      scopes,
    });
    setIsLoading(false);
    onClose();
    setApiKey('');
    setScopes([]);
  };

  const availableScopes: Record<ServiceId, string[]> = {
    jira: ['read:jira-work', 'write:jira-work', 'read:jira-user', 'manage:jira-project'],
    slack: ['chat:write', 'channels:read', 'users:read', 'channels:manage'],
    github: ['repo', 'read:org', 'write:org', 'admin:repo_hook'],
    postgresql: ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'EXECUTE'],
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Configure ${integration?.name || ''}`}
      description="Enter your credentials to connect this service"
      size="md"
    >
      <div className="space-y-4">
        <Input
          label="API Key"
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="Enter your API key or access token"
        />

        <div>
          <label className="block text-sm font-medium text-content-primary mb-2">
            Permission Scopes
          </label>
          <div className="grid grid-cols-2 gap-2">
            {integration &&
              availableScopes[integration.id]?.map((scope) => (
                <label key={scope} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={scopes.includes(scope)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setScopes([...scopes, scope]);
                      } else {
                        setScopes(scopes.filter((s) => s !== scope));
                      }
                    }}
                    className="rounded border-border text-primary focus:ring-primary"
                  />
                  <span className="text-sm text-content-secondary">{scope}</span>
                </label>
              ))}
          </div>
        </div>
      </div>

      <ModalFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={handleSave} isLoading={isLoading} disabled={!apiKey}>
          Save Credentials
        </Button>
      </ModalFooter>
    </Modal>
  );
}

function IntegrationCard({ integration }: { integration: Integration }) {
  const { toggleIntegration, disconnectIntegration, connectIntegration } = useIntegrations();
  const [showCredentialModal, setShowCredentialModal] = useState(false);

  const Icon = serviceIcons[integration.id];
  const isConnected = integration.status === 'connected';

  const handleConfigure = () => {
    setShowCredentialModal(true);
  };

  const handleSaveCredentials = async (id: ServiceId, credentials: IntegrationCredentials) => {
    await connectIntegration(id, credentials);
  };

  return (
    <>
      <Card
        className={cn(
          'p-4 transition-all',
          isConnected ? 'border-success/30' : 'border-border'
        )}
      >
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                'flex items-center justify-center w-10 h-10 rounded-lg',
                isConnected ? 'bg-success-light' : 'bg-surface-tertiary'
              )}
            >
              <Icon
                className={cn('h-5 w-5', isConnected ? 'text-success' : 'text-content-tertiary')}
              />
            </div>
            <div>
              <h3 className="font-medium text-content-primary">{integration.name}</h3>
              <p className="text-xs text-content-tertiary">{categoryLabels[integration.category]}</p>
            </div>
          </div>
          <Badge
            variant={isConnected ? 'success' : 'default'}
            dot
          >
            {isConnected ? 'Connected' : 'Disconnected'}
          </Badge>
        </div>

        <p className="text-sm text-content-secondary mb-4">{integration.description}</p>

        {/* Tools count */}
        <div className="text-xs text-content-tertiary mb-4">
          {integration.tools.length} tools available
        </div>

        {/* Last synced */}
        {isConnected && integration.lastSynced && (
          <p className="text-xs text-content-tertiary mb-4">
            Last synced: {formatRelativeTime(integration.lastSynced)}
          </p>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between pt-3 border-t border-border">
          {isConnected ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleConfigure}
                leftIcon={<Settings className="h-4 w-4" />}
              >
                Configure
              </Button>
              <Toggle
                checked={integration.enabled}
                onChange={() => toggleIntegration(integration.id)}
                size="sm"
              />
            </>
          ) : (
            <Button
              size="sm"
              onClick={handleConfigure}
              leftIcon={<PlugZap className="h-4 w-4" />}
              className="w-full"
            >
              Connect
            </Button>
          )}
        </div>
      </Card>

      <CredentialModal
        integration={integration}
        isOpen={showCredentialModal}
        onClose={() => setShowCredentialModal(false)}
        onSave={handleSaveCredentials}
      />
    </>
  );
}

export default function IntegrationsPage() {
  const { integrations, isLoading } = useIntegrations();

  const connectedCount = integrations.filter((i) => i.status === 'connected').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-content-secondary">
            Connect your MCP servers to enable workflow automation
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="success" className="text-sm">
            {connectedCount}/{integrations.length} Connected
          </Badge>
          <Button variant="outline" size="sm" leftIcon={<RefreshCw className="h-4 w-4" />}>
            Sync All
          </Button>
        </div>
      </div>

      {/* Integration Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {integrations.map((integration) => (
          <IntegrationCard key={integration.id} integration={integration} />
        ))}
      </div>

      {/* Add More Section */}
      <Card className="p-6 border-dashed">
        <div className="flex flex-col items-center justify-center text-center">
          <div className="flex items-center justify-center w-12 h-12 rounded-full bg-surface-tertiary mb-3">
            <Plug className="h-6 w-6 text-content-tertiary" />
          </div>
          <h3 className="font-medium text-content-primary mb-1">Add More Integrations</h3>
          <p className="text-sm text-content-secondary mb-4 max-w-md">
            Connect additional MCP servers to expand your workflow capabilities. 
            Configure custom endpoints and authentication.
          </p>
          <Button variant="outline" leftIcon={<Plug className="h-4 w-4" />}>
            Browse Available Integrations
          </Button>
        </div>
      </Card>
    </div>
  );
}
