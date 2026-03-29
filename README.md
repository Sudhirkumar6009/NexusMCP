# NexusMCP

**Agentic MCP Gateway** - LLM-powered workflow orchestration with Model Context Protocol integration.

## Architecture

```
NexusMCP/
├── apps/
│   ├── client/              # Next.js UI (React, Tailwind, TypeScript)
│   └── api/                 # Node.js backend (Express, Auth, HITL, Logs)
│
├── services/
│   ├── agent-runtime/       # Python - DAG execution engine
│   ├── workflow-engine/     # Python - LLM planning → DAG generation
│   ├── mcp-connectors/      # Python - MCP tool connectors (Jira, Slack, GitHub, etc.)
│   └── context-manager/     # Python - State, memory, payload handling
│
├── packages/
│   ├── types/               # Shared TypeScript types
│   └── utils/               # Shared utilities
│
├── infra/
│   ├── docker/              # Docker Compose configuration
│   └── db/                  # Database migrations and seeds
│
└── README.md
```

## Features

- **LLM-Powered Workflow Planning**: Natural language to executable DAG
- **Visual DAG Editor**: Interactive workflow visualization with step-by-step execution
- **MCP Integration**: Connect to external tools via Model Context Protocol
- **Human-in-the-Loop**: Approval gates for sensitive operations
- **Parallel Execution**: Automatic parallelization of independent steps
- **Retry & Error Handling**: Built-in resilience with configurable retries
- **Real-time Updates**: Live execution monitoring with JSON-RPC terminal

## Services

### Agent Runtime (`services/agent-runtime`)

Core DAG execution engine that:

- Receives compiled DAGs from workflow-engine
- Manages parallel execution of nodes
- Handles retries, timeouts, and error propagation
- Coordinates with context-manager for state

### Workflow Engine (`services/workflow-engine`)

LLM-powered workflow planning:

- Accepts natural language prompts
- Uses LLM to decompose into tool calls
- Generates executable DAG structures
- Validates against available MCP tools

### MCP Connectors (`services/mcp-connectors`)

MCP-compliant tool implementations:

- **Jira**: Issues, projects, transitions
- **Slack**: Messages, channels, reactions
- **GitHub**: Repos, branches, PRs, actions
- **Google Sheets**: Read, write, append
- **PostgreSQL**: Queries, transactions

### Context Manager (`services/context-manager`)

Workflow execution context:

- State persistence between steps
- Payload transformation and routing
- Memory/history for agent reasoning
- Variable resolution (`{{step.field}}` syntax)

## Quick Start

### Prerequisites

- Node.js 18+
- Python 3.11+
- Docker & Docker Compose
- pnpm or npm

### Development

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Start infrastructure**

   ```bash
   npm run docker:up
   ```

3. **Start development servers**

   ```bash
   npm run dev
   ```

4. **Access the app**
   - Client: http://localhost:5000
   - API: http://localhost:3000

### Docker Deployment

```bash
# Build and start all services
docker-compose -f infra/docker/docker-compose.yml up -d

# View logs
docker-compose -f infra/docker/docker-compose.yml logs -f

# Stop services
docker-compose -f infra/docker/docker-compose.yml down
```

## Environment Variables

Create `.env` files in each app/service directory:

### API (`apps/api/.env`)

```env
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://nexusmcp:nexusmcp_dev@localhost:5432/nexusmcp
REDIS_URL=redis://localhost:6379
JWT_SECRET=your-secret-key
```

### Python Services

```env
REDIS_URL=redis://localhost:6379
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
JIRA_URL=https://your-org.atlassian.net
JIRA_TOKEN=...
SLACK_TOKEN=xoxb-...
GITHUB_TOKEN=ghp_...
```

## Tech Stack

| Layer    | Technology                                     |
| -------- | ---------------------------------------------- |
| Frontend | Next.js 14, React 18, Tailwind CSS, TypeScript |
| Backend  | Node.js, Express, TypeScript                   |
| Services | Python 3.11, FastAPI, Pydantic                 |
| Database | PostgreSQL 16, Redis 7                         |
| Infra    | Docker, Docker Compose                         |
| Monorepo | Turborepo, npm workspaces                      |

## License

MIT
