'use client';

import React, { useState, useMemo } from 'react';
import { AuditLogEntry, LogStatus, LogLevel } from '@/types';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/select';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableEmpty,
} from '@/components/ui/table';
import { formatDateTime, formatRelativeTime } from '@/lib/utils';
import {
  Search,
  Filter,
  Download,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  FileJson,
} from 'lucide-react';

// Mock audit log data
const mockLogs: AuditLogEntry[] = [
  {
    id: 'log-1',
    timestamp: new Date(Date.now() - 1000 * 60 * 5),
    level: 'info',
    workflowId: 'wf-001',
    workflowName: 'Critical Bug Response',
    executionId: 'exec-001',
    nodeId: 'action-1',
    nodeName: 'Create GitHub Branch',
    service: 'github',
    tool: 'create_branch',
    status: 'success',
    message: 'Successfully created branch fix/BUG-123',
    userId: 'user-1',
    userName: 'Admin User',
    userRole: 'admin',
    duration: 1234,
    request: {
      jsonrpc: '2.0',
      id: 'req-001',
      method: 'tools/call',
      params: { name: 'github_create_branch', arguments: { name: 'fix/BUG-123' } },
    },
    response: {
      jsonrpc: '2.0',
      id: 'req-001',
      result: { content: [{ type: 'text', text: 'Branch created' }], isError: false },
    },
  },
  {
    id: 'log-2',
    timestamp: new Date(Date.now() - 1000 * 60 * 10),
    level: 'info',
    workflowId: 'wf-001',
    workflowName: 'Critical Bug Response',
    executionId: 'exec-001',
    nodeId: 'action-2',
    nodeName: 'Notify Slack Channel',
    service: 'slack',
    tool: 'send_message',
    status: 'success',
    message: 'Message sent to #incidents channel',
    userId: 'user-1',
    userName: 'Admin User',
    userRole: 'admin',
    duration: 890,
  },
  {
    id: 'log-3',
    timestamp: new Date(Date.now() - 1000 * 60 * 30),
    level: 'warning',
    workflowId: 'wf-002',
    workflowName: 'PR Review Pipeline',
    executionId: 'exec-002',
    nodeId: 'action-1',
    nodeName: 'Run Security Scan',
    service: 'github',
    tool: 'run_action',
    status: 'success',
    message: 'Security scan completed with warnings',
    userId: 'user-2',
    userName: 'Operator User',
    userRole: 'operator',
    duration: 15420,
    retryAttempt: 1,
  },
  {
    id: 'log-4',
    timestamp: new Date(Date.now() - 1000 * 60 * 60),
    level: 'error',
    workflowId: 'wf-003',
    workflowName: 'Data Sync Pipeline',
    executionId: 'exec-003',
    nodeId: 'action-2',
    nodeName: 'Insert Records',
    service: 'postgresql',
    tool: 'insert_record',
    status: 'failed',
    message: 'Database connection timeout after 30s',
    userId: 'user-1',
    userName: 'Admin User',
    userRole: 'admin',
    duration: 30000,
    retryAttempt: 3,
  },
  {
    id: 'log-5',
    timestamp: new Date(Date.now() - 1000 * 60 * 120),
    level: 'info',
    workflowId: 'wf-001',
    workflowName: 'Critical Bug Response',
    executionId: 'exec-004',
    nodeId: 'approval-1',
    nodeName: 'Manager Approval',
    service: 'system',
    tool: 'approval_gate',
    status: 'success',
    message: 'Approved by Admin User',
    userId: 'user-1',
    userName: 'Admin User',
    userRole: 'admin',
    approvalInfo: {
      required: true,
      approvedBy: 'Admin User',
      approvedAt: new Date(Date.now() - 1000 * 60 * 119),
    },
  },
  {
    id: 'log-6',
    timestamp: new Date(Date.now() - 1000 * 60 * 180),
    level: 'info',
    workflowId: 'wf-004',
    workflowName: 'Incident Escalation',
    executionId: 'exec-005',
    nodeId: 'trigger-1',
    nodeName: 'Alert Trigger',
    service: 'system',
    tool: 'on_alert',
    status: 'success',
    message: 'Workflow triggered by CPU threshold alert',
    userId: 'system',
    userName: 'System',
    userRole: 'system',
    duration: 50,
  },
];

const statusConfig: Record<LogStatus, { icon: React.ComponentType<{ className?: string }>; variant: 'success' | 'error' | 'warning' | 'default' }> = {
  success: { icon: CheckCircle2, variant: 'success' },
  failed: { icon: XCircle, variant: 'error' },
  pending: { icon: Clock, variant: 'warning' },
  cancelled: { icon: AlertTriangle, variant: 'default' },
};

export default function LogsPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [serviceFilter, setServiceFilter] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedLog, setSelectedLog] = useState<AuditLogEntry | null>(null);
  const pageSize = 10;

  // Filter logs
  const filteredLogs = useMemo(() => {
    return mockLogs.filter((log) => {
      const matchesSearch =
        searchQuery === '' ||
        log.workflowName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        log.nodeName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        log.message.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesStatus = statusFilter === 'all' || log.status === statusFilter;
      const matchesService = serviceFilter === 'all' || log.service === serviceFilter;

      return matchesSearch && matchesStatus && matchesService;
    });
  }, [searchQuery, statusFilter, serviceFilter]);

  // Paginate
  const totalPages = Math.ceil(filteredLogs.length / pageSize);
  const paginatedLogs = filteredLogs.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  // Get unique services for filter
  const services = Array.from(new Set(mockLogs.map((log) => log.service))).filter(Boolean);

  return (
    <div className="space-y-6">
      {/* Filters */}
      <Card padding="md">
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <Input
              isSearch
              placeholder="Search workflows, nodes, or messages..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <Select
            options={[
              { value: 'all', label: 'All Status' },
              { value: 'success', label: 'Success' },
              { value: 'failed', label: 'Failed' },
              { value: 'pending', label: 'Pending' },
            ]}
            value={statusFilter}
            onChange={setStatusFilter}
            className="w-40"
          />
          <Select
            options={[
              { value: 'all', label: 'All Services' },
              ...services.map((s) => ({ value: s!, label: s!.charAt(0).toUpperCase() + s!.slice(1) })),
            ]}
            value={serviceFilter}
            onChange={setServiceFilter}
            className="w-40"
          />
          <Button variant="outline" size="sm" leftIcon={<RefreshCw className="h-4 w-4" />}>
            Refresh
          </Button>
          <Button variant="outline" size="sm" leftIcon={<Download className="h-4 w-4" />}>
            Export
          </Button>
        </div>
      </Card>

      {/* Logs Table */}
      <Card padding="none">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Timestamp</TableHead>
              <TableHead>Workflow</TableHead>
              <TableHead>Node / Tool</TableHead>
              <TableHead>Service</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>User</TableHead>
              <TableHead className="text-right">Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedLogs.length === 0 ? (
              <TableEmpty
                icon={<FileJson className="h-10 w-10" />}
                title="No logs found"
                description="Try adjusting your filters or search query"
              />
            ) : (
              paginatedLogs.map((log) => {
                const StatusIcon = statusConfig[log.status].icon;
                return (
                  <TableRow key={log.id}>
                    <TableCell>
                      <div>
                        <p className="text-sm text-content-primary">
                          {formatRelativeTime(log.timestamp)}
                        </p>
                        <p className="text-xs text-content-tertiary">
                          {formatDateTime(log.timestamp)}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <p className="text-sm font-medium text-content-primary">{log.workflowName}</p>
                      <p className="text-xs text-content-tertiary">ID: {log.workflowId}</p>
                    </TableCell>
                    <TableCell>
                      <p className="text-sm text-content-primary">{log.nodeName || '-'}</p>
                      <p className="text-xs text-content-tertiary">{log.tool || '-'}</p>
                    </TableCell>
                    <TableCell>
                      <Badge variant="default" className="capitalize">
                        {log.service}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusConfig[log.status].variant} dot>
                        {log.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <p className="text-sm text-content-primary">{log.userName}</p>
                      <p className="text-xs text-content-tertiary capitalize">{log.userRole}</p>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedLog(log)}
                      >
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border">
            <p className="text-sm text-content-secondary">
              Showing {(currentPage - 1) * pageSize + 1} to{' '}
              {Math.min(currentPage * pageSize, filteredLogs.length)} of {filteredLogs.length} entries
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm text-content-primary px-2">
                Page {currentPage} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Log Detail Modal */}
      {selectedLog && (
        <Card padding="lg" className="fixed bottom-6 right-6 w-[500px] max-h-[400px] overflow-y-auto shadow-lg z-50">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="font-semibold text-content-primary">{selectedLog.nodeName}</h3>
              <p className="text-sm text-content-secondary">{selectedLog.message}</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setSelectedLog(null)}>
              Close
            </Button>
          </div>

          {selectedLog.request && (
            <div className="mb-4">
              <p className="text-sm font-medium text-content-primary mb-2">Request</p>
              <pre className="p-3 bg-surface-tertiary rounded text-xs font-mono overflow-x-auto">
                {JSON.stringify(selectedLog.request, null, 2)}
              </pre>
            </div>
          )}

          {selectedLog.response && (
            <div>
              <p className="text-sm font-medium text-content-primary mb-2">Response</p>
              <pre className="p-3 bg-surface-tertiary rounded text-xs font-mono overflow-x-auto">
                {JSON.stringify(selectedLog.response, null, 2)}
              </pre>
            </div>
          )}

          {selectedLog.approvalInfo && (
            <div className="mt-4 p-3 bg-primary-light rounded">
              <p className="text-sm font-medium text-primary mb-1">Approval Info</p>
              <p className="text-sm text-content-secondary">
                Approved by: {selectedLog.approvalInfo.approvedBy}
              </p>
              {selectedLog.approvalInfo.approvedAt && (
                <p className="text-xs text-content-tertiary">
                  At: {formatDateTime(selectedLog.approvalInfo.approvedAt)}
                </p>
              )}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
