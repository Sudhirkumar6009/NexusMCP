import { Router } from 'express';
import { dataStore } from '../data/store.js';

const router = Router();

// GET /api/settings - Get all settings
router.get('/', (_req, res) => {
  const settings = dataStore.getSettings();
  
  // Hide API keys
  const safeSettings = {
    ...settings,
    llm: {
      ...settings.llm,
      apiKey: settings.llm.apiKey ? '••••••••' : undefined,
    },
  };
  
  res.json({
    success: true,
    data: safeSettings,
  });
});

// PUT /api/settings - Update settings
router.put('/', (req, res) => {
  const updates = req.body;
  const settings = dataStore.updateSettings(updates);
  
  // Hide API keys
  const safeSettings = {
    ...settings,
    llm: {
      ...settings.llm,
      apiKey: settings.llm.apiKey ? '••••••••' : undefined,
    },
  };
  
  res.json({
    success: true,
    data: safeSettings,
    message: 'Settings updated successfully',
  });
});

// PUT /api/settings/llm - Update LLM settings
router.put('/llm', (req, res) => {
  const llmUpdates = req.body;
  const currentSettings = dataStore.getSettings();
  
  const settings = dataStore.updateSettings({
    llm: {
      ...currentSettings.llm,
      ...llmUpdates,
    },
  });
  
  res.json({
    success: true,
    data: {
      ...settings.llm,
      apiKey: settings.llm.apiKey ? '••••••••' : undefined,
    },
    message: 'LLM settings updated',
  });
});

// PUT /api/settings/execution - Update execution settings
router.put('/execution', (req, res) => {
  const executionUpdates = req.body;
  const currentSettings = dataStore.getSettings();
  
  const settings = dataStore.updateSettings({
    execution: {
      ...currentSettings.execution,
      ...executionUpdates,
    },
  });
  
  res.json({
    success: true,
    data: settings.execution,
    message: 'Execution settings updated',
  });
});

// PUT /api/settings/notifications - Update notification settings
router.put('/notifications', (req, res) => {
  const notificationUpdates = req.body;
  const currentSettings = dataStore.getSettings();
  
  const settings = dataStore.updateSettings({
    notifications: {
      ...currentSettings.notifications,
      ...notificationUpdates,
    },
  });
  
  res.json({
    success: true,
    data: settings.notifications,
    message: 'Notification settings updated',
  });
});

export default router;
