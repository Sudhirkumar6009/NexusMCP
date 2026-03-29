import { Router } from 'express';
import { dataStore } from '../data/store.js';
import type { Workflow } from '../types/index.js';

const router = Router();

// GET /api/workflows - List all workflows
router.get('/', (_req, res) => {
  const workflows = dataStore.getWorkflows();
  res.json({
    success: true,
    data: workflows,
  });
});

// GET /api/workflows/:id - Get a single workflow
router.get('/:id', (req, res) => {
  const workflow = dataStore.getWorkflow(req.params.id);
  
  if (!workflow) {
    return res.status(404).json({
      success: false,
      error: 'Workflow not found',
    });
  }
  
  res.json({
    success: true,
    data: workflow,
  });
});

// POST /api/workflows - Create a new workflow
router.post('/', (req, res) => {
  const { name, description, nodes, edges, status } = req.body;
  
  if (!name) {
    return res.status(400).json({
      success: false,
      error: 'Workflow name is required',
    });
  }
  
  const workflow = dataStore.createWorkflow({
    name,
    description: description || '',
    nodes: nodes || [],
    edges: edges || [],
    status: status || 'draft',
  });
  
  res.status(201).json({
    success: true,
    data: workflow,
    message: 'Workflow created successfully',
  });
});

// PUT /api/workflows/:id - Update a workflow
router.put('/:id', (req, res) => {
  const updates: Partial<Workflow> = req.body;
  const workflow = dataStore.updateWorkflow(req.params.id, updates);
  
  if (!workflow) {
    return res.status(404).json({
      success: false,
      error: 'Workflow not found',
    });
  }
  
  res.json({
    success: true,
    data: workflow,
    message: 'Workflow updated successfully',
  });
});

// DELETE /api/workflows/:id - Delete a workflow
router.delete('/:id', (req, res) => {
  const deleted = dataStore.deleteWorkflow(req.params.id);
  
  if (!deleted) {
    return res.status(404).json({
      success: false,
      error: 'Workflow not found',
    });
  }
  
  res.json({
    success: true,
    message: 'Workflow deleted successfully',
  });
});

// POST /api/workflows/:id/execute - Execute a workflow
router.post('/:id/execute', (req, res) => {
  const execution = dataStore.createExecution(req.params.id);
  
  if (!execution) {
    return res.status(404).json({
      success: false,
      error: 'Workflow not found',
    });
  }
  
  res.json({
    success: true,
    data: execution,
    message: 'Workflow execution started',
  });
});

// POST /api/workflows/:id/pause - Pause a running workflow
router.post('/:id/pause', (req, res) => {
  const workflow = dataStore.getWorkflow(req.params.id);
  
  if (!workflow) {
    return res.status(404).json({
      success: false,
      error: 'Workflow not found',
    });
  }
  
  if (workflow.status !== 'running') {
    return res.status(400).json({
      success: false,
      error: 'Workflow is not running',
    });
  }
  
  const updated = dataStore.updateWorkflow(req.params.id, { status: 'paused' });
  
  dataStore.addLog({
    level: 'info',
    service: 'system',
    action: 'workflow_paused',
    message: `Workflow "${workflow.name}" paused`,
    workflowId: workflow.id,
  });
  
  res.json({
    success: true,
    data: updated,
    message: 'Workflow paused',
  });
});

// POST /api/workflows/:id/resume - Resume a paused workflow
router.post('/:id/resume', (req, res) => {
  const workflow = dataStore.getWorkflow(req.params.id);
  
  if (!workflow) {
    return res.status(404).json({
      success: false,
      error: 'Workflow not found',
    });
  }
  
  if (workflow.status !== 'paused') {
    return res.status(400).json({
      success: false,
      error: 'Workflow is not paused',
    });
  }
  
  const updated = dataStore.updateWorkflow(req.params.id, { status: 'running' });
  
  dataStore.addLog({
    level: 'info',
    service: 'system',
    action: 'workflow_resumed',
    message: `Workflow "${workflow.name}" resumed`,
    workflowId: workflow.id,
  });
  
  res.json({
    success: true,
    data: updated,
    message: 'Workflow resumed',
  });
});

// POST /api/workflows/:id/stop - Stop a workflow
router.post('/:id/stop', (req, res) => {
  const workflow = dataStore.getWorkflow(req.params.id);
  
  if (!workflow) {
    return res.status(404).json({
      success: false,
      error: 'Workflow not found',
    });
  }
  
  if (workflow.status !== 'running' && workflow.status !== 'paused') {
    return res.status(400).json({
      success: false,
      error: 'Workflow is not running or paused',
    });
  }
  
  const updated = dataStore.updateWorkflow(req.params.id, { status: 'ready' });
  
  dataStore.addLog({
    level: 'info',
    service: 'system',
    action: 'workflow_stopped',
    message: `Workflow "${workflow.name}" stopped`,
    workflowId: workflow.id,
  });
  
  res.json({
    success: true,
    data: updated,
    message: 'Workflow stopped',
  });
});

// POST /api/workflows/generate - Generate workflow from prompt (AI simulation)
router.post('/generate', async (req, res) => {
  const { prompt } = req.body;
  
  if (!prompt) {
    return res.status(400).json({
      success: false,
      error: 'Prompt is required',
    });
  }
  
  // Simulate AI processing delay
  await new Promise(resolve => setTimeout(resolve, 1500));
  
  // Generate a mock workflow based on keywords in the prompt
  const promptLower = prompt.toLowerCase();
  const nodes = [];
  const edges = [];
  let nodeIndex = 1;
  
  // Determine trigger
  if (promptLower.includes('slack') || promptLower.includes('message')) {
    nodes.push({
      id: `node-${nodeIndex}`,
      type: 'trigger',
      service: 'slack',
      operation: 'on-message',
      label: 'Slack Message Trigger',
      config: { channel: '#general' },
      position: { x: 250, y: 50 },
    });
    nodeIndex++;
  } else if (promptLower.includes('github') || promptLower.includes('push') || promptLower.includes('pr')) {
    nodes.push({
      id: `node-${nodeIndex}`,
      type: 'trigger',
      service: 'github',
      operation: 'on-push',
      label: 'GitHub Push Trigger',
      config: { branch: 'main' },
      position: { x: 250, y: 50 },
    });
    nodeIndex++;
  }
  
  // Add actions based on keywords
  if (promptLower.includes('jira') || promptLower.includes('ticket') || promptLower.includes('issue')) {
    const prevNode = nodes.length > 0 ? nodes[nodes.length - 1].id : null;
    nodes.push({
      id: `node-${nodeIndex}`,
      type: 'action',
      service: 'jira',
      operation: 'create-issue',
      label: 'Create Jira Issue',
      config: { project: 'PROJ', type: 'Task' },
      position: { x: 250, y: 50 + (nodeIndex - 1) * 100 },
    });
    if (prevNode) {
      edges.push({ id: `edge-${edges.length + 1}`, source: prevNode, target: `node-${nodeIndex}` });
    }
    nodeIndex++;
  }
  
  if (promptLower.includes('notify') || promptLower.includes('alert') || promptLower.includes('message')) {
    const prevNode = nodes.length > 0 ? nodes[nodes.length - 1].id : null;
    nodes.push({
      id: `node-${nodeIndex}`,
      type: 'action',
      service: 'slack',
      operation: 'send-message',
      label: 'Send Notification',
      config: { channel: '#notifications' },
      position: { x: 250, y: 50 + (nodeIndex - 1) * 100 },
    });
    if (prevNode) {
      edges.push({ id: `edge-${edges.length + 1}`, source: prevNode, target: `node-${nodeIndex}` });
    }
    nodeIndex++;
  }
  
  if (promptLower.includes('database') || promptLower.includes('postgres') || promptLower.includes('store') || promptLower.includes('save')) {
    const prevNode = nodes.length > 0 ? nodes[nodes.length - 1].id : null;
    nodes.push({
      id: `node-${nodeIndex}`,
      type: 'action',
      service: 'postgres',
      operation: 'insert',
      label: 'Store in Database',
      config: { table: 'records' },
      position: { x: 250, y: 50 + (nodeIndex - 1) * 100 },
    });
    if (prevNode) {
      edges.push({ id: `edge-${edges.length + 1}`, source: prevNode, target: `node-${nodeIndex}` });
    }
    nodeIndex++;
  }
  
  // If no nodes were generated, create a default workflow
  if (nodes.length === 0) {
    nodes.push(
      {
        id: 'node-1',
        type: 'trigger',
        service: 'slack',
        operation: 'on-message',
        label: 'Trigger',
        config: {},
        position: { x: 250, y: 50 },
      },
      {
        id: 'node-2',
        type: 'action',
        service: 'jira',
        operation: 'create-issue',
        label: 'Process',
        config: {},
        position: { x: 250, y: 150 },
      }
    );
    edges.push({ id: 'edge-1', source: 'node-1', target: 'node-2' });
  }
  
  // Create the workflow
  const workflow = dataStore.createWorkflow({
    name: `Generated: ${prompt.substring(0, 30)}...`,
    description: prompt,
    nodes: nodes as Workflow['nodes'],
    edges,
    status: 'draft',
  });
  
  res.json({
    success: true,
    data: workflow,
    message: 'Workflow generated from prompt',
  });
});

export default router;
