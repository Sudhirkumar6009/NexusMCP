import { Router } from 'express';
import { dataStore } from '../data/store.js';

const router = Router();

// GET /api/logs - List audit logs with filtering
router.get('/', (req, res) => {
  const { level, service, search, limit, offset } = req.query;
  
  const result = dataStore.getLogs({
    level: level as 'info' | 'warning' | 'error' | 'debug' | undefined,
    service: service as 'jira' | 'slack' | 'github' | 'postgres' | 'system' | undefined,
    search: search as string | undefined,
    limit: limit ? parseInt(limit as string, 10) : undefined,
    offset: offset ? parseInt(offset as string, 10) : undefined,
  });
  
  res.json({
    success: true,
    data: result.logs,
    pagination: {
      total: result.total,
      limit: limit ? parseInt(limit as string, 10) : 50,
      offset: offset ? parseInt(offset as string, 10) : 0,
    },
  });
});

// POST /api/logs - Create a new log entry (internal use)
router.post('/', (req, res) => {
  const { level, service, action, message, details, workflowId, nodeId, userId } = req.body;
  
  if (!level || !service || !action || !message) {
    return res.status(400).json({
      success: false,
      error: 'Missing required fields: level, service, action, message',
    });
  }
  
  const log = dataStore.addLog({
    level,
    service,
    action,
    message,
    details,
    workflowId,
    nodeId,
    userId,
  });
  
  res.status(201).json({
    success: true,
    data: log,
  });
});

// GET /api/logs/stats - Get log statistics
router.get('/stats', (_req, res) => {
  const allLogs = dataStore.getLogs({ limit: 1000 });
  
  const stats = {
    total: allLogs.total,
    byLevel: {
      info: 0,
      warning: 0,
      error: 0,
      debug: 0,
    },
    byService: {
      jira: 0,
      slack: 0,
      github: 0,
      postgres: 0,
      system: 0,
    },
    last24Hours: 0,
  };
  
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  
  allLogs.logs.forEach(log => {
    stats.byLevel[log.level]++;
    stats.byService[log.service]++;
    
    if (new Date(log.timestamp).getTime() > oneDayAgo) {
      stats.last24Hours++;
    }
  });
  
  res.json({
    success: true,
    data: stats,
  });
});

export default router;
