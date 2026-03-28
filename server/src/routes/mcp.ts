import { Router } from 'express';
import { processMCPRequest, executeNode, getAvailableMethods } from '../services/mcp.js';
import { dataStore } from '../data/store.js';
import type { MCPRequest, DAGNode } from '../types/index.js';

const router = Router();

// POST /api/mcp/execute - Execute an MCP request
router.post('/execute', async (req, res) => {
  const mcpRequest = req.body as MCPRequest;
  
  if (!mcpRequest.jsonrpc || mcpRequest.jsonrpc !== '2.0') {
    return res.status(400).json({
      success: false,
      error: 'Invalid JSON-RPC request: missing or invalid jsonrpc version',
    });
  }
  
  if (!mcpRequest.method) {
    return res.status(400).json({
      success: false,
      error: 'Invalid JSON-RPC request: missing method',
    });
  }
  
  const response = await processMCPRequest(mcpRequest);
  
  res.json({
    success: !response.error,
    data: response,
  });
});

// POST /api/mcp/execute-node - Execute a workflow node
router.post('/execute-node', async (req, res) => {
  const node = req.body as DAGNode;
  
  if (!node.id || !node.service || !node.operation) {
    return res.status(400).json({
      success: false,
      error: 'Invalid node: missing id, service, or operation',
    });
  }
  
  const result = await executeNode(node);
  
  res.json({
    success: !result.error,
    data: result,
  });
});

// GET /api/mcp/methods - List available MCP methods
router.get('/methods', (_req, res) => {
  const methods = getAvailableMethods();
  
  res.json({
    success: true,
    data: methods,
  });
});

// POST /api/mcp/batch - Execute multiple MCP requests
router.post('/batch', async (req, res) => {
  const requests = req.body as MCPRequest[];
  
  if (!Array.isArray(requests)) {
    return res.status(400).json({
      success: false,
      error: 'Request body must be an array of MCP requests',
    });
  }
  
  const responses = await Promise.all(
    requests.map(request => processMCPRequest(request))
  );
  
  res.json({
    success: true,
    data: responses,
  });
});

// WebSocket-like endpoint for streaming execution updates
// In a real app, this would be a WebSocket connection
router.post('/stream', async (req, res) => {
  const { workflowId } = req.body;
  
  const workflow = dataStore.getWorkflow(workflowId);
  
  if (!workflow) {
    return res.status(404).json({
      success: false,
      error: 'Workflow not found',
    });
  }
  
  // Start execution
  const execution = dataStore.createExecution(workflowId);
  
  if (!execution) {
    return res.status(500).json({
      success: false,
      error: 'Failed to create execution',
    });
  }
  
  // Execute nodes in order (simplified - real implementation would handle DAG topology)
  const results: Record<string, unknown> = {};
  
  for (const node of workflow.nodes) {
    // Update node status to running
    dataStore.updateExecution(execution.id, {
      currentNodeId: node.id,
      nodeResults: {
        ...execution.nodeResults,
        [node.id]: {
          nodeId: node.id,
          status: 'running',
          startedAt: new Date().toISOString(),
        },
      },
    });
    
    // Execute the node
    const result = await executeNode(node);
    results[node.id] = result;
    
    // Update node status to completed or failed
    dataStore.updateExecution(execution.id, {
      nodeResults: {
        ...execution.nodeResults,
        [node.id]: {
          nodeId: node.id,
          status: result.error ? 'failed' : 'completed',
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          result: result.result,
          error: result.error,
        },
      },
    });
    
    // If node failed, stop execution
    if (result.error) {
      dataStore.updateExecution(execution.id, {
        status: 'failed',
        completedAt: new Date().toISOString(),
      });
      
      dataStore.updateWorkflow(workflowId, { status: 'failed' });
      
      return res.json({
        success: false,
        data: {
          execution: dataStore.getExecution(execution.id),
          results,
        },
        error: `Node ${node.id} failed: ${result.error}`,
      });
    }
  }
  
  // Mark execution as completed
  dataStore.updateExecution(execution.id, {
    status: 'completed',
    completedAt: new Date().toISOString(),
    currentNodeId: undefined,
  });
  
  dataStore.updateWorkflow(workflowId, { status: 'completed' });
  
  res.json({
    success: true,
    data: {
      execution: dataStore.getExecution(execution.id),
      results,
    },
    message: 'Workflow executed successfully',
  });
});

export default router;
