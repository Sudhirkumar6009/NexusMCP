'use client';

import { Sidebar } from '@/components/layout/sidebar';
import { Header } from '@/components/layout/header';
import { AuthGuard } from '@/components/auth';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthGuard>
      <div className="min-h-screen bg-surface-secondary">
        <Sidebar />
        <div className="pl-64">
          <Header />
          <main className="p-6">{children}</main>
        </div>
      </div>
    </AuthGuard>
  );
}
