"use client";

import React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context";
import { Button } from "@/components/ui/button";
import { logsApi } from "@/lib/api";
import {
  LayoutDashboard,
  History,
  LogOut,
  Plug,
  ScrollText,
  Settings,
  User,
  Workflow,
  Zap,
} from "lucide-react";

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

const navItems: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Workflows", href: "/workflows", icon: Workflow },
  { label: "Past Executions", href: "/past-executions", icon: History },
  { label: "Integrations", href: "/integrations", icon: Plug },
  { label: "Audit Logs", href: "/logs", icon: ScrollText },
  { label: "Profile", href: "/profile", icon: User },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
  const [auditTotalCount, setAuditTotalCount] = React.useState<number>(0);
  const [auditErrorCount, setAuditErrorCount] = React.useState<number>(0);

  const displayName = user?.name?.trim() || "User";
  const displayEmail = user?.email?.trim() || "No email available";
  const displayRole = user?.role
    ? `${user.role.charAt(0).toUpperCase()}${user.role.slice(1)}`
    : "Member";
  const initials =
    displayName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "U";

  const handleLogout = () => {
    logout();
    router.push("/login");
  };

  React.useEffect(() => {
    let isMounted = true;

    const loadAuditStats = async () => {
      const response = await logsApi.getStats();
      if (!isMounted || !response.success || !response.data) {
        return;
      }

      setAuditTotalCount(response.data.total ?? 0);
      setAuditErrorCount(response.data.byLevel.error ?? 0);
    };

    void loadAuditStats();

    const intervalId = window.setInterval(() => {
      void loadAuditStats();
    }, 15000);

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, []);

  return (
    <aside className="fixed left-0 top-0 z-40 h-screen w-64 border-r border-border bg-surface-primary">
      {/* Logo */}
      <div className="flex h-16 items-center gap-2 border-b border-border px-6">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
          <Zap className="h-5 w-5 text-white" />
        </div>
        <span className="text-lg font-semibold text-content-primary">
          NexusMCP
        </span>
      </div>

      {/* Navigation */}
      <nav className="flex flex-col gap-1 p-4">
        {navItems.map((item) => {
          const isActive =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                isActive
                  ? "bg-primary-light text-primary"
                  : "text-content-secondary hover:bg-surface-secondary hover:text-content-primary",
              )}
            >
              <div className="flex items-center gap-3">
                <Icon className="h-5 w-5" />
                {item.label}
              </div>
              {item.href === "/logs" ? (
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-xs font-semibold",
                    auditErrorCount > 0
                      ? "bg-error/15 text-error"
                      : "bg-info-light text-info",
                  )}
                  title={`PostgreSQL logs: ${auditTotalCount} total, ${auditErrorCount} errors`}
                >
                  {auditTotalCount > 99 ? "21" : auditTotalCount}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="absolute bottom-0 left-0 right-0 border-t border-border p-4">
        <div className="space-y-3">
          <div className="flex items-center gap-3 rounded-lg bg-surface-secondary px-3 py-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-medium text-white">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-content-primary">
                {displayName}
              </p>
              <p className="truncate text-xs text-content-tertiary">
                {displayEmail}
              </p>
              <p className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-content-tertiary">
                {displayRole}
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full justify-center bg-surface-secondary hover:bg-surface-secondary-hover"
            leftIcon={<LogOut className="h-4 w-4" />}
            onClick={handleLogout}
          >
            Logout
          </Button>
        </div>
      </div>
    </aside>
  );
}
