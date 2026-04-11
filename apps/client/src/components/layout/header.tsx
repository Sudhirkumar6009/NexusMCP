"use client";

import React from "react";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "./theme-toggle";

const pageTitles: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/integrations": "Integrations Hub",
  "/logs": "Audit Logs",
  "/settings": "Global Settings",
  "/profile": "User Profile",
};

export function Header() {
  const pathname = usePathname();
  const title = pageTitles[pathname] || "Dashboard";

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border bg-surface-primary px-6">
      {/* Left: Page Title */}
      <div>
        <h1 className="text-xl font-semibold text-content-primary">{title}</h1>
      </div>

      {/* Right: Theme Toggle */}
      <div className="flex items-center gap-3">
        {/* Theme Toggle */}
        <ThemeToggle />
      </div>
    </header>
  );
}
