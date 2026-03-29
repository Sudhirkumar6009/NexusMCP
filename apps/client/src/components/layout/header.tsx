'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import { ThemeToggle } from './theme-toggle';
import { Input } from '@/components/ui/input';
import { Bell } from 'lucide-react';
import { cn } from '@/lib/utils';

const pageTitles: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/integrations': 'Integrations Hub',
  '/logs': 'Audit Logs',
  '/settings': 'Global Settings',
  '/profile': 'User Profile',
};

export function Header() {
  const pathname = usePathname();
  const title = pageTitles[pathname] || 'Dashboard';

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border bg-surface-primary px-6">
      {/* Left: Page Title */}
      <div>
        <h1 className="text-xl font-semibold text-content-primary">{title}</h1>
      </div>

      {/* Right: Search, Notifications, Theme Toggle */}
      <div className="flex items-center gap-3">
        {/* Search */}
        <div className="w-64">
          <Input
            isSearch
            placeholder="Search workflows..."
            className="h-9 text-sm"
          />
        </div>

        {/* Notifications */}
        <button
          className={cn(
            'relative inline-flex h-9 w-9 items-center justify-center rounded-md',
            'text-content-secondary hover:text-content-primary hover:bg-surface-secondary',
            'transition-colors focus-ring'
          )}
        >
          <Bell className="h-5 w-5" />
          <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-error" />
        </button>

        {/* Theme Toggle */}
        <ThemeToggle />
      </div>
    </header>
  );
}
