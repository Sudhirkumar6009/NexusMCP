'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Zap, CheckCircle, XCircle } from 'lucide-react';

export default function AuthCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    const token = searchParams.get('token');
    const errorParam = searchParams.get('error');

    if (errorParam) {
      setStatus('error');
      setError(decodeURIComponent(errorParam));
      return;
    }

    if (token) {
      // Store the token
      localStorage.setItem('auth_token', token);
      setStatus('success');
      
      // Redirect to dashboard after a short delay
      setTimeout(() => {
        router.push('/dashboard');
      }, 1500);
    } else {
      setStatus('error');
      setError('No authentication token received');
    }
  }, [searchParams, router]);

  return (
    <div className="min-h-screen bg-surface-primary flex items-center justify-center p-6">
      <div className="text-center">
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center">
            <Zap className="w-6 h-6 text-white" />
          </div>
          <span className="text-2xl font-bold text-content-primary">NexusMCP</span>
        </div>

        {status === 'loading' && (
          <div className="space-y-4">
            <div className="w-12 h-12 border-3 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-content-secondary">Completing authentication...</p>
          </div>
        )}

        {status === 'success' && (
          <div className="space-y-4">
            <CheckCircle className="w-16 h-16 text-green-500 mx-auto" />
            <div>
              <h2 className="text-2xl font-bold text-content-primary mb-2">Welcome to NexusMCP!</h2>
              <p className="text-content-secondary">Redirecting to your dashboard...</p>
            </div>
          </div>
        )}

        {status === 'error' && (
          <div className="space-y-4">
            <XCircle className="w-16 h-16 text-red-500 mx-auto" />
            <div>
              <h2 className="text-2xl font-bold text-content-primary mb-2">Authentication Failed</h2>
              <p className="text-content-secondary mb-6">{error}</p>
              <a 
                href="/login"
                className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-white rounded-xl hover:bg-primary/90 transition-colors font-medium"
              >
                Try Again
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
