# Webhook Infrastructure Setup (Ngrok + Event Routing)

## Folder Structure

```text
apps/api/
  src/
    routes/
      webhooks.ts
    services/
      webhook-normalizer.ts
      webhook-security.ts
      webhook-queue.ts
      workflow-trigger.ts
    types/
      webhook.ts
    index.ts
  .env.example
```

## 1) Start API on Port 5000

```powershell
Set-Location "d:\Projects\NexusMCP\apps\api"
$env:PORT="5000"
npm run dev
```

## 2) Start Ngrok on Port 5000

```powershell
ngrok http 5000
```

## 3) Get Ngrok Public URL

```powershell
curl http://127.0.0.1:4040/api/tunnels
```

Use the `public_url` value (HTTPS), for example:

```text
https://abc123.ngrok.io
```

Make sure `NGROK_URL` has no trailing slash.

Webhook endpoints:

```text
https://abc123.ngrok.io/api/webhook/github
https://abc123.ngrok.io/api/webhook/jira
https://abc123.ngrok.io/api/webhook/slack
```

## 4) Environment Variables

Add to `apps/api/.env`:

```env
PORT=5000
WEBHOOK_SHARED_TOKEN=change-me-shared-webhook-token
GITHUB_WEBHOOK_SECRET=change-me-github-secret
AGENTIC_SERVICE_URL=http://localhost:8010
AGENTIC_SERVICE_TIMEOUT_MS=30000
WEBHOOK_QUEUE_POLL_INTERVAL_MS=250
WEBHOOK_IDEMPOTENCY_TTL_MS=3600000
WEBHOOK_ALWAYS_ON_PREDEFINED_WORKFLOWS=true
WEBHOOK_USE_AGENTIC_PLANNER=false
```

## 5) Example Webhook Payloads

### GitHub Push

```json
{
  "ref": "refs/heads/main",
  "before": "4f6d9f2",
  "after": "90acb33",
  "repository": {
    "name": "nexusmcp",
    "full_name": "org/nexusmcp"
  },
  "pusher": {
    "name": "sudhir"
  },
  "sender": {
    "login": "sudhir"
  }
}
```

### Jira Issue Created

```json
{
  "webhookEvent": "jira:issue_created",
  "timestamp": 1712345678901,
  "issue": {
    "id": "10001",
    "key": "KAN-23",
    "fields": {
      "summary": "Checkout page fails on coupon apply",
      "description": "Error 500 when coupon contains whitespace",
      "status": {
        "name": "To Do"
      },
      "project": {
        "key": "KAN"
      }
    }
  },
  "user": {
    "displayName": "Release Bot"
  }
}
```

### Slack Message Event

```json
{
  "type": "event_callback",
  "team_id": "T123456",
  "event": {
    "type": "message",
    "user": "U123456",
    "channel": "C123456",
    "text": "create bug for checkout timeout",
    "ts": "1712345678.000100"
  }
}
```

## 6) Curl Tests

### GitHub Webhook

```powershell
curl -X POST "http://localhost:5000/api/webhook/github" ^
  -H "Content-Type: application/json" ^
  -H "x-webhook-token: change-me-shared-webhook-token" ^
  -H "x-github-event: push" ^
  -H "x-github-delivery: gh-delivery-001" ^
  -H "x-hub-signature-256: sha256=placeholder" ^
  -d "{\"ref\":\"refs/heads/main\",\"repository\":{\"full_name\":\"org/nexusmcp\"},\"sender\":{\"login\":\"sudhir\"}}"
```

### Jira Webhook

```powershell
curl -X POST "http://localhost:5000/api/webhook/jira" ^
  -H "Content-Type: application/json" ^
  -H "x-webhook-token: change-me-shared-webhook-token" ^
  -H "x-atlassian-webhook-identifier: jira-evt-001" ^
  -d "{\"webhookEvent\":\"jira:issue_created\",\"issue\":{\"id\":\"10001\",\"key\":\"KAN-23\",\"fields\":{\"summary\":\"Checkout bug\",\"status\":{\"name\":\"To Do\"}}}}"
```

### Slack Webhook

```powershell
curl -X POST "http://localhost:5000/api/webhook/slack" ^
  -H "Content-Type: application/json" ^
  -H "x-webhook-token: change-me-shared-webhook-token" ^
  -H "x-slack-signature: v0=placeholder" ^
  -H "x-slack-request-timestamp: 1712345678" ^
  -d "{\"type\":\"event_callback\",\"team_id\":\"T123456\",\"event\":{\"type\":\"message\",\"user\":\"U1\",\"channel\":\"C1\",\"text\":\"create bug\"}}"
```
