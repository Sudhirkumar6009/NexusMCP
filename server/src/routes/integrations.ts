import { Router } from 'express';
import { dataStore } from '../data/store.js';

const router = Router();

// GET /api/integrations - List all integrations
router.get('/', (_req, res) => {
  const integrations = dataStore.getIntegrations();
  
  // Remove sensitive credentials from response
  const safeIntegrations = integrations.map(int => ({
    ...int,
    credentials: int.credentials ? { configured: true } : undefined,
  }));
  
  res.json({
    success: true,
    data: safeIntegrations,
  });
});

// GET /api/integrations/:id - Get a single integration
router.get('/:id', (req, res) => {
  const integration = dataStore.getIntegration(req.params.id);
  
  if (!integration) {
    return res.status(404).json({
      success: false,
      error: 'Integration not found',
    });
  }
  
  // Remove sensitive credentials
  const safeIntegration = {
    ...integration,
    credentials: integration.credentials ? { configured: true } : undefined,
  };
  
  res.json({
    success: true,
    data: safeIntegration,
  });
});

// POST /api/integrations/:id/connect - Connect an integration
router.post('/:id/connect', async (req, res) => {
  const { credentials } = req.body;
  
  if (!credentials) {
    return res.status(400).json({
      success: false,
      error: 'Credentials are required',
    });
  }
  
  // Simulate connection validation delay
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Mock credential validation (in real app, would test actual connection)
  const integration = dataStore.connectIntegration(req.params.id, credentials);
  
  if (!integration) {
    return res.status(404).json({
      success: false,
      error: 'Integration not found',
    });
  }
  
  // Remove sensitive credentials from response
  const safeIntegration = {
    ...integration,
    credentials: { configured: true },
  };
  
  res.json({
    success: true,
    data: safeIntegration,
    message: `${integration.name} connected successfully`,
  });
});

// POST /api/integrations/:id/disconnect - Disconnect an integration
router.post('/:id/disconnect', (req, res) => {
  const integration = dataStore.disconnectIntegration(req.params.id);
  
  if (!integration) {
    return res.status(404).json({
      success: false,
      error: 'Integration not found',
    });
  }
  
  res.json({
    success: true,
    data: integration,
    message: `${integration.name} disconnected`,
  });
});

// POST /api/integrations/:id/test - Test an integration connection
router.post('/:id/test', async (req, res) => {
  const integration = dataStore.getIntegration(req.params.id);
  
  if (!integration) {
    return res.status(404).json({
      success: false,
      error: 'Integration not found',
    });
  }
  
  if (integration.status !== 'connected') {
    return res.status(400).json({
      success: false,
      error: 'Integration is not connected',
    });
  }
  
  // Simulate connection test
  await new Promise(resolve => setTimeout(resolve, 500));
  
  // Mock test result (90% success rate)
  const testPassed = Math.random() > 0.1;
  
  if (testPassed) {
    dataStore.addLog({
      level: 'info',
      service: integration.service,
      action: 'connection_test',
      message: `Connection test passed for ${integration.name}`,
    });
    
    res.json({
      success: true,
      message: 'Connection test passed',
      data: {
        latency: Math.floor(Math.random() * 100) + 50,
        version: '1.0.0',
      },
    });
  } else {
    dataStore.addLog({
      level: 'warning',
      service: integration.service,
      action: 'connection_test',
      message: `Connection test failed for ${integration.name}`,
    });
    
    res.status(500).json({
      success: false,
      error: 'Connection test failed: Unable to reach service',
    });
  }
});

// GET /api/integrations/:id/capabilities - Get integration capabilities
router.get('/:id/capabilities', (req, res) => {
  const integration = dataStore.getIntegration(req.params.id);
  
  if (!integration) {
    return res.status(404).json({
      success: false,
      error: 'Integration not found',
    });
  }
  
  res.json({
    success: true,
    data: integration.capabilities,
  });
});

export default router;
