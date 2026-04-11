<div align="center">

# NexusMCP

**Agentic MCP Orchestration Platform**

_Transform natural language into automated multi-service workflows_

[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Python](https://img.shields.io/badge/Python-3.11+-3776AB?logo=python&logoColor=white)](https://python.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-3178C6?logo=typescript&logoColor=white)](https://typescriptlang.org/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[Features](#features) | [Quick Start](#quick-start) | [Architecture](#architecture) | [API Reference](#api-reference) | [Contributing](#contributing)

</div>

---

## Overview

NexusMCP is a full-stack **AI-powered workflow orchestration platform** that leverages the Model Context Protocol (MCP) to connect and automate tasks across multiple third-party services. Users describe workflows in natural language, and the platform generates executable DAG (Directed Acyclic Graph) structures that coordinate actions across Jira, Slack, GitHub, Google Sheets, Gmail, and PostgreSQL.

### What Makes NexusMCP Different?

- **Natural Language to DAG**: Describe your workflow in plain English, get an executable automation
- **MCP Protocol Native**: Built on JSON-RPC 2.0 for standardized tool invocation
- **Human-in-the-Loop**: Approval gates for sensitive operations
- **Real-time Orchestration**: Parallel execution with dependency resolution
- **Enterprise Integrations**: Pre-built connectors for popular services

---

## Features

### Core Capabilities

| Feature                         | Description                                                                                                             |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Workflow Generation**         | Convert prompts like "When a bug is created in Jira, create a GitHub branch and notify Slack" into executable workflows |
| **Visual DAG Editor**           | Interactive node-based workflow builder with real-time execution monitoring                                             |
| **Multi-Service Orchestration** | Coordinate actions across 7+ integrated services                                                                        |
| **Parallel Execution**          | Independent nodes execute concurrently with automatic dependency resolution                                             |
| **Retry & Error Handling**      | Configurable retry logic with exponential backoff                                                                       |
| **Approval Gates**              | Pause workflows for human review before sensitive operations                                                            |
| **Audit Logging**               | Comprehensive logging with filtering by level, service, and time                                                        |

### Supported Integrations

| Service           | Capabilities                     |
| ----------------- | -------------------------------- |
| **Jira**          | Create, update, and query issues |
| **Slack**         | Send messages, manage channels   |
| **GitHub**        | Create issues, PRs, branches     |
| **Google Sheets** | Read and append data             |
| **Gmail**         | Send emails via OAuth            |
| **PostgreSQL**    | Query and insert operations      |

---

## Architecture

```
                        ┌─────────────────────────┐
                        │       Next.js 14        │
                        │    React + Tailwind     │  Port 5000
                        │    Visual Dashboard     │
                        └───────────┬─────────────┘
                                    │
                        ┌───────────▼─────────────┐
                        │     Express + TS        │
                        │    REST API + Auth      │  Port 3000
                        │   Passport + JWT        │
                        └───────────┬─────────────┘
                                    │
        ┌───────────────┬───────────┼───────────────┬───────────────┐
        │               │           │               │               │
        ▼               ▼           ▼               ▼               ▼
┌───────────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐
│   Workflow    │ │   Agent   │ │    MCP    │ │  Context  │ │   Data    │
│    Engine     │ │  Runtime  │ │ Connectors│ │  Manager  │ │   Layer   │
│   (Python)    │ │  (Python) │ │  (Python) │ │  (Python) │ │           │
│   FastAPI     │ │   DAG     │ │  FastAPI  │ │   Redis   │ │ PostgreSQL│
│   +OpenAI     │ │ Executor  │ │  Gateway  │ │   State   │ │  MongoDB  │
└───────────────┘ └───────────┘ └───────────┘ └───────────┘ └───────────┘
      │                 │             │             │
      └─────────────────┴──────┬──────┴─────────────┘
                               │
                    ┌──────────▼──────────┐
                    │   External APIs     │
                    │ Jira, Slack, GitHub │
                    │    Sheets, Gmail    │
                    └─────────────────────┘
```

### Design Principles

1. **Monorepo Structure**: npm workspaces + Turborepo for unified builds
2. **Polyglot Microservices**: Node.js API + Python AI/execution services
3. **MCP Protocol**: Standardized JSON-RPC 2.0 tool invocation
4. **DAG Execution**: Topological sorting for dependency resolution

---

## Repository Structure

```
NexusMCP/
├── apps/
│   ├── api/                     # Express + TypeScript backend
│   │   ├── src/
│   │   │   ├── config/          # Database, JWT, Passport config
│   │   │   ├── middleware/      # Auth, logging, error handling
│   │   │   ├── routes/          # API route handlers
│   │   │   ├── services/        # MCP service layer
│   │   │   └── types/           # TypeScript definitions
│   │   └── package.json
│   │
│   └── client/                  # Next.js 14 + React + Tailwind
│       ├── src/
│       │   ├── app/             # Next.js App Router
│       │   ├── components/      # React components
│       │   ├── context/         # Auth, Workflow, Theme providers
│       │   ├── hooks/           # Custom React hooks
│       │   └── lib/             # API client, utilities
│       └── package.json
│
├── packages/
│   ├── types/                   # Shared TypeScript types
│   └── utils/                   # Shared utilities (cn, debounce, etc.)
│
├── services/
│   ├── workflow-engine/         # LLM-powered planner + DAG builder
│   ├── agent-runtime/           # DAG executor with parallel processing
│   ├── mcp-connectors/          # FastAPI connector gateway
│   └── context-manager/         # Execution state management
│
├── infra/
│   ├── db/init/                 # PostgreSQL schema scripts
│   └── docker/                  # Docker Compose configuration
│
├── package.json                 # Root workspace configuration
└── turbo.json                   # Turborepo pipeline
```

---

## Tech Stack

### Frontend

| Technology   | Version | Purpose                         |
| ------------ | ------- | ------------------------------- |
| Next.js      | 14.2    | React framework with App Router |
| React        | 18.3    | UI library                      |
| TypeScript   | 5.6     | Type safety                     |
| Tailwind CSS | 3.4     | Utility-first styling           |
| Lucide React | 0.453   | Icon library                    |

### Backend API

| Technology   | Version | Purpose                   |
| ------------ | ------- | ------------------------- |
| Express      | 4.21    | Web framework             |
| TypeScript   | 5.4     | Type safety               |
| Passport     | 0.7     | Authentication strategies |
| Mongoose     | 8.9     | MongoDB ODM               |
| Zod          | 3.23    | Schema validation         |
| jsonwebtoken | 9.0     | JWT handling              |

### Python Services

| Technology | Version | Purpose           |
| ---------- | ------- | ----------------- |
| FastAPI    | 0.109+  | Web framework     |
| Pydantic   | 2.5+    | Data validation   |
| httpx      | 0.26+   | Async HTTP client |
| jira       | 3.5+    | Jira API client   |
| slack-sdk  | 3.26+   | Slack API client  |
| PyGithub   | 2.1+    | GitHub API client |

### Infrastructure

| Technology | Version | Purpose             |
| ---------- | ------- | ------------------- |
| PostgreSQL | 16      | Primary database    |
| MongoDB    | -       | User authentication |
| Redis      | 7       | Caching & state     |
| Docker     | 3.8     | Containerization    |
| Turborepo  | 1.11    | Monorepo builds     |

---

## Quick Start

### Prerequisites

- **Node.js** 18+ and npm 10+
- **Python** 3.11+ (for Python services)
- **MongoDB** instance (local or Atlas)

### Installation

```bash
# Clone the repository
git clone https://github.com/your-org/nexusmcp.git
cd nexusmcp

# Install all dependencies
npm install
```

### Configuration

1. **API Environment** (`apps/api/.env`):

```bash
cp apps/api/.env.example apps/api/.env
```

```env
# Server
PORT=3000
NODE_ENV=development
CLIENT_URL=http://localhost:5000

# Database
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>/<db>

# Authentication
JWT_SECRET=your-secure-random-secret
JWT_EXPIRES_IN=7d
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_CALLBACK_URL=http://localhost:3000/auth/google/callback

# MCP Gateway
JIRA_GATEWAY_ENDPOINT=http://localhost:8001/invoke
```

2. **Client Environment** (`apps/client/.env`):

```bash
cp apps/client/.env.example apps/client/.env
```

```env
NEXT_PUBLIC_API_URL=http://localhost:3000/api
```

### Running the Application

**Option A: Using Turborepo (Recommended)**

```bash
# Start both API and client
npm run dev
```

**Option B: Separate Terminals**

```bash
# Terminal 1: API
cd apps/api && npm run dev

# Terminal 2: Client
cd apps/client && npm run dev
```

**Option C: Start Python MCP Connector**

```bash
cd services/mcp-connectors
pip install -e .
python -m uvicorn src.server:app --reload --port 8001
```

**Option D: Unified Python Services Environment (Windows PowerShell)**

```bash
# From repository root
npm run setup:py-services

# Set GEMINI_API_KEY in services/agentic/.env, then start agentic service
npm run dev:agentic
```

This prepares one shared Python virtual environment for all folders under `services/` and runs the Agentic service on port `8010`, which is consumed by backend route `POST /api/workflows/agentic-flow`.

### Access Points

| Service          | URL                          |
| ---------------- | ---------------------------- |
| Client Dashboard | http://localhost:5000        |
| API Server       | http://localhost:3000        |
| Agentic Service  | http://localhost:8010        |
| Health Check     | http://localhost:3000/health |
| MCP Connector    | http://localhost:8001        |

---

## API Reference

### Authentication

| Method | Endpoint               | Description            |
| ------ | ---------------------- | ---------------------- |
| `POST` | `/api/auth/register`   | Register new user      |
| `POST` | `/api/auth/login`      | Login with credentials |
| `GET`  | `/api/auth/me`         | Get current user       |
| `PUT`  | `/api/auth/me`         | Update profile         |
| `POST` | `/api/auth/logout`     | Logout                 |
| `POST` | `/api/auth/gmail/send` | Send email via Gmail   |
| `GET`  | `/auth/google`         | Initiate Google OAuth  |
| `GET`  | `/auth/google/gmail`   | Request Gmail scope    |

### Workflows

| Method   | Endpoint                      | Description                              |
| -------- | ----------------------------- | ---------------------------------------- |
| `GET`    | `/api/workflows`              | List all workflows                       |
| `GET`    | `/api/workflows/:id`          | Get single workflow                      |
| `POST`   | `/api/workflows`              | Create workflow                          |
| `PUT`    | `/api/workflows/:id`          | Update workflow                          |
| `DELETE` | `/api/workflows/:id`          | Delete workflow                          |
| `POST`   | `/api/workflows/:id/execute`  | Execute workflow                         |
| `POST`   | `/api/workflows/:id/pause`    | Pause execution                          |
| `POST`   | `/api/workflows/:id/resume`   | Resume execution                         |
| `POST`   | `/api/workflows/:id/stop`     | Stop execution                           |
| `POST`   | `/api/workflows/generate`     | Generate from prompt                     |
| `POST`   | `/api/workflows/agentic-flow` | Generate Gemini-backed agentic flow plan |

### Integrations

| Method | Endpoint                             | Description             |
| ------ | ------------------------------------ | ----------------------- |
| `GET`  | `/api/integrations`                  | List all integrations   |
| `POST` | `/api/integrations/:id/connect`      | Connect with validation |
| `POST` | `/api/integrations/:id/disconnect`   | Disconnect integration  |
| `POST` | `/api/integrations/:id/test`         | Test connection         |
| `GET`  | `/api/integrations/:id/capabilities` | Get capabilities        |

### MCP Execution

| Method | Endpoint                | Description            |
| ------ | ----------------------- | ---------------------- |
| `POST` | `/api/mcp/execute`      | Execute MCP request    |
| `POST` | `/api/mcp/execute-node` | Execute workflow node  |
| `GET`  | `/api/mcp/methods`      | List available methods |
| `POST` | `/api/mcp/batch`        | Batch MCP requests     |
| `POST` | `/api/mcp/stream`       | Stream execution       |

### System

| Method | Endpoint        | Description      |
| ------ | --------------- | ---------------- |
| `GET`  | `/api/logs`     | Query audit logs |
| `GET`  | `/api/settings` | Get app settings |
| `PUT`  | `/api/settings` | Update settings  |

---

## Integration Configuration

### Provider Environment Variables

```env
# Jira
JIRA_BASE_URL=https://company.atlassian.net
JIRA_EMAIL=user@example.com
JIRA_API_TOKEN=your-api-token

# Slack
SLACK_BOT_TOKEN=xoxb-your-bot-token

# GitHub
GITHUB_TOKEN=ghp_your-personal-access-token

# Google Sheets
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}

# Gmail (OAuth-based, tokens stored per user)
# Configured via /auth/google/gmail flow

```

---

## Docker Deployment

```bash
# Start full stack
npm run docker:up

# View logs
npm run docker:logs

# Stop services
npm run docker:down
```

### Services

| Container                | Port | Description         |
| ------------------------ | ---- | ------------------- |
| nexusmcp-client          | 5000 | Next.js frontend    |
| nexusmcp-api             | 3000 | Express API         |
| nexusmcp-postgres        | 5432 | PostgreSQL database |
| nexusmcp-redis           | 6379 | Redis cache         |
| nexusmcp-agent-runtime   | 8001 | DAG executor        |
| nexusmcp-workflow-engine | 8002 | LLM planner         |
| nexusmcp-mcp-connectors  | 8003 | Connector gateway   |
| nexusmcp-context-manager | 8004 | State manager       |

---

## Build & Development

```bash
# Build all packages
npm run build

# Build only shared packages
npm run build:packages

# Lint all packages
npm run lint

# Run tests
npm run test

# Clean all build artifacts
npm run clean
```

### Python Services

```bash
cd services/mcp-connectors

# Install in development mode
pip install -e ".[dev]"

# Run with hot reload
python -m uvicorn src.server:app --reload --port 8001

# Format code
black src/

# Lint
ruff check src/
```

---

## Troubleshooting

### Common Issues

**Google OAuth "access_denied" in test mode**

- Add your Google account under OAuth consent screen > Test users in Google Cloud Console

**"redirect_uri_mismatch" error**

- Ensure `GOOGLE_CALLBACK_URL` exactly matches the URI in Google credentials
- Default: `http://localhost:3000/auth/google/callback`

**CORS errors**

- Verify `CLIENT_URL` in API `.env` matches your client origin
- Default: `http://localhost:5000`

**Port already in use**

- Kill existing processes: `lsof -ti:3000 | xargs kill` (Unix) or use Task Manager (Windows)
- Or change ports in respective `.env` files

**MongoDB connection failed**

- Verify `MONGODB_URI` connection string
- Check IP whitelist in MongoDB Atlas

---

## Known Limitations

- **In-Memory State**: Workflow/integration state is in-memory (PostgreSQL schema exists for future persistence)
- **Docker Images**: Compose references Dockerfiles not yet present in repo
- **WebSocket**: Real-time updates use polling (WebSocket planned)
- **LLM Integration**: Workflow generation supports mock mode for development

---

## Roadmap

- [ ] Persistent workflow state in PostgreSQL
- [ ] WebSocket real-time updates
- [ ] Visual DAG editor enhancements
- [ ] Additional connectors (Linear, Notion, Airtable)
- [ ] Workflow versioning and rollback
- [ ] Role-based access control (RBAC)
- [ ] Scheduled workflow execution
- [ ] Workflow templates marketplace

---

## Contributing

Contributions are welcome! Please read our contributing guidelines before submitting PRs.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## Security

- Never commit secrets, tokens, or credentials to the repository
- Use environment variables for all sensitive configuration
- Report security vulnerabilities privately to the maintainers

---

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

<div align="center">

**Built with purpose. Orchestrated with precision.**

[Report Bug](https://github.com/your-org/nexusmcp/issues) | [Request Feature](https://github.com/your-org/nexusmcp/issues)

</div>
