import type { Request, Response, NextFunction } from 'express';

// Simple delay middleware to simulate network latency
export function simulateLatency(minMs: number = 100, maxMs: number = 500) {
  return (_req: Request, _res: Response, next: NextFunction) => {
    const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
    setTimeout(next, delay);
  };
}

// Error handling middleware
export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  console.error('Error:', err.message);
  
  res.status(500).json({
    success: false,
    error: err.message || 'Internal server error',
  });
}

// Request logging middleware
export function requestLogger(req: Request, _res: Response, next: NextFunction) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.path}`);
  next();
}

// Simple auth middleware (mock authentication)
export function authenticate(req: Request, res: Response, next: NextFunction) {
  // For now, we'll accept any request with a valid-looking auth header
  // or no auth header at all (for development)
  const authHeader = req.headers.authorization;
  
  if (authHeader) {
    // In a real app, we'd validate the JWT token here
    const token = authHeader.replace('Bearer ', '');
    if (token && token.length > 0) {
      // Mock user attachment
      (req as Request & { userId?: string }).userId = 'user-admin';
    }
  } else {
    // Allow unauthenticated requests in dev mode
    (req as Request & { userId?: string }).userId = 'user-admin';
  }
  
  next();
}
