import type { Metadata } from 'next';
import './globals.css';
import { ThemeProvider, WorkflowProvider, IntegrationsProvider, AuthProvider } from '@/context';

export const metadata: Metadata = {
  title: 'NexusMCP - Agentic MCP Gateway',
  description: 'AI orchestration platform that connects multiple third-party APIs via Model Context Protocol',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider>
          <AuthProvider>
            <IntegrationsProvider>
              <WorkflowProvider>
                {children}
              </WorkflowProvider>
            </IntegrationsProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
