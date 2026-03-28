'use client';

import React, { createContext, useContext, useReducer, useCallback } from 'react';
import { DAGWorkflow, DAGNode, DAGEdge, WorkflowExecution, ExecutionStep, NodeStatus } from '@/types';
import { generateId, sleep, randomBetween } from '@/lib/utils';

// State
interface WorkflowState {
  currentWorkflow: DAGWorkflow | null;
  workflows: DAGWorkflow[];
  execution: WorkflowExecution | null;
  isGenerating: boolean;
  isExecuting: boolean;
  selectedNodeId: string | null;
  terminalLogs: TerminalLog[];
}

interface TerminalLog {
  id: string;
  timestamp: Date;
  type: 'request' | 'response' | 'info' | 'error';
  content: string;
}

// Actions
type WorkflowAction =
  | { type: 'SET_WORKFLOW'; payload: DAGWorkflow }
  | { type: 'CLEAR_WORKFLOW' }
  | { type: 'SET_GENERATING'; payload: boolean }
  | { type: 'SET_EXECUTING'; payload: boolean }
  | { type: 'SELECT_NODE'; payload: string | null }
  | { type: 'UPDATE_NODE'; payload: { id: string; updates: Partial<DAGNode> } }
  | { type: 'UPDATE_NODE_POSITION'; payload: { id: string; position: { x: number; y: number } } }
  | { type: 'ADD_NODE'; payload: DAGNode }
  | { type: 'DELETE_NODE'; payload: string }
  | { type: 'ADD_EDGE'; payload: DAGEdge }
  | { type: 'DELETE_EDGE'; payload: string }
  | { type: 'SET_EXECUTION'; payload: WorkflowExecution | null }
  | { type: 'UPDATE_EXECUTION_STEP'; payload: { index: number; step: Partial<ExecutionStep> } }
  | { type: 'ADD_TERMINAL_LOG'; payload: TerminalLog }
  | { type: 'CLEAR_TERMINAL_LOGS' };

// Initial state
const initialState: WorkflowState = {
  currentWorkflow: null,
  workflows: [],
  execution: null,
  isGenerating: false,
  isExecuting: false,
  selectedNodeId: null,
  terminalLogs: [],
};

// Reducer
function workflowReducer(state: WorkflowState, action: WorkflowAction): WorkflowState {
  switch (action.type) {
    case 'SET_WORKFLOW':
      return { ...state, currentWorkflow: action.payload };
    case 'CLEAR_WORKFLOW':
      return { ...state, currentWorkflow: null, execution: null, selectedNodeId: null };
    case 'SET_GENERATING':
      return { ...state, isGenerating: action.payload };
    case 'SET_EXECUTING':
      return { ...state, isExecuting: action.payload };
    case 'SELECT_NODE':
      return { ...state, selectedNodeId: action.payload };
    case 'UPDATE_NODE':
      if (!state.currentWorkflow) return state;
      return {
        ...state,
        currentWorkflow: {
          ...state.currentWorkflow,
          nodes: state.currentWorkflow.nodes.map((node) =>
            node.id === action.payload.id ? { ...node, ...action.payload.updates } : node
          ),
        },
      };
    case 'UPDATE_NODE_POSITION':
      if (!state.currentWorkflow) return state;
      return {
        ...state,
        currentWorkflow: {
          ...state.currentWorkflow,
          nodes: state.currentWorkflow.nodes.map((node) =>
            node.id === action.payload.id ? { ...node, position: action.payload.position } : node
          ),
        },
      };
    case 'ADD_NODE':
      if (!state.currentWorkflow) return state;
      return {
        ...state,
        currentWorkflow: {
          ...state.currentWorkflow,
          nodes: [...state.currentWorkflow.nodes, action.payload],
        },
      };
    case 'DELETE_NODE':
      if (!state.currentWorkflow) return state;
      return {
        ...state,
        currentWorkflow: {
          ...state.currentWorkflow,
          nodes: state.currentWorkflow.nodes.filter((node) => node.id !== action.payload),
          edges: state.currentWorkflow.edges.filter(
            (edge) => edge.source !== action.payload && edge.target !== action.payload
          ),
        },
        selectedNodeId: state.selectedNodeId === action.payload ? null : state.selectedNodeId,
      };
    case 'ADD_EDGE':
      if (!state.currentWorkflow) return state;
      return {
        ...state,
        currentWorkflow: {
          ...state.currentWorkflow,
          edges: [...state.currentWorkflow.edges, action.payload],
        },
      };
    case 'DELETE_EDGE':
      if (!state.currentWorkflow) return state;
      return {
        ...state,
        currentWorkflow: {
          ...state.currentWorkflow,
          edges: state.currentWorkflow.edges.filter((edge) => edge.id !== action.payload),
        },
      };
    case 'SET_EXECUTION':
      return { ...state, execution: action.payload };
    case 'UPDATE_EXECUTION_STEP':
      if (!state.execution) return state;
      const newSteps = [...state.execution.steps];
      newSteps[action.payload.index] = { ...newSteps[action.payload.index], ...action.payload.step };
      return {
        ...state,
        execution: {
          ...state.execution,
          steps: newSteps,
        },
      };
    case 'ADD_TERMINAL_LOG':
      return {
        ...state,
        terminalLogs: [...state.terminalLogs, action.payload].slice(-100), // Keep last 100 logs
      };
    case 'CLEAR_TERMINAL_LOGS':
      return { ...state, terminalLogs: [] };
    default:
      return state;
  }
}

// Context
interface WorkflowContextType extends WorkflowState {
  generateDAG: (prompt: string) => Promise<void>;
  executeWorkflow: () => Promise<void>;
  approveExecution: () => void;
  rejectExecution: () => void;
  selectNode: (nodeId: string | null) => void;
  updateNode: (id: string, updates: Partial<DAGNode>) => void;
  updateNodePosition: (id: string, position: { x: number; y: number }) => void;
  addNode: (node: DAGNode) => void;
  deleteNode: (id: string) => void;
  addEdge: (edge: DAGEdge) => void;
  deleteEdge: (id: string) => void;
  clearWorkflow: () => void;
  addTerminalLog: (type: TerminalLog['type'], content: string) => void;
}

const WorkflowContext = createContext<WorkflowContextType | undefined>(undefined);

// Sample DAG generation based on prompt
function generateSampleDAG(prompt: string): DAGWorkflow {
  const id = generateId();
  const lowerPrompt = prompt.toLowerCase();
  
  let nodes: DAGNode[] = [];
  let edges: DAGEdge[] = [];
  
  // Check prompt keywords and generate appropriate DAG
  if (lowerPrompt.includes('bug') || lowerPrompt.includes('jira')) {
    // Bug workflow
    nodes = [
      { id: 'trigger-1', type: 'trigger', label: 'Jira Bug Created', service: 'jira', tool: 'on_issue_created', position: { x: 300, y: 50 }, status: 'pending' },
      { id: 'condition-1', type: 'condition', label: 'Is Critical?', position: { x: 300, y: 150 }, status: 'pending' },
      { id: 'action-1', type: 'action', label: 'Create GitHub Branch', service: 'github', tool: 'create_branch', position: { x: 150, y: 280 }, status: 'pending' },
      { id: 'action-2', type: 'action', label: 'Notify Slack Channel', service: 'slack', tool: 'send_message', position: { x: 450, y: 280 }, status: 'pending' },
      { id: 'action-3', type: 'action', label: 'Update Tracking Sheet', service: 'postgresql', tool: 'insert_record', position: { x: 300, y: 400 }, status: 'pending' },
      { id: 'end-1', type: 'end', label: 'Complete', position: { x: 300, y: 500 }, status: 'pending' },
    ];
    edges = [
      { id: 'e1', source: 'trigger-1', target: 'condition-1' },
      { id: 'e2', source: 'condition-1', target: 'action-1', label: 'Yes' },
      { id: 'e3', source: 'condition-1', target: 'action-2', label: 'Yes' },
      { id: 'e4', source: 'action-1', target: 'action-3' },
      { id: 'e5', source: 'action-2', target: 'action-3' },
      { id: 'e6', source: 'action-3', target: 'end-1' },
    ];
  } else if (lowerPrompt.includes('pr') || lowerPrompt.includes('pull request')) {
    // PR Review workflow
    nodes = [
      { id: 'trigger-1', type: 'trigger', label: 'PR Opened', service: 'github', tool: 'on_pr_opened', position: { x: 300, y: 50 }, status: 'pending' },
      { id: 'action-1', type: 'action', label: 'Run Security Scan', service: 'github', tool: 'run_action', position: { x: 300, y: 150 }, status: 'pending' },
      { id: 'approval-1', type: 'approval', label: 'Review Required', position: { x: 300, y: 260 }, status: 'pending' },
      { id: 'action-2', type: 'action', label: 'Notify Reviewers', service: 'slack', tool: 'send_message', position: { x: 150, y: 370 }, status: 'pending' },
      { id: 'action-3', type: 'action', label: 'Create Jira Ticket', service: 'jira', tool: 'create_issue', position: { x: 450, y: 370 }, status: 'pending' },
      { id: 'end-1', type: 'end', label: 'Complete', position: { x: 300, y: 480 }, status: 'pending' },
    ];
    edges = [
      { id: 'e1', source: 'trigger-1', target: 'action-1' },
      { id: 'e2', source: 'action-1', target: 'approval-1' },
      { id: 'e3', source: 'approval-1', target: 'action-2' },
      { id: 'e4', source: 'approval-1', target: 'action-3' },
      { id: 'e5', source: 'action-2', target: 'end-1' },
      { id: 'e6', source: 'action-3', target: 'end-1' },
    ];
  } else {
    // Default workflow
    nodes = [
      { id: 'trigger-1', type: 'trigger', label: 'Workflow Trigger', position: { x: 300, y: 50 }, status: 'pending' },
      { id: 'action-1', type: 'action', label: 'Fetch Data', service: 'postgresql', tool: 'query', position: { x: 300, y: 160 }, status: 'pending' },
      { id: 'action-2', type: 'action', label: 'Process Data', service: 'github', tool: 'create_issue', position: { x: 300, y: 270 }, status: 'pending' },
      { id: 'action-3', type: 'action', label: 'Send Notification', service: 'slack', tool: 'send_message', position: { x: 300, y: 380 }, status: 'pending' },
      { id: 'end-1', type: 'end', label: 'Complete', position: { x: 300, y: 490 }, status: 'pending' },
    ];
    edges = [
      { id: 'e1', source: 'trigger-1', target: 'action-1' },
      { id: 'e2', source: 'action-1', target: 'action-2' },
      { id: 'e3', source: 'action-2', target: 'action-3' },
      { id: 'e4', source: 'action-3', target: 'end-1' },
    ];
  }

  return {
    id,
    name: `Workflow ${id.slice(-4)}`,
    description: prompt,
    prompt,
    nodes,
    edges,
    createdAt: new Date(),
    updatedAt: new Date(),
    status: 'ready',
  };
}

// Provider
export function WorkflowProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(workflowReducer, initialState);

  const addTerminalLog = useCallback((type: TerminalLog['type'], content: string) => {
    dispatch({
      type: 'ADD_TERMINAL_LOG',
      payload: {
        id: generateId(),
        timestamp: new Date(),
        type,
        content,
      },
    });
  }, []);

  const generateDAG = useCallback(async (prompt: string) => {
    dispatch({ type: 'SET_GENERATING', payload: true });
    dispatch({ type: 'CLEAR_TERMINAL_LOGS' });
    
    addTerminalLog('info', `Generating DAG for prompt: "${prompt}"`);
    
    // Simulate LLM processing delay
    await sleep(randomBetween(1500, 2500));
    
    const workflow = generateSampleDAG(prompt);
    
    addTerminalLog('info', `Generated workflow with ${workflow.nodes.length} nodes and ${workflow.edges.length} edges`);
    
    dispatch({ type: 'SET_WORKFLOW', payload: workflow });
    dispatch({ type: 'SET_GENERATING', payload: false });
  }, [addTerminalLog]);

  const executeWorkflow = useCallback(async () => {
    if (!state.currentWorkflow) return;
    
    dispatch({ type: 'SET_EXECUTING', payload: true });
    
    const workflow = state.currentWorkflow;
    const executionSteps: ExecutionStep[] = workflow.nodes
      .filter((n) => n.type !== 'end')
      .map((node) => ({
        nodeId: node.id,
        nodeName: node.label,
        service: node.service || 'system',
        tool: node.tool || 'execute',
        status: 'pending' as NodeStatus,
        retryAttempt: 0,
        maxRetries: 3,
      }));

    const execution: WorkflowExecution = {
      id: generateId(),
      workflowId: workflow.id,
      workflowName: workflow.name,
      status: 'running',
      startedAt: new Date(),
      steps: executionSteps,
      currentStepIndex: 0,
      progress: 0,
    };

    dispatch({ type: 'SET_EXECUTION', payload: execution });

    // Execute each step
    for (let i = 0; i < executionSteps.length; i++) {
      const step = executionSteps[i];
      const node = workflow.nodes.find((n) => n.id === step.nodeId);
      
      // Update current step to running
      dispatch({
        type: 'UPDATE_EXECUTION_STEP',
        payload: {
          index: i,
          step: { status: 'running', startedAt: new Date() },
        },
      });
      dispatch({
        type: 'UPDATE_NODE',
        payload: { id: step.nodeId, updates: { status: 'running' } },
      });

      // Log MCP request
      const mcpRequest = {
        jsonrpc: '2.0',
        id: `req_${generateId().slice(-6)}`,
        method: 'tools/call',
        params: {
          name: `${step.service}_${step.tool}`,
          arguments: { workflowId: workflow.id, nodeId: step.nodeId },
        },
      };
      addTerminalLog('request', JSON.stringify(mcpRequest, null, 2));

      // Check for approval gate
      if (node?.type === 'approval') {
        dispatch({
          type: 'UPDATE_EXECUTION_STEP',
          payload: { index: i, step: { status: 'waiting_approval' } },
        });
        dispatch({
          type: 'UPDATE_NODE',
          payload: { id: step.nodeId, updates: { status: 'waiting_approval' } },
        });
        dispatch({
          type: 'SET_EXECUTION',
          payload: {
            ...execution,
            steps: executionSteps,
            currentStepIndex: i,
            progress: Math.round(((i) / executionSteps.length) * 100),
            approvalRequired: true,
            approvalMessage: `Approval required for: ${step.nodeName}`,
          },
        });
        addTerminalLog('info', `Waiting for approval: ${step.nodeName}`);
        return; // Pause execution
      }

      // Simulate API call with random delay
      await sleep(randomBetween(800, 1800));

      // Simulate occasional failures (10% chance)
      const shouldFail = Math.random() < 0.1;
      
      if (shouldFail && step.retryAttempt < step.maxRetries) {
        // Retry logic
        addTerminalLog('error', `Step failed: ${step.nodeName}. Retrying...`);
        dispatch({
          type: 'UPDATE_EXECUTION_STEP',
          payload: {
            index: i,
            step: { status: 'retrying', retryAttempt: step.retryAttempt + 1 },
          },
        });
        dispatch({
          type: 'UPDATE_NODE',
          payload: { id: step.nodeId, updates: { status: 'retrying', retryCount: step.retryAttempt + 1 } },
        });
        
        await sleep(1000);
        // Retry succeeds
      }

      // Log MCP response
      const mcpResponse = {
        jsonrpc: '2.0',
        id: mcpRequest.id,
        result: {
          content: [{ type: 'text', text: `Successfully executed ${step.nodeName}` }],
          isError: false,
        },
      };
      addTerminalLog('response', JSON.stringify(mcpResponse, null, 2));

      // Mark step as success
      dispatch({
        type: 'UPDATE_EXECUTION_STEP',
        payload: {
          index: i,
          step: {
            status: 'success',
            completedAt: new Date(),
            duration: randomBetween(500, 1500),
            output: { result: 'success', data: {} },
          },
        },
      });
      dispatch({
        type: 'UPDATE_NODE',
        payload: { id: step.nodeId, updates: { status: 'success' } },
      });

      // Update progress
      dispatch({
        type: 'SET_EXECUTION',
        payload: {
          ...execution,
          steps: executionSteps,
          currentStepIndex: i + 1,
          progress: Math.round(((i + 1) / executionSteps.length) * 100),
        },
      });
    }

    // Mark end node as success
    const endNode = workflow.nodes.find((n) => n.type === 'end');
    if (endNode) {
      dispatch({
        type: 'UPDATE_NODE',
        payload: { id: endNode.id, updates: { status: 'success' } },
      });
    }

    // Complete execution
    dispatch({
      type: 'SET_EXECUTION',
      payload: {
        ...execution,
        status: 'completed',
        completedAt: new Date(),
        progress: 100,
        steps: executionSteps,
        currentStepIndex: executionSteps.length,
      },
    });
    dispatch({ type: 'SET_EXECUTING', payload: false });
    addTerminalLog('info', 'Workflow execution completed successfully');
  }, [state.currentWorkflow, addTerminalLog]);

  const approveExecution = useCallback(async () => {
    if (!state.execution || !state.currentWorkflow) return;
    
    addTerminalLog('info', 'Approval granted. Continuing execution...');
    
    const currentIndex = state.execution.currentStepIndex;
    
    // Mark current approval step as success
    dispatch({
      type: 'UPDATE_EXECUTION_STEP',
      payload: {
        index: currentIndex,
        step: { status: 'success', completedAt: new Date() },
      },
    });
    
    const step = state.execution.steps[currentIndex];
    dispatch({
      type: 'UPDATE_NODE',
      payload: { id: step.nodeId, updates: { status: 'success' } },
    });
    
    // Clear approval requirement
    dispatch({
      type: 'SET_EXECUTION',
      payload: {
        ...state.execution,
        approvalRequired: false,
        approvalMessage: undefined,
        currentStepIndex: currentIndex + 1,
        progress: Math.round(((currentIndex + 1) / state.execution.steps.length) * 100),
      },
    });

    // Continue execution for remaining steps
    const workflow = state.currentWorkflow;
    const execution = state.execution;
    
    for (let i = currentIndex + 1; i < execution.steps.length; i++) {
      const step = execution.steps[i];
      const node = workflow.nodes.find((n) => n.id === step.nodeId);
      
      dispatch({
        type: 'UPDATE_EXECUTION_STEP',
        payload: {
          index: i,
          step: { status: 'running', startedAt: new Date() },
        },
      });
      dispatch({
        type: 'UPDATE_NODE',
        payload: { id: step.nodeId, updates: { status: 'running' } },
      });

      // Check for another approval gate
      if (node?.type === 'approval') {
        dispatch({
          type: 'UPDATE_EXECUTION_STEP',
          payload: { index: i, step: { status: 'waiting_approval' } },
        });
        dispatch({
          type: 'UPDATE_NODE',
          payload: { id: step.nodeId, updates: { status: 'waiting_approval' } },
        });
        dispatch({
          type: 'SET_EXECUTION',
          payload: {
            ...execution,
            currentStepIndex: i,
            progress: Math.round((i / execution.steps.length) * 100),
            approvalRequired: true,
            approvalMessage: `Approval required for: ${step.nodeName}`,
          },
        });
        return;
      }

      await sleep(randomBetween(800, 1500));

      const mcpResponse = {
        jsonrpc: '2.0',
        id: `req_${generateId().slice(-6)}`,
        result: {
          content: [{ type: 'text', text: `Successfully executed ${step.nodeName}` }],
          isError: false,
        },
      };
      addTerminalLog('response', JSON.stringify(mcpResponse, null, 2));

      dispatch({
        type: 'UPDATE_EXECUTION_STEP',
        payload: {
          index: i,
          step: {
            status: 'success',
            completedAt: new Date(),
            duration: randomBetween(500, 1500),
          },
        },
      });
      dispatch({
        type: 'UPDATE_NODE',
        payload: { id: step.nodeId, updates: { status: 'success' } },
      });
    }

    // Mark end node
    const endNode = workflow.nodes.find((n) => n.type === 'end');
    if (endNode) {
      dispatch({
        type: 'UPDATE_NODE',
        payload: { id: endNode.id, updates: { status: 'success' } },
      });
    }

    dispatch({
      type: 'SET_EXECUTION',
      payload: {
        ...execution,
        status: 'completed',
        completedAt: new Date(),
        progress: 100,
      },
    });
    dispatch({ type: 'SET_EXECUTING', payload: false });
    addTerminalLog('info', 'Workflow execution completed successfully');
  }, [state.execution, state.currentWorkflow, addTerminalLog]);

  const rejectExecution = useCallback(() => {
    if (!state.execution) return;
    
    addTerminalLog('error', 'Execution rejected by user');
    
    const currentIndex = state.execution.currentStepIndex;
    
    dispatch({
      type: 'UPDATE_EXECUTION_STEP',
      payload: {
        index: currentIndex,
        step: { status: 'failed', error: 'Rejected by user' },
      },
    });
    
    const step = state.execution.steps[currentIndex];
    dispatch({
      type: 'UPDATE_NODE',
      payload: { id: step.nodeId, updates: { status: 'failed', error: 'Rejected by user' } },
    });
    
    dispatch({
      type: 'SET_EXECUTION',
      payload: {
        ...state.execution,
        status: 'cancelled',
        approvalRequired: false,
        approvalMessage: undefined,
      },
    });
    dispatch({ type: 'SET_EXECUTING', payload: false });
  }, [state.execution, addTerminalLog]);

  const selectNode = useCallback((nodeId: string | null) => {
    dispatch({ type: 'SELECT_NODE', payload: nodeId });
  }, []);

  const updateNode = useCallback((id: string, updates: Partial<DAGNode>) => {
    dispatch({ type: 'UPDATE_NODE', payload: { id, updates } });
  }, []);

  const updateNodePosition = useCallback((id: string, position: { x: number; y: number }) => {
    dispatch({ type: 'UPDATE_NODE_POSITION', payload: { id, position } });
  }, []);

  const addNode = useCallback((node: DAGNode) => {
    dispatch({ type: 'ADD_NODE', payload: node });
  }, []);

  const deleteNode = useCallback((id: string) => {
    dispatch({ type: 'DELETE_NODE', payload: id });
  }, []);

  const addEdge = useCallback((edge: DAGEdge) => {
    dispatch({ type: 'ADD_EDGE', payload: edge });
  }, []);

  const deleteEdge = useCallback((id: string) => {
    dispatch({ type: 'DELETE_EDGE', payload: id });
  }, []);

  const clearWorkflow = useCallback(() => {
    dispatch({ type: 'CLEAR_WORKFLOW' });
    dispatch({ type: 'CLEAR_TERMINAL_LOGS' });
  }, []);

  return (
    <WorkflowContext.Provider
      value={{
        ...state,
        generateDAG,
        executeWorkflow,
        approveExecution,
        rejectExecution,
        selectNode,
        updateNode,
        updateNodePosition,
        addNode,
        deleteNode,
        addEdge,
        deleteEdge,
        clearWorkflow,
        addTerminalLog,
      }}
    >
      {children}
    </WorkflowContext.Provider>
  );
}

export function useWorkflow() {
  const context = useContext(WorkflowContext);
  if (context === undefined) {
    throw new Error('useWorkflow must be used within a WorkflowProvider');
  }
  return context;
}
