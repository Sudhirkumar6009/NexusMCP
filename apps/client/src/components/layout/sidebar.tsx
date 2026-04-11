'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { authApi } from '@/lib/api';
import { useAuth } from '@/context/auth-context';
import {
  LayoutDashboard,
  Plug,
  ScrollText,
  Settings,
  User,
  LogOut,
  Zap,
} from 'lucide-react';

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

const navItems: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Integrations', href: '/integrations', icon: Plug },
  { label: 'Audit Logs', href: '/logs', icon: ScrollText },
  { label: 'Settings', href: '/settings', icon: Settings },
  { label: 'Profile', href: '/profile', icon: User },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();

  const handleLogout = async () => {
    await authApi.logout();
    localStorage.removeItem('auth_token');
    logout();
    router.push('/login');
  };

  return (
    <aside className="fixed left-0 top-0 z-40 h-screen w-64 border-r border-border bg-surface-primary">
      {/* Logo */}
      <div className="flex h-16 items-center gap-2 border-b border-border px-6">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
          <Zap className="h-5 w-5 text-white" />
        </div>
        <span className="text-lg font-semibold text-content-primary">NexusMCP</span>
      </div>

      {/* Navigation */}
      <nav className="flex flex-col gap-1 p-4">
        {navItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary-light text-primary'
                  : 'text-content-secondary hover:bg-surface-secondary hover:text-content-primary'
              )}
            >
              <Icon className="h-5 w-5" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="absolute bottom-0 left-0 right-0 border-t border-border p-4">
        <div className="flex items-center gap-3 rounded-lg bg-surface-secondary px-3 py-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-white text-sm font-medium">
            {user?.name?.[0]?.toUpperCase() || 'U'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-content-primary truncate">
              {user?.name || 'User'}
            </p>
            <p className="text-xs text-content-tertiary truncate">
              {user?.email || 'user@example.com'}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-error/40 bg-error/10 px-3 py-2 text-sm font-medium text-error transition-colors hover:bg-error/20"
        >
          <LogOut className="h-4 w-4" />
          Logout
        </button>
      </div>
    </aside>
  );
}
