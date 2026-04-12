"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Database, Loader2, RefreshCw, Search, Trash2 } from "lucide-react";

import { workflowsApi, type MissingDetailMemoryItem } from "@/lib/api";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui";

function toTimestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatDateTime(value: string): string {
  const time = toTimestamp(value);
  if (!time) {
    return "N/A";
  }

  return new Date(time).toLocaleString();
}

function truncate(value: string, max = 120): string {
  if (value.length <= max) {
    return value;
  }

  return `${value.slice(0, max)}...`;
}

export default function SavedDataPage() {
  const [items, setItems] = useState<MissingDetailMemoryItem[]>([]);
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadSavedData = useCallback(async () => {
    setIsRefreshing(true);

    try {
      const response = await workflowsApi.listMissingDetailsMemory({
        scope: "missing-details",
      });

      if (!response.success || !Array.isArray(response.data)) {
        setItems([]);
        setError(response.error || "Failed to load saved data.");
        return;
      }

      const sorted = [...response.data].sort(
        (a, b) => toTimestamp(b.updatedAt) - toTimestamp(a.updatedAt),
      );
      setItems(sorted);
      setError(null);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadSavedData();
  }, [loadSavedData]);

  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();

    if (!query) {
      return items;
    }

    return items.filter((item) => {
      return (
        item.detailKey.toLowerCase().includes(query) ||
        item.detailValue.toLowerCase().includes(query) ||
        (item.toolName || "").toLowerCase().includes(query)
      );
    });
  }, [items, search]);

  const removeItem = useCallback(async (item: MissingDetailMemoryItem) => {
    const confirmed = window.confirm(
      `Delete saved value for "${item.detailKey}"? This cannot be undone.`,
    );

    if (!confirmed) {
      return;
    }

    setIsDeleting(item.memoryId);
    setError(null);

    try {
      const response = await workflowsApi.deleteMissingDetailsMemory(
        item.memoryId,
      );
      if (!response.success) {
        setError(response.error || "Failed to delete saved data.");
        return;
      }

      setItems((current) =>
        current.filter((entry) => entry.memoryId !== item.memoryId),
      );
    } finally {
      setIsDeleting(null);
    }
  }, []);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="mb-0">
          <div>
            <CardTitle>Saved Data</CardTitle>
            <CardDescription>
              Manage remembered values used to auto-fill missing workflow
              details.
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent>
          <div className="grid gap-3 md:grid-cols-[2fr,auto]">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by key, value, or tool"
              isSearch
              leftIcon={<Search className="h-4 w-4" />}
            />

            <Button
              variant="outline"
              isLoading={isRefreshing}
              leftIcon={<RefreshCw className="h-4 w-4" />}
              onClick={() => void loadSavedData()}
            >
              Refresh
            </Button>
          </div>

          {error ? <p className="mt-3 text-sm text-error">{error}</p> : null}
        </CardContent>
      </Card>

      {isLoading ? (
        <Card>
          <CardContent className="flex items-center gap-2 py-8 text-content-secondary">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading saved data...
          </CardContent>
        </Card>
      ) : null}

      {!isLoading ? (
        <Card>
          <CardContent className="pt-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Key</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>Tool</TableHead>
                  <TableHead>Usage</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredItems.length === 0 ? (
                  <TableEmpty
                    icon={<Database className="h-5 w-5" />}
                    title="No saved data"
                    description="Values you enter for missing details will appear here."
                  />
                ) : (
                  filteredItems.map((item) => (
                    <TableRow key={item.memoryId}>
                      <TableCell>
                        <Badge variant="info" size="sm">
                          {item.detailKey}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[460px]">
                        <p
                          className="truncate text-sm text-content-primary"
                          title={item.detailValue}
                        >
                          {truncate(item.detailValue)}
                        </p>
                      </TableCell>
                      <TableCell>{item.toolName || "-"}</TableCell>
                      <TableCell>{item.useCount}</TableCell>
                      <TableCell>{formatDateTime(item.updatedAt)}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          leftIcon={<Trash2 className="h-4 w-4" />}
                          isLoading={isDeleting === item.memoryId}
                          onClick={() => void removeItem(item)}
                        >
                          Delete
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
