"use client";

import React, { useEffect, useMemo, useState } from "react";
import { AuditLogEntry, LogStatus, LogLevel } from "@/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableEmpty,
} from "@/components/ui/table";
import { formatDateTime, formatRelativeTime } from "@/lib/utils";
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
} from "lucide-react";
import { logsApi } from "@/lib/api";

type ApiLogRow = {
  id: string;
  timestamp: string;
  level: LogLevel;
  service?: string;
  action?: string;
  message: string;
  workflowId?: string;
  nodeId?: string;
  executionId?: string;
  userId?: string;
  details?: Record<string, unknown>;
};

function mapLogRow(row: ApiLogRow): AuditLogEntry {
  const details = row.details || {};
  const level = row.level;
  const status: LogStatus = level === "error" ? "failed" : "success";

  return {
    id: row.id,
    timestamp: new Date(row.timestamp),
    level,
    workflowId: row.workflowId || "N/A",
    workflowName:
      (typeof details.workflowName === "string" && details.workflowName) ||
      row.workflowId ||
      "System Event",
    executionId:
      row.executionId ||
      (typeof details.executionId === "string" ? details.executionId : "N/A"),
    nodeId: row.nodeId,
    nodeName:
      (typeof details.nodeName === "string" && details.nodeName) ||
      row.nodeId ||
      row.action ||
      "Event",
    service: row.service,
    tool:
      (typeof details.method === "string" && details.method) ||
      row.action ||
      "-",
    status,
    message: row.message,
    userId: row.userId || "system",
    userName:
      (typeof details.userName === "string" && details.userName) ||
      row.userId ||
      "System",
    userRole:
      (typeof details.userRole === "string" && details.userRole) || "system",
    metadata: details,
  };
}

const statusConfig: Record<
  LogStatus,
  {
    icon: React.ComponentType<{ className?: string }>;
    variant: "success" | "error" | "warning" | "default";
  }
> = {
  success: { icon: CheckCircle2, variant: "success" },
  failed: { icon: XCircle, variant: "error" },
  pending: { icon: Clock, variant: "warning" },
  cancelled: { icon: AlertTriangle, variant: "default" },
};

export default function LogsPage() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [serviceFilter, setServiceFilter] = useState<string>("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedLog, setSelectedLog] = useState<AuditLogEntry | null>(null);
  const pageSize = 10;

  const fetchLogs = async () => {
    setIsRefreshing(true);
    try {
      const response = await logsApi.list({ limit: 500, offset: 0 });
      if (response.success && Array.isArray(response.data)) {
        const mapped = (response.data as unknown as ApiLogRow[]).map(mapLogRow);
        setLogs(mapped);
      }
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    void fetchLogs();
    const timer = setInterval(() => {
      void fetchLogs();
    }, 5000);

    return () => clearInterval(timer);
  }, []);

  // Filter logs
  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      const matchesSearch =
        searchQuery === "" ||
        log.workflowName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        log.nodeName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        log.message.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesStatus =
        statusFilter === "all" || log.status === statusFilter;
      const matchesService =
        serviceFilter === "all" || log.service === serviceFilter;

      return matchesSearch && matchesStatus && matchesService;
    });
  }, [searchQuery, statusFilter, serviceFilter]);

  // Paginate
  const totalPages = Math.ceil(filteredLogs.length / pageSize);
  const paginatedLogs = filteredLogs.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );

  // Get unique services for filter
  const services = Array.from(new Set(logs.map((log) => log.service))).filter(
    Boolean,
  );

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
              { value: "all", label: "All Status" },
              { value: "success", label: "Success" },
              { value: "failed", label: "Failed" },
              { value: "pending", label: "Pending" },
            ]}
            value={statusFilter}
            onChange={setStatusFilter}
            className="w-40"
          />
          <Select
            options={[
              { value: "all", label: "All Services" },
              ...services.map((s) => ({
                value: s!,
                label: s!.charAt(0).toUpperCase() + s!.slice(1),
              })),
            ]}
            value={serviceFilter}
            onChange={setServiceFilter}
            className="w-40"
          />
          <Button
            variant="outline"
            size="sm"
            leftIcon={<RefreshCw className="h-4 w-4" />}
            isLoading={isRefreshing}
            onClick={() => {
              void fetchLogs();
            }}
          >
            Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            leftIcon={<Download className="h-4 w-4" />}
          >
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
                      <p className="text-sm font-medium text-content-primary">
                        {log.workflowName}
                      </p>
                      <p className="text-xs text-content-tertiary">
                        ID: {log.workflowId}
                      </p>
                    </TableCell>
                    <TableCell>
                      <p className="text-sm text-content-primary">
                        {log.nodeName || "-"}
                      </p>
                      <p className="text-xs text-content-tertiary">
                        {log.tool || "-"}
                      </p>
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
                      <p className="text-sm text-content-primary">
                        {log.userName}
                      </p>
                      <p className="text-xs text-content-tertiary capitalize">
                        {log.userRole}
                      </p>
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
              Showing {(currentPage - 1) * pageSize + 1} to{" "}
              {Math.min(currentPage * pageSize, filteredLogs.length)} of{" "}
              {filteredLogs.length} entries
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
                onClick={() =>
                  setCurrentPage((p) => Math.min(totalPages, p + 1))
                }
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
        <Card
          padding="lg"
          className="fixed bottom-6 right-6 w-[500px] max-h-[400px] overflow-y-auto shadow-lg z-50"
        >
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="font-semibold text-content-primary">
                {selectedLog.nodeName}
              </h3>
              <p className="text-sm text-content-secondary">
                {selectedLog.message}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedLog(null)}
            >
              Close
            </Button>
          </div>

          {selectedLog.request && (
            <div className="mb-4">
              <p className="text-sm font-medium text-content-primary mb-2">
                Request
              </p>
              <pre className="p-3 bg-surface-tertiary rounded text-xs font-mono overflow-x-auto">
                {JSON.stringify(selectedLog.request, null, 2)}
              </pre>
            </div>
          )}

          {selectedLog.response && (
            <div>
              <p className="text-sm font-medium text-content-primary mb-2">
                Response
              </p>
              <pre className="p-3 bg-surface-tertiary rounded text-xs font-mono overflow-x-auto">
                {JSON.stringify(selectedLog.response, null, 2)}
              </pre>
            </div>
          )}

          {selectedLog.approvalInfo && (
            <div className="mt-4 p-3 bg-primary-light rounded">
              <p className="text-sm font-medium text-primary mb-1">
                Approval Info
              </p>
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
