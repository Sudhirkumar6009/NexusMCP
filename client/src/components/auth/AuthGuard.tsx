'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Zap } from 'lucide-react';

interface AuthGuardProps {
  children: React.ReactNode;
}

export function AuthGuard({ children }: AuthGuardProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    const checkAuth = async () => {
      const token = localStorage.getItem('auth_token');

      if (!token) {
        router.push('/login');
        return;
      }

      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
        const response = await fetch(`${apiUrl}/api/auth/me`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (response.ok) {
          setIsAuthenticated(true);
        } else {
          // Token is invalid, remove it and redirect
          localStorage.removeItem('auth_token');
          router.push('/login');
        }
      } catch (error) {
        console.error('Auth check failed:', error);
        // Network error - might want to show a different state
        // For now, redirect to login
        router.push('/login');
      } finally {
        setIsLoading(false);
      }
    };

    checkAuth();
  }, [router]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-surface-primary flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="flex items-center justify-center gap-2 mb-4">
            <div className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center">
              <Zap className="w-6 h-6 text-white" />
            </div>
            <span className="text-2xl font-bold text-content-primary">NexusMCP</span>
          </div>
          <div className="w-8 h-8 border-3 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-content-secondary">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null; // Will redirect in useEffect
  }

  return <>{children}</>;
}
