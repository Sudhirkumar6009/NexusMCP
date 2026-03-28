import { v4 as uuidv4 } from 'uuid';
import { dataStore } from '../data/store.js';
import type { MCPRequest, MCPResponse, MCPError, DAGNode } from '../types/index.js';

// MCP Method handlers
type MCPHandler = (params: Record<string, unknown>) => Promise<unknown>;

const handlers: Record<string, MCPHandler> = {
  // Jira methods
  'jira.createIssue': async (params) => {
    await simulateDelay(300, 800);
    const { project, summary, description, type } = params as {
      project: string;
      summary: string;
      description: string;
      type: string;
    };
    
    const issueKey = `${project}-${Math.floor(Math.random() * 1000)}`;
    
    dataStore.addLog({
      level: 'info',
      service: 'jira',
      action: 'create_issue',
      message: `Created issue ${issueKey}: ${summary}`,
      details: { issueKey, project, type },
    });
    
    return {
      issueKey,
      issueId: uuidv4(),
      self: `https://jira.example.com/rest/api/2/issue/${issueKey}`,
    };
  },
  
  'jira.getIssues': async (params) => {
    await simulateDelay(200, 500);
    const { jql, maxResults = 10 } = params as { jql: string; maxResults?: number };
    
    // Return mock issues
    const issues = Array.from({ length: Math.min(maxResults as number, 5) }, (_, i) => ({
      key: `PROJ-${100 + i}`,
      fields: {
        summary: `Mock issue ${i + 1}`,
        status: { name: ['To Do', 'In Progress', 'Done'][i % 3] },
        priority: { name: ['High', 'Medium', 'Low'][i % 3] },
      },
    }));
    
    dataStore.addLog({
      level: 'info',
      service: 'jira',
      action: 'query_issues',
      message: `Queried issues with JQL: ${jql}`,
      details: { resultCount: issues.length },
    });
    
    return { issues, total: issues.length };
  },
  
  'jira.updateIssue': async (params) => {
    await simulateDelay(200, 400);
    const { issueKey, fields } = params as { issueKey: string; fields: Record<string, unknown> };
    
    dataStore.addLog({
      level: 'info',
      service: 'jira',
      action: 'update_issue',
      message: `Updated issue ${issueKey}`,
      details: { issueKey, fields },
    });
    
    return { success: true, issueKey };
  },
  
  // Slack methods
  'slack.sendMessage': async (params) => {
    await simulateDelay(100, 300);
    const { channel, text } = params as { channel: string; text: string; blocks?: unknown[] };
    
    const ts = `${Date.now()}.${Math.floor(Math.random() * 1000000)}`;
    
    dataStore.addLog({
      level: 'info',
      service: 'slack',
      action: 'send_message',
      message: `Sent message to ${channel}`,
      details: { channel, textPreview: text.substring(0, 50) },
    });
    
    return { ok: true, ts, channel };
  },
  
  'slack.getChannels': async () => {
    await simulateDelay(150, 300);
    
    return {
      channels: [
        { id: 'C001', name: 'general' },
        { id: 'C002', name: 'engineering' },
        { id: 'C003', name: 'bugs' },
        { id: 'C004', name: 'notifications' },
      ],
    };
  },
  
  // GitHub methods
  'github.createIssue': async (params) => {
    await simulateDelay(300, 600);
    const { repo, title, body } = params as {
      repo: string;
      title: string;
      body: string;
      labels?: string[];
    };
    
    const number = Math.floor(Math.random() * 1000);
    
    dataStore.addLog({
      level: 'info',
      service: 'github',
      action: 'create_issue',
      message: `Created GitHub issue #${number} in ${repo}`,
      details: { repo, number, title },
    });
    
    return {
      number,
      url: `https://github.com/${repo}/issues/${number}`,
      title,
    };
  },
  
  'github.createPullRequest': async (params) => {
    await simulateDelay(400, 800);
    const { repo, title, head, base } = params as {
      repo: string;
      title: string;
      head: string;
      base: string;
    };
    
    const number = Math.floor(Math.random() * 1000);
    
    dataStore.addLog({
      level: 'info',
      service: 'github',
      action: 'create_pr',
      message: `Created PR #${number} in ${repo}: ${head} -> ${base}`,
      details: { repo, number, title, head, base },
    });
    
    return {
      number,
      url: `https://github.com/${repo}/pull/${number}`,
      title,
    };
  },
  
  'github.getRepository': async (params) => {
    await simulateDelay(100, 200);
    const { repo } = params as { repo: string };
    
    return {
      name: repo.split('/')[1] || repo,
      full_name: repo,
      default_branch: 'main',
      open_issues_count: Math.floor(Math.random() * 50),
      stargazers_count: Math.floor(Math.random() * 1000),
    };
  },
  
  // PostgreSQL methods
  'postgres.query': async (params) => {
    await simulateDelay(50, 200);
    const { query } = params as { query: string; params?: unknown[] };
    
    // Mock query results
    const mockRows = Array.from({ length: Math.floor(Math.random() * 10) + 1 }, (_, i) => ({
      id: i + 1,
      name: `Record ${i + 1}`,
      created_at: new Date(Date.now() - i * 86400000).toISOString(),
    }));
    
    dataStore.addLog({
      level: 'info',
      service: 'postgres',
      action: 'execute_query',
      message: `Executed query: ${query.substring(0, 50)}...`,
      details: { rowCount: mockRows.length },
    });
    
    return { rows: mockRows, rowCount: mockRows.length };
  },
  
  'postgres.insert': async (params) => {
    await simulateDelay(50, 150);
    const { table, data } = params as { table: string; data: Record<string, unknown> };
    
    const id = uuidv4();
    
    dataStore.addLog({
      level: 'info',
      service: 'postgres',
      action: 'insert_record',
      message: `Inserted record into ${table}`,
      details: { table, id },
    });
    
    return { id, success: true };
  },
};

// Helper function to simulate network/processing delay
function simulateDelay(min: number, max: number): Promise<void> {
  const delay = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise(resolve => setTimeout(resolve, delay));
}

// Process an MCP request
export async function processMCPRequest(request: MCPRequest): Promise<MCPResponse> {
  const { id, method, params = {} } = request;
  
  const handler = handlers[method];
  
  if (!handler) {
    const error: MCPError = {
      code: -32601,
      message: `Method not found: ${method}`,
    };
    return { jsonrpc: '2.0', id, error };
  }
  
  try {
    const result = await handler(params);
    return { jsonrpc: '2.0', id, result };
  } catch (err) {
    const error: MCPError = {
      code: -32000,
      message: err instanceof Error ? err.message : 'Unknown error',
    };
    return { jsonrpc: '2.0', id, error };
  }
}

// Execute a single node in a workflow
export async function executeNode(node: DAGNode): Promise<{ result: unknown; error?: string }> {
  const methodMap: Record<string, Record<string, string>> = {
    jira: {
      'create-issue': 'jira.createIssue',
      'get-issues': 'jira.getIssues',
      'update-issue': 'jira.updateIssue',
    },
    slack: {
      'send-message': 'slack.sendMessage',
      'on-message': 'slack.sendMessage', // Triggers simulate by sending
      'get-channels': 'slack.getChannels',
    },
    github: {
      'create-issue': 'github.createIssue',
      'create-pr': 'github.createPullRequest',
      'on-push': 'github.getRepository', // Triggers simulate by getting repo info
      'get-repo': 'github.getRepository',
    },
    postgres: {
      'query': 'postgres.query',
      'insert': 'postgres.insert',
    },
  };
  
  const method = methodMap[node.service]?.[node.operation];
  
  if (!method) {
    return {
      result: null,
      error: `Unknown operation: ${node.service}.${node.operation}`,
    };
  }
  
  const request: MCPRequest = {
    jsonrpc: '2.0',
    id: node.id,
    method,
    params: node.config,
  };
  
  const response = await processMCPRequest(request);
  
  if (response.error) {
    return { result: null, error: response.error.message };
  }
  
  return { result: response.result };
}

// Get list of available MCP methods
export function getAvailableMethods(): { method: string; description: string }[] {
  return [
    { method: 'jira.createIssue', description: 'Create a new Jira issue' },
    { method: 'jira.getIssues', description: 'Query Jira issues with JQL' },
    { method: 'jira.updateIssue', description: 'Update an existing Jira issue' },
    { method: 'slack.sendMessage', description: 'Send a message to a Slack channel' },
    { method: 'slack.getChannels', description: 'List available Slack channels' },
    { method: 'github.createIssue', description: 'Create a GitHub issue' },
    { method: 'github.createPullRequest', description: 'Create a pull request' },
    { method: 'github.getRepository', description: 'Get repository information' },
    { method: 'postgres.query', description: 'Execute a SQL query' },
    { method: 'postgres.insert', description: 'Insert a record into a table' },
  ];
}
