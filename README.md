# AI Support Triage & Resilient Ops Engine (`ai-support-triage`)

An enterprise-grade, event-driven triage and escalation architecture built with **n8n**, **PostgreSQL (pgvector)**, and **Playwright**. Designed for mission-critical customer operations to automate Tier-1 ticket resolution, eliminate duplicate processing via distributed idempotency, route high-severity incidents, and ensure zero-trust security.

---

## What is This & Why Does It Matter?

In high-volume B2B and SaaS environments, support teams face three major operational bottlenecks:
1. **Tier-1 Ticket Saturation**: Repetitive inquiries (password resets, billing FAQ) consume 40-60% of human agent bandwidth.
2. **Distributed Double-Processing**: Webhook retries from CRMs, payment gateways, or network hiccups cause duplicate ticket entries, repeated alerts, and customer confusion.
3. **P1 Outage Delays**: Critical incident reports get buried in standard queues rather than immediately paging security/operations teams.

This engine solves these issues with:
- **Instant Autonomous Resolution**: Tier-1 tickets receive automated contextual guidance immediately.
- **Strict Atomic Idempotency**: Guarantees exactly-once processing semantics (`ON CONFLICT` database constraints) even under aggressive network retries.
- **Zero-Trust Security**: Header token verification and 100% parameterized queries eliminate SQL injection vectors.
- **Fail-Safe Observability**: A dedicated Dead Letter Queue (DLQ) captures any unhandled workflow exception for audit and replay.

---

## Architecture

```mermaid
flowchart TD
    Client["Client / CRM / Inbound Webhook"] -->|POST /webhook/support-ticket| AuthNode["Security & Auth Validator<br/>(Token + Schema Check)"]
    
    AuthNode -->|Invalid (401/400)| ErrResp["Error Response (401 / 400)"]
    AuthNode -->|Valid| IdempCheck{"Check Idempotency<br/>(PostgreSQL)"}
    
    IdempCheck -->|Duplicate Key| DupResp["Return Cached Status (200 OK)"]
    IdempCheck -->|New Request| AIRouter["Triage & Sentiment Router<br/>(Categorization Engine)"]
    
    AIRouter --> RouteChoice{"Assigned Tier"}
    RouteChoice -->|Tier 1 Bot| BotAction["Automated Knowledge Base Resolution<br/>(Instant Auto-reply)"]
    RouteChoice -->|Tier 2 Human| HumanQueue["Escalate to Human Queue<br/>(Billing / Complex)"]
    RouteChoice -->|Security Escalation| SecPaging["P1 Incident Alerting & Paging<br/>(Security / Outage)"]
    
    BotAction --> Persist["Persist to app_triage.tickets<br/>(Atomic ON CONFLICT)"]
    HumanQueue --> Persist
    SecPaging --> Persist
    
    Persist --> SuccessResp["Webhook Response (201 Created)"]
    
    subgraph Observability & Resilience
        GlobalError["Unhandled Exception"] --> DLQ["Dead Letter Queue (DLQ)<br/>app_triage.dead_letter_queue"]
    end
```

---

## Quickstart: How to Run the Project

### Prerequisites
- [Docker](https://docs.docker.com/get-docker/) & Docker Compose installed.
- [Node.js](https://nodejs.org/) v20+ (for running Playwright test suites).

### 1. Clone & Configure Environment
```bash
git clone https://github.com/Jundev66/ai-support-triage-engine.git
cd ai-support-triage-engine
cp .env.example .env
```

Review `.env` if you need custom ports or custom webhook tokens.

### 2. Launch Services (Docker Compose)
```bash
docker compose up -d
```

This starts:
- **n8n Workflow Engine**: Running on [http://localhost:5678](http://localhost:5678)
- **PostgreSQL 16 + pgvector**: Running on `127.0.0.1:5432` with pre-initialized schemas (`n8n_system` & `app_triage`), HNSW vector index, and seeded knowledge base entries.

### 3. Import & Activate Workflows
Import credentials and workflows into the container and refresh the webhook router:
```bash
# 1. Import database credentials
docker exec triage_n8n n8n import:credentials --input=/workflows/../credentials/postgres_credential.example.json

# 2. Import workflows
docker exec triage_n8n n8n import:workflow --input=/workflows/error_handler_dlq.json
docker exec triage_n8n n8n import:workflow --input=/workflows/ai_support_triage_flow.json

# 3. Publish workflows and restart n8n to register webhook endpoints in memory
docker exec triage_n8n n8n publish:workflow --id=ai_support_triage_flow || true
docker exec triage_n8n n8n publish:workflow --id=error_handler_dlq || true
docker compose restart n8n
```

Or manage workflows programmatically via the idempotent Node.js REST API script:
```bash
npm install
node scripts/import-workflows.js
```

---

## How to Use It (Step-by-Step API Examples)

The engine exposes a single entrypoint at:
`POST http://localhost:5678/webhook/support-ticket`

Header required: `x-webhook-token: secure_triage_webhook_bearer_token_xyz123`

### Scenario 1: Tier-1 Automated Resolution (Password Reset)
Sends an authentication issue ticket. The engine classifies it as `tier_1_bot`, provides the recovery solution, and marks it as `resolved`.

```bash
curl -X POST http://localhost:5678/webhook/support-ticket \
  -H "Content-Type: application/json" \
  -H "x-webhook-token: secure_triage_webhook_bearer_token_xyz123" \
  -d '{
    "idempotency_key": "ticket-auth-001",
    "customer_id": "cust-101",
    "customer_email": "user@enterprise.com",
    "subject": "Need help resetting my corporate password",
    "content": "I got locked out of my corporate login credentials after 3 attempts."
  }'
```

**Expected Response (HTTP 201 Created):**
```json
{
  "success": true,
  "ticket": {
    "id": "7f8b9c2a-...",
    "category": "auth",
    "urgency": "normal",
    "assigned_tier": "tier_1_bot",
    "resolution_status": "resolved",
    "automated_response": "You can reset your corporate credentials at https://app.example.com/forgot-password. A 15-minute OTP has been initiated."
  }
}
```

---

### Scenario 2: Billing Issue Escalated to Human Queue (Tier 2)
Sends an invoice discrepancy ticket. The engine routes it to human operators.

```bash
curl -X POST http://localhost:5678/webhook/support-ticket \
  -H "Content-Type: application/json" \
  -H "x-webhook-token: secure_triage_webhook_bearer_token_xyz123" \
  -d '{
    "idempotency_key": "ticket-bill-002",
    "customer_id": "cust-202",
    "customer_email": "billing@client.com",
    "subject": "Discrepancy in monthly billing invoice",
    "content": "We noticed an unexpected charge on our enterprise invoice for this month."
  }'
```

**Expected Response (HTTP 201 Created):**
```json
{
  "success": true,
  "ticket": {
    "id": "a1b2c3d4-...",
    "category": "billing",
    "urgency": "high",
    "assigned_tier": "tier_2_human",
    "resolution_status": "pending_human",
    "automated_response": null
  }
}
```

---

### Scenario 3: P1 Incident & Security Escalation
Sends a suspected data breach or production outage report. The engine triggers a critical security escalation.

```bash
curl -X POST http://localhost:5678/webhook/support-ticket \
  -H "Content-Type: application/json" \
  -H "x-webhook-token: secure_triage_webhook_bearer_token_xyz123" \
  -d '{
    "idempotency_key": "ticket-sec-003",
    "customer_id": "cust-sec-999",
    "customer_email": "cto@partner.io",
    "subject": "URGENT: Production database service outage and suspected exploit breach",
    "content": "We detected suspicious exfiltration attempts and our production cluster is down."
  }'
```

**Expected Response (HTTP 201 Created):**
```json
{
  "success": true,
  "ticket": {
    "category": "incident",
    "urgency": "critical",
    "assigned_tier": "security_escalation",
    "resolution_status": "pending_human"
  }
}
```

---

### Scenario 4: Idempotency Protection Against Retries
If the client or CRM resends the exact same request (`idempotency_key: "ticket-auth-001"`):

```bash
curl -X POST http://localhost:5678/webhook/support-ticket \
  -H "Content-Type: application/json" \
  -H "x-webhook-token: secure_triage_webhook_bearer_token_xyz123" \
  -d '{
    "idempotency_key": "ticket-auth-001",
    "customer_id": "cust-101",
    "customer_email": "user@enterprise.com",
    "subject": "Need help resetting my corporate password",
    "content": "I got locked out of my corporate login credentials after 3 attempts."
  }'
```

**Expected Response (HTTP 200 OK):**
```json
{
  "status": "idempotent_duplicate",
  "ticket_id": "7f8b9c2a-...",
  "resolution_status": "resolved",
  "assigned_tier": "tier_1_bot"
}
```
*No duplicate ticket is created, no duplicate alert is triggered, and response is returned in sub-10ms.*

---

### Scenario 5: Security Enforcement (401 Unauthorized)
Any request missing or providing an incorrect token is rejected immediately:

```bash
curl -X POST http://localhost:5678/webhook/support-ticket \
  -H "Content-Type: application/json" \
  -d '{"content": "unauthorized attempt"}'
```

**Expected Response (HTTP 401 Unauthorized):**
```json
{
  "error": "Unauthorized: Invalid or missing webhook security token."
}
```

---

## Verifying in PostgreSQL

To directly inspect the tickets and audit state in PostgreSQL:
```bash
docker exec -it triage_postgres psql -U postgres -d n8n_triage -c \
  "SELECT id, idempotency_key, category, urgency, assigned_tier, resolution_status FROM app_triage.tickets;"
```

To inspect the Dead Letter Queue:
```bash
docker exec -it triage_postgres psql -U postgres -d n8n_triage -c \
  "SELECT id, workflow_id, error_message, error_node, created_at FROM app_triage.dead_letter_queue;"
```

---

## Automated Verification (Playwright Tests)

The repository includes a comprehensive Playwright test harness testing security, schema validation, idempotency, and SQL injection immunity.

```bash
# Install dependencies
npm install

# Run the complete test suite
npm test

# Run API/Security integration tests only
npm run test:api

# Run UI E2E tests
npm run test:e2e
```

### Continuous Integration (CI)
Every commit and Pull Request runs in a clean GitHub Actions runner with Docker Compose and Playwright via [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

---

## Project Structure

```text
ai-support-triage/
├── .github/workflows/ci.yml        # Automated CI workflow (Docker + Playwright)
├── credentials/
│   └── postgres_credential.example.json # Sanitized database credential template
├── docker-compose.yml              # n8n + PostgreSQL (pgvector) container stack
├── .env.example                    # Environment secrets configuration template
├── .gitignore                      # Git exclusion rules
├── package.json                    # Playwright test harness & scripts
├── playwright.config.ts            # Playwright runner configuration
├── sql/
│   ├── init.sql                    # Schemas, tables, vector index & synthetic embedding func
│   └── seed.sql                    # Seeded knowledge base articles with 1536-dim embeddings
├── workflows/
│   ├── ai_support_triage_flow.json # Parametrized core triage & atomic idempotency workflow
│   └── error_handler_dlq.json      # Resilient Dead Letter Queue error handler
├── scripts/
│   └── import-workflows.js         # Idempotent workflow import & update utility
└── tests/
    ├── api/
    │   └── webhook.spec.ts         # Security, schema, SQLi, and idempotency tests
    └── e2e/
        └── n8n-dashboard.spec.ts   # Browser health and readiness tests
```

---

## License
MIT
