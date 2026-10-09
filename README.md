# WhistleDrop

A **privacy-preserving, anonymous whistleblowing and confidential reporting REST API** built with Node.js, Express.js, and PostgreSQL.

WhistleDrop allows individuals to submit reports without creating an account or providing any identifying information. Moderators can securely review and manage reports, while reporters can track their submission progress using a unique case code.

> **Privacy disclaimer**: WhistleDrop is privacy-preserving at the application level — it does not collect reporter names, email addresses, phone numbers, or account credentials. However, application-level privacy **does not provide anonymity against hosting providers, reverse proxies, network operators, or infrastructure-level connection logs**. Your ISP, cloud host, or network operator may still record TCP/IP connection metadata.

---

## Features

- **Anonymous reporting** — No account, name, email, or identity required
- **Cryptographic case codes** — 80-bit entropy codes using the unambiguous Base32 variant alphabet
- **Secure case code storage** — Only an HMAC-SHA256 hash of the code is stored; the raw code is returned once and never persisted
- **Report status workflow** — `SUBMITTED → UNDER_REVIEW → RESOLVED / DISMISSED`
- **Atomic status transitions** — Database-level row locking prevents concurrent conflict
- **Moderator authentication** — bcrypt password hashing, JWT-based access control, role enforcement
- **Timing-safe login** — Dummy bcrypt compare prevents username enumeration
- **Configurable rate limiting** — Separate limits for tracking, login, and submission
- **Security headers** — Helmet.js for HTTP security hardening
- **Centralized error handling** — No stack traces or SQL details leaked to clients
- **Automated test suite** — Native Node.js test runner, no external test frameworks

---

## Technology Stack

| Component | Technology |
|---|---|
| Runtime | Node.js ≥ 18 (CommonJS) |
| Framework | Express.js 4 |
| Database | PostgreSQL |
| DB Driver | `pg` (node-postgres), raw parameterized SQL |
| Password Hashing | bcrypt (12 rounds) |
| Authentication | JWT (`jsonwebtoken`, HS256) |
| Security Headers | Helmet |
| Rate Limiting | `express-rate-limit` |
| Environment | `dotenv` |
| Testing | Node.js built-in `node:test` + native `fetch` |

**No ORMs. No TypeScript. No frontend frameworks. No MongoDB.**

---

## Prerequisites

- **Node.js ≥ 18.0.0** (required for native `fetch` in tests)
- **PostgreSQL** (local or managed, e.g., Render)
- **npm** ≥ 9

---

## Installation and Setup

### 1. Clone the repository

```bash
git clone <your-repo-url>
cd whistledrop
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Copy the example file and fill in your values:

```bash
cp .env.example .env
```

Edit `.env`:

```env
PORT=3000
NODE_ENV=development

DATABASE_URL=postgres://youruser:yourpassword@localhost:5432/whistledrop
TEST_DATABASE_URL=postgres://youruser:yourpassword@localhost:5432/whistledrop_test

JWT_SECRET=replace_with_a_long_random_secret_at_least_32_chars
JWT_EXPIRES_IN=8h

# CRITICAL: Losing this pepper makes ALL existing case codes permanently untrackable.
CASE_CODE_PEPPER=replace_with_a_long_random_pepper_at_least_32_chars

RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_TRACKING=30
RATE_LIMIT_MAX_LOGIN=5
RATE_LIMIT_MAX_SUBMISSIONS=50

MODERATOR_USERNAME=admin
MODERATOR_PASSWORD=replace_with_strong_password_min_12_chars
```

### 4. Create the PostgreSQL databases

```bash
# Production database
createdb whistledrop

# Test database (must be separate)
createdb whistledrop_test
```

Or connect using `psql` and run:

```sql
CREATE DATABASE whistledrop;
CREATE DATABASE whistledrop_test;
```

### 5. Apply the database schema

```bash
# Apply to production database
psql $DATABASE_URL -f database/schema.sql

# Apply to test database
psql $TEST_DATABASE_URL -f database/schema.sql
```

The schema is idempotent (`IF NOT EXISTS`) and safe to re-run.

### 6. Create the initial moderator account

```bash
npm run create-moderator
```

This reads `MODERATOR_USERNAME` and `MODERATOR_PASSWORD` from your `.env`. The password must be at least 12 characters. No credentials are hardcoded in source code.

### 7. Start the server

```bash
npm start
```

The server performs a database connectivity check before accepting requests. It will exit with a clear message if `DATABASE_URL`, `JWT_SECRET`, or `CASE_CODE_PEPPER` is missing.

---

## Environment Variables Reference

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | `3000` | HTTP server port |
| `NODE_ENV` | No | `development` | `development`, `test`, or `production` |
| `DATABASE_URL` | **Yes** | — | PostgreSQL connection string |
| `TEST_DATABASE_URL` | For tests | — | Separate test database URL |
| `JWT_SECRET` | **Yes** | — | Secret for signing JWTs (≥ 32 chars) |
| `JWT_EXPIRES_IN` | No | `8h` | JWT expiry duration |
| `CASE_CODE_PEPPER` | **Yes** | — | HMAC key for case code hashing |
| `RATE_LIMIT_WINDOW_MS` | No | `900000` | Rate limit time window (ms) |
| `RATE_LIMIT_MAX_TRACKING` | No | `30` | Max tracking requests per window |
| `RATE_LIMIT_MAX_LOGIN` | No | `5` | Max login attempts per window |
| `RATE_LIMIT_MAX_SUBMISSIONS` | No | `50` | Max report submissions per window |
| `MODERATOR_USERNAME` | For setup | — | Username for `create-moderator` script |
| `MODERATOR_PASSWORD` | For setup | — | Password for `create-moderator` (≥ 12 chars) |

---

## Database Schema

### `reports`

| Column | Type | Notes |
|---|---|---|
| `id` | `SERIAL PRIMARY KEY` | Internal ID (never exposed to reporters) |
| `case_code_hash` | `VARCHAR(64) UNIQUE NOT NULL` | HMAC-SHA256 hex of the raw case code |
| `category` | `VARCHAR(32) NOT NULL` | CHECK: Security, Harassment, Corruption, Technical, Other |
| `description` | `TEXT NOT NULL` | CHECK: 10–5000 characters |
| `evidence_url` | `VARCHAR(2048)` | Optional http/https URL |
| `status` | `VARCHAR(32) NOT NULL` | CHECK: SUBMITTED, UNDER_REVIEW, RESOLVED, DISMISSED |
| `created_at` | `TIMESTAMPTZ` | Set on insert |
| `updated_at` | `TIMESTAMPTZ` | Updated on status change or new update |

### `moderators`

| Column | Type | Notes |
|---|---|---|
| `id` | `SERIAL PRIMARY KEY` | |
| `username` | `VARCHAR(64) UNIQUE NOT NULL` | |
| `password_hash` | `VARCHAR(255) NOT NULL` | bcrypt hash (12 rounds) |
| `created_at` | `TIMESTAMPTZ` | |

### `report_updates`

| Column | Type | Notes |
|---|---|---|
| `id` | `SERIAL PRIMARY KEY` | |
| `report_id` | `INTEGER NOT NULL` | FK → `reports(id)` ON DELETE RESTRICT |
| `moderator_id` | `INTEGER NOT NULL` | FK → `moderators(id)` ON DELETE RESTRICT |
| `message` | `TEXT NOT NULL` | CHECK: 1–1000 characters. **Public** |
| `created_at` | `TIMESTAMPTZ` | |

> **Public updates note**: Every message in `report_updates` is **publicly visible** to the reporter via the tracking endpoint. There are no private notes. Moderators should only write messages appropriate for public disclosure.

---

## API Endpoints

### Standard Response Format

**Success:**
```json
{ "success": true, "data": { ... }, "message": "Optional text" }
```

**Error:**
```json
{ "success": false, "message": "Descriptive error message" }
```

---

### `GET /health`

Health check. Verifies database connectivity.

**Response `200`:**
```json
{ "success": true, "message": "Service is healthy" }
```

---

### `POST /api/reports`

Submit an anonymous report. No authentication required.

**Request body:**
```json
{
  "category": "Security",
  "description": "Detailed description of the incident (10–5000 characters).",
  "evidence_url": "https://example.com/evidence"
}
```

- `category`: Required. One of `Security`, `Harassment`, `Corruption`, `Technical`, `Other` (case-sensitive).
- `description`: Required. 10–5000 characters (trimmed).
- `evidence_url`: Optional. Must be a valid `http://` or `https://` URL, max 2048 characters.

**Response `201`:**
```json
{
  "success": true,
  "message": "Report submitted. Save your case code — it will not be shown again.",
  "data": {
    "case_code": "WD-A3BK-9JNM-X7QR-2PFH",
    "category": "Security",
    "status": "SUBMITTED",
    "created_at": "2024-01-01T00:00:00.000Z"
  }
}
```

> **Important**: Save the `case_code`. It is shown **once only** and cannot be recovered. The system stores only an HMAC hash of the code.

**Error codes:** `400`, `413`, `429`, `500`

---

### `GET /api/reports/:caseCode`

Track a report by case code. No authentication required. Rate-limited.

The case code is normalized (trimmed, uppercased) before validation and hashing, so `wd-a3bk-9jnm-x7qr-2pfh` works the same as `WD-A3BK-9JNM-X7QR-2PFH`.

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "case_code": "WD-A3BK-9JNM-X7QR-2PFH",
    "category": "Security",
    "status": "UNDER_REVIEW",
    "created_at": "2024-01-01T00:00:00.000Z",
    "updated_at": "2024-01-02T00:00:00.000Z",
    "updates": [
      {
        "message": "Your report is now under review by our team.",
        "created_at": "2024-01-02T00:00:00.000Z"
      }
    ]
  }
}
```

**Never returned:** `id`, `case_code_hash`, `description`, `evidence_url`, `moderator_id`, moderator username.

**Error codes:** `400`, `404`, `429`, `500`

---

### `POST /api/moderator/login`

Authenticate as a moderator. Rate-limited.

**Request body:**
```json
{ "username": "admin", "password": "yourpassword" }
```

**Response `200`:**
```json
{
  "success": true,
  "message": "Login successful",
  "data": { "token": "<JWT>" }
}
```

Use the token in subsequent requests as: `Authorization: Bearer <token>`

**Error codes:** `400`, `401`, `429`, `500`

---

### `GET /api/moderator/reports`

List all reports with optional filtering and pagination. Requires JWT.

**Query parameters:**
- `status`: Filter by status (`SUBMITTED`, `UNDER_REVIEW`, `RESOLVED`, `DISMISSED`)
- `category`: Filter by category (`Security`, `Harassment`, `Corruption`, `Technical`, `Other`)
- `page`: Page number (default: `1`)
- `limit`: Items per page (default: `20`, max: `100`)

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "reports": [
      {
        "id": 1,
        "category": "Security",
        "description": "Detailed description of the incide...",
        "evidence_url": null,
        "status": "SUBMITTED",
        "created_at": "2024-01-01T00:00:00.000Z",
        "updated_at": "2024-01-01T00:00:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 1,
      "totalPages": 1
    }
  }
}
```

**Never returned:** `case_code_hash`, raw `case_code`. Description is truncated to 200 characters in the listing.

**Error codes:** `400`, `401`, `403`, `500`

---

### `GET /api/moderator/reports/:id`

View a single report with full description and public updates. Requires JWT.

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "report": {
      "id": 1,
      "category": "Security",
      "description": "Full description text here.",
      "evidence_url": "https://example.com",
      "status": "UNDER_REVIEW",
      "created_at": "2024-01-01T00:00:00.000Z",
      "updated_at": "2024-01-02T00:00:00.000Z",
      "updates": [
        {
          "message": "Now under review.",
          "created_at": "2024-01-02T00:00:00.000Z"
        }
      ]
    }
  }
}
```

**Never returned:** `case_code_hash`, `moderator_id`, raw `case_code`.

**Error codes:** `400`, `401`, `403`, `404`, `500`

---

### `PATCH /api/moderator/reports/:id/status`

Atomically update a report's status and record a public update. Requires JWT.

**Status transition rules:**
- `SUBMITTED` → `UNDER_REVIEW`
- `UNDER_REVIEW` → `RESOLVED` or `DISMISSED`
- All other transitions return `409 Conflict`
- `DISMISSED` **requires** a `message`
- `UNDER_REVIEW` and `RESOLVED` use a default message if none is provided

**Request body:**
```json
{
  "status": "UNDER_REVIEW",
  "message": "Optional public-facing message"
}
```

**Response `200`:**
```json
{
  "success": true,
  "message": "Report status updated to UNDER_REVIEW",
  "data": {
    "report": {
      "id": 1,
      "category": "Security",
      "status": "UNDER_REVIEW",
      "created_at": "2024-01-01T00:00:00.000Z",
      "updated_at": "2024-01-02T00:00:00.000Z"
    }
  }
}
```

**Concurrency guarantee:** The transition runs inside a `BEGIN ... FOR UPDATE ... COMMIT` transaction. If two requests attempt conflicting updates simultaneously, exactly one succeeds (`200`) and the other receives `409`.

**Error codes:** `400`, `401`, `403`, `404`, `409`, `500`

---

### `POST /api/moderator/reports/:id/updates`

Append a public status update message to a report. Requires JWT.

Returns `409` if the report status is `RESOLVED` or `DISMISSED`.

**Request body:**
```json
{ "message": "We have received additional information and are investigating." }
```

- `message`: Required. 1–1000 characters.

**Response `201`:**
```json
{ "success": true, "message": "Status update added successfully" }
```

**Error codes:** `400`, `401`, `403`, `404`, `409`, `500`

---

## cURL Walkthrough

### Health Check

```bash
curl http://localhost:3000/health
```

Expected:
```json
{ "success": true, "message": "Service is healthy" }
```

### Submit a Report

```bash
curl -X POST http://localhost:3000/api/reports \
  -H "Content-Type: application/json" \
  -d '{
    "category": "Security",
    "description": "I witnessed unauthorized access to confidential files in the finance department.",
    "evidence_url": "https://drive.example.com/evidence-folder"
  }'
```

Expected `201`:
```json
{
  "success": true,
  "message": "Report submitted. Save your case code — it will not be shown again.",
  "data": {
    "case_code": "WD-A3BK-9JNM-X7QR-2PFH",
    "category": "Security",
    "status": "SUBMITTED",
    "created_at": "2024-01-01T10:00:00.000Z"
  }
}
```

### Track a Report

```bash
curl http://localhost:3000/api/reports/WD-A3BK-9JNM-X7QR-2PFH
```

Expected `200`:
```json
{
  "success": true,
  "data": {
    "case_code": "WD-A3BK-9JNM-X7QR-2PFH",
    "category": "Security",
    "status": "SUBMITTED",
    "created_at": "2024-01-01T10:00:00.000Z",
    "updated_at": "2024-01-01T10:00:00.000Z",
    "updates": []
  }
}
```

### Moderator Login

```bash
curl -X POST http://localhost:3000/api/moderator/login \
  -H "Content-Type: application/json" \
  -d '{ "username": "admin", "password": "yourpassword" }'
```

Expected `200`:
```json
{
  "success": true,
  "message": "Login successful",
  "data": { "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." }
}
```

Save the token: `export TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."`

### List All Reports

```bash
curl http://localhost:3000/api/moderator/reports \
  -H "Authorization: Bearer $TOKEN"
```

### Filter by Status and Paginate

```bash
curl "http://localhost:3000/api/moderator/reports?status=SUBMITTED&page=1&limit=10" \
  -H "Authorization: Bearer $TOKEN"
```

### View a Single Report

```bash
curl http://localhost:3000/api/moderator/reports/1 \
  -H "Authorization: Bearer $TOKEN"
```

### Move Report to Under Review

```bash
curl -X PATCH http://localhost:3000/api/moderator/reports/1/status \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "status": "UNDER_REVIEW" }'
```

### Resolve a Report

```bash
curl -X PATCH http://localhost:3000/api/moderator/reports/1/status \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "status": "RESOLVED", "message": "The reported issue has been investigated and addressed." }'
```

### Dismiss a Report (message required)

```bash
curl -X PATCH http://localhost:3000/api/moderator/reports/1/status \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "status": "DISMISSED", "message": "After review, this report does not fall within our remit." }'
```

### Add a Status Update

```bash
curl -X POST http://localhost:3000/api/moderator/reports/1/updates \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "message": "We have escalated this to the relevant department." }'
```

---

## Privacy and Security Design

### Case Code Cryptography

1. A 16-character code is generated using `crypto.randomBytes(16)`.
2. Each byte is mapped to one character from the 32-character unambiguous Base32 variant alphabet (`23456789ABCDEFGHJKLMNPQRSTUVWXYZ`). Because 256 ÷ 32 = 8 exactly, the reduction `byte % 32` has **no modulo bias** — every symbol is equally likely. This gives approximately 80 bits of entropy.
3. The code is formatted as `WD-XXXX-XXXX-XXXX-XXXX`.
4. Only `HMAC-SHA256(code, CASE_CODE_PEPPER)` is stored in the database. The raw code is returned to the reporter exactly once.
5. Tracking performs a database lookup using `WHERE case_code_hash = $1`. The secret `CASE_CODE_PEPPER` makes brute-forcing the code space impractical even if the database is compromised, so a separate `timingSafeEqual` comparison is not required at the application layer.

**Pepper loss warning**: If `CASE_CODE_PEPPER` is lost, rotated without data migration, or changed, all existing case codes become permanently untrackable. Keep the pepper secret and backed up separately from the database.

### Password Security

- Moderator passwords are hashed with bcrypt using 12 salt rounds.
- The `createModerator.js` script enforces a minimum password length of 12 characters.
- During login, if the username does not exist, a bcrypt compare is still performed against a dummy hash. This equalizes response time and prevents an attacker from learning which usernames are valid by measuring response latency.
- Both an unknown username and a wrong password return the identical message: `"Invalid username or password"`.

### JWT Authentication

- Tokens are signed and verified with HS256 only (algorithm pinned to prevent algorithm-switching attacks).
- Token payload: `{ id, username, role: "moderator" }`.
- Missing, malformed, or expired tokens return `401 Unauthorized`.
- Valid tokens without `role: "moderator"` return `403 Forbidden`.

### Public Status Updates

Every `report_updates` message is **publicly visible** via the tracking endpoint. There are no private internal notes. Moderators should treat all update messages as public communications to the reporter.

### Rate Limiting

- Tracking endpoint: default 30 requests per 15 minutes per IP.
- Login endpoint: default 5 attempts per 15 minutes per IP.
- Submission endpoint: default 50 submissions per 15 minutes per IP.
- All thresholds are configurable via environment variables.
- `app.set('trust proxy', 1)` ensures accurate IP detection behind Render's reverse proxy.

### Input Validation and Error Handling

- All inputs are validated before reaching the database layer.
- Parameterized SQL queries (`$1`, `$2`, ...) are used throughout — SQL injection is structurally prevented.
- Body size is limited to 10 KB (`express.json({ limit: '10kb' })`).
- JSON parse failures return `400 Bad Request`.
- Payload-too-large returns `413`.
- Stack traces, SQL error messages, and internal details are never exposed in production responses.

### No Reporter Identity Collection

The system does not request, accept, or store:
- Names
- Email addresses
- Phone numbers
- Account credentials
- IP addresses (in database records)
- User agent strings

No request-logging middleware is used. Request bodies are never logged.

---

## Testing

### Setup

Ensure `TEST_DATABASE_URL` is set in your `.env` and points to a **different database** than `DATABASE_URL`. The test suite will abort with an error if these values are equal or if `TEST_DATABASE_URL` is missing.

Apply the schema to the test database:

```bash
psql $TEST_DATABASE_URL -f database/schema.sql
```

### Run Tests

```bash
npm test
```

Tests run sequentially (`--test-concurrency=1`) because they share one test database. Each test file truncates all tables before each test to ensure isolation.

### Test Coverage

- Anonymous report submission (success, all valid categories)
- Field validation (missing fields, invalid category, short/long description, bad URL)
- Unique case code generation
- Case code tracking (success, lowercase normalization, invalid format, nonexistent code)
- Response field exposure rules (no `id`, `case_code_hash`, `moderator_id` in public responses)
- Moderator login (valid credentials, wrong password, unknown username, empty body)
- Timing-safe login (same error message for both failure cases)
- JWT authentication (missing token, malformed token, expired token, wrong role → 403)
- Report listing with filters and pagination
- Pagination validation (invalid page, limit over 100)
- Single report detail
- Status transitions (all valid and invalid paths)
- Dismissal without message (400)
- Adding updates to terminal states (409)
- Public update visibility via tracking endpoint
- Concurrent conflicting status updates (exactly one 200, one 409)
- SQL injection safety (in body, path parameters, query strings)
- Rate limiting (429 responses)

---

## Deployment on Render

### 1. Create a Render account and new Web Service

- Connect your GitHub repository.
- Set **Build Command**: `npm install`
- Set **Start Command**: `npm start`

### 2. Create a Managed PostgreSQL database on Render

- Go to **Dashboard → New → PostgreSQL**.
- Copy the **Internal Database URL** for use as `DATABASE_URL`.

### 3. Set environment variables in Render

Add all variables from `.env.example` under **Environment → Environment Variables**:

```
NODE_ENV=production
DATABASE_URL=<Render internal DB URL>
JWT_SECRET=<strong random secret>
JWT_EXPIRES_IN=8h
CASE_CODE_PEPPER=<strong random pepper>
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_TRACKING=30
RATE_LIMIT_MAX_LOGIN=5
RATE_LIMIT_MAX_SUBMISSIONS=50
```

### 4. Apply the schema via Render Shell

Use the Render Shell or a one-off job:

```bash
psql $DATABASE_URL -f database/schema.sql
```

### 5. Create the initial moderator

Set `MODERATOR_USERNAME` and `MODERATOR_PASSWORD` temporarily in your environment, then run:

```bash
node scripts/createModerator.js
```

Or use Render's one-off command feature.

### 6. SSL and Proxy

- `NODE_ENV=production` automatically enables SSL for the `pg` connection (`ssl: { rejectUnauthorized: false }`), which is required for Render managed PostgreSQL.
- `app.set('trust proxy', 1)` is configured in `app.js` so rate limiting correctly identifies client IPs behind Render's load balancer.

---

## Known Limitations

1. **Single moderator role** — All authenticated moderators have the same permissions. There is no admin hierarchy.
2. **No reporter-side notifications** — Reporters must actively check their case code to see status changes. There is no email or push notification system.
3. **Submission rate limit is per-IP** — If multiple reporters share an IP (e.g., behind a corporate NAT), the submission rate limit applies collectively.
4. **No permanent case closure** — Resolved and dismissed cases can still be tracked. There is no mechanism to purge or anonymize old reports.
5. **No evidence file uploads** — `evidence_url` accepts a URL reference only; actual file uploads are not supported.
6. **No spam prevention beyond rate limiting** — The system does not detect or block repeated similar submissions, only the rate-limit maximum.
7. **No reporter-side account** — Reporters cannot create accounts. The case code is the only access credential. If lost, the submission cannot be accessed or retracted.

---

## How to Explain This in a Technical Evaluation

### Architecture
*"WhistleDrop separates concerns across routes, controllers, services, and a database config module. Routes declare the endpoint and attach middleware like rate limiters. Controllers handle HTTP: they parse input, call validation utilities, delegate to service functions, and send back the JSON response. Services contain the database logic — they run parameterized SQL queries or manage explicit transactions. This makes each layer testable and replaceable."*

### Case Code Hashing
*"We generate 16 cryptographically random characters using `crypto.randomBytes`. Each byte maps to one of 32 symbols via `byte % 32` — this has no modulo bias because 256 divided by 32 is exactly 8. We format it as `WD-XXXX-XXXX-XXXX-XXXX` and return it once. We never store it. Instead we compute `HMAC-SHA256(code, pepper)` and store that hash. When tracking, we hash the input and do a database lookup. The pepper means even if the database leaks, you can't reverse the codes without the pepper."*

### Concurrency
*"The status PATCH runs inside a `BEGIN ... COMMIT` transaction. We use `SELECT ... FOR UPDATE` to take an exclusive row lock. If two requests arrive at the same time, the second one blocks until the first commits. When it reads the status, it sees the already-updated value, detects an invalid transition, and returns 409. So exactly one request succeeds."*

### Timing-Safe Login
*"If a username doesn't exist, we still call `bcrypt.compare` against a precomputed dummy hash. bcrypt is slow by design — typically 100+ milliseconds per comparison. Without this, an attacker could distinguish valid from invalid usernames by measuring how long the server takes to respond. By always doing the comparison, both cases take the same time."*

### Testing Strategy
*"Tests use Node's built-in `node:test` module and native `fetch` — no external test framework. `app.js` exports the Express app without calling `.listen()`. In tests we call `app.listen(0)` to get an OS-assigned ephemeral port. Tests connect to a separate `TEST_DATABASE_URL` and refuse to run if it equals `DATABASE_URL`, preventing accidental production data loss. Tables are truncated before each test for isolation."*
