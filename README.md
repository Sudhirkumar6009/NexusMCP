# NexusMCP

Agentic MCP orchestration platform with a Next.js client, an Express API, and Python service modules for planning, execution, and connector runtimes.

This README is based on the current codebase behavior.

## What is implemented today

- Full-stack local app with:
  - Next.js client on port 5000
  - Express API on port 3000
- Authentication:
  - Email/password registration and login
  - Google OAuth login
  - Split Google scopes:
    - /auth/google for basic sign-in (profile/email)
    - /auth/google/gmail for Gmail send consent and refresh token grants
- Gmail send API:
  - POST /api/auth/gmail/send
  - Uses Google OAuth access token (not app JWT) for Gmail API
  - Refreshes access token using stored refresh token when needed
- Integrations module with strict connect-time validation:
  - Jira, Slack, GitHub, Google Sheets, Gmail, AWS
  - Returns connected only when provider ping/validation succeeds
- Workflow and MCP execution APIs with in-memory orchestration state
- Jira gateway bridge from API to Python connector endpoint

## Repository layout

```
NexusMCP/
   apps/
      api/                    # Express + TypeScript backend
      client/                 # Next.js + React + Tailwind frontend
   packages/
      types/                  # Shared TS types
      utils/                  # Shared TS utilities
   services/
      agent-runtime/          # Python DAG executor module
      workflow-engine/        # Python planning + DAG builder module
      mcp-connectors/         # Python connector service (FastAPI server.py)
      context-manager/        # Python execution context module
   infra/
      db/init/                # SQL bootstrap scripts
      docker/                 # Docker Compose definition
```

## Architecture at a glance

1. User signs in from client.
2. Client calls API for auth, workflows, integrations, logs, settings, MCP.
3. Integrations connect endpoint validates credentials against real provider APIs.
4. MCP service can execute mapped methods and routes Jira create issue via gateway endpoint.
5. Gmail send endpoint uses Google OAuth access token + refresh flow.

## Tech stack

- Frontend: Next.js 14, React 18, Tailwind CSS, TypeScript
- Backend: Node.js, Express, TypeScript, Passport, Mongoose
- Python modules/services: FastAPI, Pydantic, httpx, requests, async tooling
- Data:
  - MongoDB for user auth data
  - In-memory datastore for workflows/integrations/logs/sessions/settings/executions in the API layer
- Monorepo: npm workspaces + Turborepo

## Prerequisites

- Node.js 18+
- npm 10+
- Python 3.11+ (for Python services)
- MongoDB instance (local or Atlas) for API auth user model

## Quick start (recommended)

1. Install dependencies at repo root.

```bash
npm install
```

2. Create environment files.

- Copy apps/api/.env.example to apps/api/.env
- Copy apps/client/.env.example to apps/client/.env

3. Start API and client.

Option A (from root, via Turbo):

```bash
npm run dev
```

Option B (separate terminals):

```bash
cd apps/api
npm run dev
```

```bash
cd apps/client
npm run dev
```

4. Open:

- Client: http://localhost:5000
- API: http://localhost:3000
- API docs endpoint: http://localhost:3000/api
- Health: http://localhost:3000/health

## Environment configuration

### API env (apps/api/.env)

Start from apps/api/.env.example and set at least:

```env
PORT=3000
NODE_ENV=development

CLIENT_URL=http://localhost:5000
CLIENT_URLS=http://localhost:5000

MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>/<db>

JWT_SECRET=<strong-random-secret>
JWT_EXPIRES_IN=7d

GOOGLE_CLIENT_ID=<google-oauth-client-id>
GOOGLE_CLIENT_SECRET=<google-oauth-client-secret>
GOOGLE_CALLBACK_URL=http://localhost:3000/auth/google/callback

JIRA_GATEWAY_ENDPOINT=http://localhost:8001/invoke
```

Optional provider envs for integrations validation:

- Jira: JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN
- Slack: SLACK_BOT_TOKEN or SLACK_TOKEN
- GitHub: GITHUB_TOKEN, optional GITHUB_API_URL
- Sheets: GOOGLE_SERVICE_ACCOUNT_JSON and/or GOOGLE_ACCESS_TOKEN / GOOGLE_SHEETS_API_KEY
- Gmail: GMAIL_ACCESS_TOKEN (for integration ping; auth route uses stored user tokens)
- AWS: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN, AWS_REGION

### Client env (apps/client/.env)

```env
NEXT_PUBLIC_API_URL=http://localhost:3000
```

## Authentication and Google OAuth

Routes:

- GET /auth/google
  - Basic Google login scope: profile + email
- GET /auth/google/gmail
  - Gmail send scope + offline consent for refresh token
- GET /auth/google/callback
  - Issues app JWT and redirects client to /auth/callback?token=...

Gmail send flow:

- Endpoint: POST /api/auth/gmail/send
- Requires app JWT for API authorization
- Uses stored Google access token to call Gmail API
- Refreshes via oauth2.googleapis.com/token when expired/401

## API capability summary

Auth:

- POST /api/auth/register
- POST /api/auth/login
- GET /api/auth/me
- PUT /api/auth/me
- POST /api/auth/logout
- POST /api/auth/gmail/send

Workflows:

- CRUD and execute/pause/resume/stop
- POST /api/workflows/generate for prompt-based mocked generation

Integrations:

- List/get/connect/disconnect/test/capabilities
- Strict validation against provider endpoints before marking connected

Logs and settings:

- /api/logs and /api/settings endpoints for operations and configuration

MCP:

- /api/mcp/execute, /api/mcp/execute-node, /api/mcp/methods, /api/mcp/batch, /api/mcp/stream

## Python services status

The services directory contains working modules and partial runtime scaffolding.

- services/mcp-connectors contains a runnable FastAPI server at src/server.py.
  - It currently exposes a minimal /invoke route focused on Jira issue creation.
- services/workflow-engine, services/agent-runtime, services/context-manager contain planner/executor/context modules and pyproject definitions.

Example run for connector service:

```bash
cd services/mcp-connectors
python -m uvicorn src.server:app --reload --port 8001
```

## Build and lint

Root:

```bash
npm run build
npm run lint
```

Per app:

```bash
cd apps/api && npm run build
cd apps/client && npm run build
```

## Known limitations and notes

- API workflow/integration/log/settings execution state is in-memory right now.
- Docker Compose exists but references Dockerfiles that are not present in this repo at the moment.
- Root scripts dev:client and dev:api may require alignment with workspace package names if you rely on those aliases.
- Keep secrets out of git. Do not commit real tokens, OAuth client secrets, or cloud credentials.

## Troubleshooting

Google access_denied (test mode):

- Add your Google account under OAuth consent screen test users in Google Cloud Console.
- Use /auth/google for normal login and /auth/google/gmail only when granting Gmail send scope.

redirect_uri_mismatch:

- Ensure GOOGLE_CALLBACK_URL exactly matches the URI configured in Google credentials.
- Typical local callback: http://localhost:3000/auth/google/callback

CORS errors:

- Set CLIENT_URL / CLIENT_URLS to include your client origin (default http://localhost:5000).

Port already in use:

- Client default is 5000, API default is 3000. Stop stale processes or change env ports.

## License

MIT
