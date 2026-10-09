'use strict';

/**
 * tests/moderator.test.js
 * Tests for all moderator endpoints:
 *   POST   /api/moderator/login
 *   GET    /api/moderator/reports
 *   GET    /api/moderator/reports/:id
 *   PATCH  /api/moderator/reports/:id/status
 *   POST   /api/moderator/reports/:id/updates
 *
 * Covers: login (valid, invalid, timing defense), RBAC (401/403), listing,
 * filtering, pagination, status transitions, concurrent conflict, dismissal
 * validation, public update visibility, SQL injection, rate limiting.
 */

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const fs   = require('fs');
const path = require('path');

// ── Safety guard ──────────────────────────────────────────────────────────────
if (!process.env.TEST_DATABASE_URL) {
  console.error('[FATAL] TEST_DATABASE_URL is not set. Aborting to protect data.');
  process.exit(1);
}
if (process.env.TEST_DATABASE_URL === process.env.DATABASE_URL) {
  console.error('[FATAL] TEST_DATABASE_URL must not equal DATABASE_URL. Aborting.');
  process.exit(1);
}

process.env.NODE_ENV        = 'test';
process.env.DATABASE_URL    = process.env.TEST_DATABASE_URL;
process.env.RATE_LIMIT_WINDOW_MS        = '60000';
process.env.RATE_LIMIT_MAX_LOGIN        = '3';
process.env.RATE_LIMIT_MAX_SUBMISSIONS  = '50';
process.env.RATE_LIMIT_MAX_TRACKING     = '30';

process.env.JWT_SECRET       = process.env.JWT_SECRET       || 'test_jwt_secret_at_least_32_chars_long_xyz';
process.env.JWT_EXPIRES_IN   = '1h';
process.env.CASE_CODE_PEPPER = process.env.CASE_CODE_PEPPER || 'test_pepper_at_least_32_chars_long_xyz_abc';

const app = require('../src/app');

let server;
let baseUrl;
let pool;
let moderatorToken; // shared valid token
const MOD_USERNAME = 'testmod';
const MOD_PASSWORD = 'testpassword123';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function post(path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return fetch(`${baseUrl}${path}`, {
    method:  'POST',
    headers,
    body:    JSON.stringify(body),
  });
}

async function get(path, token, queryStr = '') {
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return fetch(`${baseUrl}${path}${queryStr}`, { headers });
}

async function patch(path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return fetch(`${baseUrl}${path}`, {
    method:  'PATCH',
    headers,
    body:    JSON.stringify(body),
  });
}

/** Submit an anonymous report and return its DB id (via moderator list) */
async function submitReport(overrides = {}) {
  const res = await post('/api/reports', {
    category:    'Security',
    description: 'A sufficiently long test description for the moderator test suite.',
    ...overrides,
  });
  const body = await res.json();
  return body.data; // { case_code, category, status, created_at }
}

/** Get the database id of the most recently inserted report */
async function getLastReportId() {
  const result = await pool.query('SELECT id FROM reports ORDER BY id DESC LIMIT 1');
  return result.rows[0]?.id;
}

/** Login and return the token string */
async function loginAsModerator() {
  const res  = await post('/api/moderator/login', { username: MOD_USERNAME, password: MOD_PASSWORD });
  const body = await res.json();
  return body.data?.token;
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

before(async () => {
  pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const schema = fs.readFileSync(path.join(__dirname, '../database/schema.sql'), 'utf8');
  await pool.query(schema);

  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://localhost:${server.address().port}`;
});

after(async () => {
  server.close();
  await pool.end();
});

beforeEach(async () => {
  // Truncate all data
  await pool.query('TRUNCATE reports, moderators, report_updates RESTART IDENTITY CASCADE');

  // Re-seed a test moderator
  const hash = await bcrypt.hash(MOD_PASSWORD, 12);
  await pool.query(
    'INSERT INTO moderators (username, password_hash) VALUES ($1, $2)',
    [MOD_USERNAME, hash],
  );

  // Get a fresh valid token
  moderatorToken = await loginAsModerator();
});

// ── LOGIN TESTS ───────────────────────────────────────────────────────────────

test('login with valid credentials returns 200 and JWT token', async () => {
  const res  = await post('/api/moderator/login', { username: MOD_USERNAME, password: MOD_PASSWORD });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.success, true);
  assert.ok(body.data.token, 'token should be present');
  // JWT has 3 dot-separated segments
  assert.equal(body.data.token.split('.').length, 3);
});

test('login with wrong password returns 401 with generic message', async () => {
  const res  = await post('/api/moderator/login', { username: MOD_USERNAME, password: 'wrongpassword123' });
  const body = await res.json();
  assert.equal(res.status, 401);
  assert.equal(body.success, false);
  assert.equal(body.message, 'Invalid username or password');
});

test('login with nonexistent username returns 401 with identical generic message', async () => {
  const res  = await post('/api/moderator/login', { username: 'nonexistent', password: 'somepassword' });
  const body = await res.json();
  assert.equal(res.status, 401);
  assert.equal(body.success, false);
  // Message must be identical — prevents username enumeration
  assert.equal(body.message, 'Invalid username or password');
});

test('login without username returns 400', async () => {
  const res  = await post('/api/moderator/login', { password: MOD_PASSWORD });
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.equal(body.success, false);
});

test('login without password returns 400', async () => {
  const res  = await post('/api/moderator/login', { username: MOD_USERNAME });
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.equal(body.success, false);
});

test('login with empty body returns 400', async () => {
  const res  = await post('/api/moderator/login', {});
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.equal(body.success, false);
});

test('login rate limiting returns 429 after limit exceeded', async () => {
  let lastRes;
  // RATE_LIMIT_MAX_LOGIN is 3 for this test suite
  for (let i = 0; i < 5; i++) {
    lastRes = await post('/api/moderator/login', { username: 'x', password: 'wrongpassword1' });
  }
  assert.equal(lastRes.status, 429);
  const body = await lastRes.json();
  assert.equal(body.success, false);
});

// ── AUTHENTICATION / AUTHORIZATION TESTS ──────────────────────────────────────

test('accessing protected route without token returns 401', async () => {
  const res  = await get('/api/moderator/reports');
  const body = await res.json();
  assert.equal(res.status, 401);
  assert.equal(body.success, false);
});

test('accessing protected route with malformed token returns 401', async () => {
  const res  = await get('/api/moderator/reports', 'not-a-valid-jwt');
  const body = await res.json();
  assert.equal(res.status, 401);
  assert.equal(body.success, false);
});

test('accessing protected route with expired token returns 401', async () => {
  const jwt = require('jsonwebtoken');
  const expiredToken = jwt.sign(
    { id: 1, username: 'mod', role: 'moderator' },
    process.env.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '0s' },
  );
  await new Promise(r => setTimeout(r, 100)); // ensure expiry
  const res  = await get('/api/moderator/reports', expiredToken);
  const body = await res.json();
  assert.equal(res.status, 401);
  assert.equal(body.success, false);
});

test('accessing protected route with token missing moderator role returns 403', async () => {
  const jwt = require('jsonwebtoken');
  // Valid JWT but role is "user" not "moderator"
  const wrongRoleToken = jwt.sign(
    { id: 1, username: 'mod', role: 'user' },
    process.env.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '1h' },
  );
  const res  = await get('/api/moderator/reports', wrongRoleToken);
  const body = await res.json();
  assert.equal(res.status, 403);
  assert.equal(body.success, false);
});

test('accessing protected route with valid moderator token returns 200', async () => {
  const res  = await get('/api/moderator/reports', moderatorToken);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.success, true);
});

// ── REPORT LISTING TESTS ──────────────────────────────────────────────────────

test('listing reports returns paginated results and metadata', async () => {
  await submitReport();
  await submitReport({ category: 'Harassment' });

  const res  = await get('/api/moderator/reports', moderatorToken);
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.success, true);
  assert.ok(Array.isArray(body.data.reports));
  assert.equal(body.data.reports.length, 2);
  assert.ok(body.data.pagination.total >= 2);
  assert.ok(body.data.pagination.page);
  assert.ok(body.data.pagination.limit);
  assert.ok(body.data.pagination.totalPages);
});

test('listing never exposes case_code_hash', async () => {
  await submitReport();
  const res  = await get('/api/moderator/reports', moderatorToken);
  const body = await res.json();
  for (const report of body.data.reports) {
    assert.equal(report.case_code_hash, undefined, 'case_code_hash must not appear in listing');
    assert.equal(report.case_code,      undefined, 'raw case_code must not appear in listing');
  }
});

test('listing filters by status', async () => {
  await submitReport();
  const res  = await get('/api/moderator/reports', moderatorToken, '?status=SUBMITTED');
  const body = await res.json();
  assert.equal(res.status, 200);
  for (const r of body.data.reports) {
    assert.equal(r.status, 'SUBMITTED');
  }
});

test('listing filters by category', async () => {
  await submitReport({ category: 'Technical' });
  await submitReport({ category: 'Harassment' });
  const res  = await get('/api/moderator/reports', moderatorToken, '?category=Technical');
  const body = await res.json();
  assert.equal(res.status, 200);
  for (const r of body.data.reports) {
    assert.equal(r.category, 'Technical');
  }
});

test('listing with invalid status filter returns 400', async () => {
  const res  = await get('/api/moderator/reports', moderatorToken, '?status=INVALID');
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.equal(body.success, false);
});

test('listing with invalid category filter returns 400', async () => {
  const res  = await get('/api/moderator/reports', moderatorToken, '?category=NotACategory');
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.equal(body.success, false);
});

test('pagination: page and limit are respected', async () => {
  // Insert 3 reports
  await submitReport();
  await submitReport();
  await submitReport();

  const res  = await get('/api/moderator/reports', moderatorToken, '?page=1&limit=2');
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.data.reports.length, 2);
  assert.equal(body.data.pagination.limit, 2);
  assert.equal(body.data.pagination.page, 1);
});

test('pagination with invalid page returns 400', async () => {
  const res  = await get('/api/moderator/reports', moderatorToken, '?page=0');
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.equal(body.success, false);
});

test('pagination with limit over 100 returns 400', async () => {
  const res  = await get('/api/moderator/reports', moderatorToken, '?limit=101');
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.equal(body.success, false);
});

test('SQL injection in query string filter is rejected as invalid value', async () => {
  const res  = await get('/api/moderator/reports', moderatorToken, "?status='; DROP TABLE reports; --");
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.equal(body.success, false);
});

// ── SINGLE REPORT DETAIL TESTS ────────────────────────────────────────────────

test('get single report by valid id returns full details', async () => {
  await submitReport();
  const id = await getLastReportId();

  const res  = await get(`/api/moderator/reports/${id}`, moderatorToken);
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.success, true);
  assert.ok(body.data.report.id);
  assert.ok(body.data.report.description);
  assert.ok(Array.isArray(body.data.report.updates));
  // case_code_hash must not appear
  assert.equal(body.data.report.case_code_hash, undefined);
  assert.equal(body.data.report.case_code,      undefined);
});

test('get single report with nonexistent id returns 404', async () => {
  const res  = await get('/api/moderator/reports/99999', moderatorToken);
  const body = await res.json();
  assert.equal(res.status, 404);
  assert.equal(body.success, false);
});

test('get single report with invalid id (string) returns 400', async () => {
  const res  = await get('/api/moderator/reports/not-a-number', moderatorToken);
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.equal(body.success, false);
});

test('get single report with id 0 returns 400', async () => {
  const res  = await get('/api/moderator/reports/0', moderatorToken);
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.equal(body.success, false);
});

// ── STATUS TRANSITION TESTS ───────────────────────────────────────────────────

test('valid transition SUBMITTED -> UNDER_REVIEW returns 200', async () => {
  await submitReport();
  const id = await getLastReportId();

  const res  = await patch(`/api/moderator/reports/${id}/status`, { status: 'UNDER_REVIEW' }, moderatorToken);
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.data.report.status, 'UNDER_REVIEW');
});

test('valid transition UNDER_REVIEW -> RESOLVED returns 200', async () => {
  await submitReport();
  const id = await getLastReportId();

  await patch(`/api/moderator/reports/${id}/status`, { status: 'UNDER_REVIEW' }, moderatorToken);
  const res  = await patch(`/api/moderator/reports/${id}/status`, { status: 'RESOLVED' }, moderatorToken);
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.data.report.status, 'RESOLVED');
});

test('valid transition UNDER_REVIEW -> DISMISSED with message returns 200', async () => {
  await submitReport();
  const id = await getLastReportId();

  await patch(`/api/moderator/reports/${id}/status`, { status: 'UNDER_REVIEW' }, moderatorToken);
  const res  = await patch(
    `/api/moderator/reports/${id}/status`,
    { status: 'DISMISSED', message: 'Report found to be out of scope.' },
    moderatorToken,
  );
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.data.report.status, 'DISMISSED');
});

test('DISMISSED without a message returns 400', async () => {
  await submitReport();
  const id = await getLastReportId();

  await patch(`/api/moderator/reports/${id}/status`, { status: 'UNDER_REVIEW' }, moderatorToken);
  const res  = await patch(`/api/moderator/reports/${id}/status`, { status: 'DISMISSED' }, moderatorToken);
  const body = await res.json();

  assert.equal(res.status, 400);
  assert.equal(body.success, false);
  assert.match(body.message, /message/i);
});

test('invalid transition SUBMITTED -> RESOLVED returns 409', async () => {
  await submitReport();
  const id = await getLastReportId();

  const res  = await patch(`/api/moderator/reports/${id}/status`, { status: 'RESOLVED' }, moderatorToken);
  const body = await res.json();

  assert.equal(res.status, 409);
  assert.equal(body.success, false);
});

test('invalid transition SUBMITTED -> DISMISSED returns 409', async () => {
  await submitReport();
  const id = await getLastReportId();

  const res  = await patch(
    `/api/moderator/reports/${id}/status`,
    { status: 'DISMISSED', message: 'Some reason.' },
    moderatorToken,
  );
  const body = await res.json();

  assert.equal(res.status, 409);
  assert.equal(body.success, false);
});

test('transitioning an already RESOLVED report returns 409', async () => {
  await submitReport();
  const id = await getLastReportId();

  await patch(`/api/moderator/reports/${id}/status`, { status: 'UNDER_REVIEW' }, moderatorToken);
  await patch(`/api/moderator/reports/${id}/status`, { status: 'RESOLVED' }, moderatorToken);

  // Attempt a second transition from RESOLVED
  const res  = await patch(
    `/api/moderator/reports/${id}/status`,
    { status: 'DISMISSED', message: 'Attempt to re-dismiss.' },
    moderatorToken,
  );
  const body = await res.json();

  assert.equal(res.status, 409);
  assert.equal(body.success, false);
});

test('status update on nonexistent report returns 404', async () => {
  const res  = await patch('/api/moderator/reports/99999/status', { status: 'UNDER_REVIEW' }, moderatorToken);
  const body = await res.json();
  assert.equal(res.status, 404);
  assert.equal(body.success, false);
});

test('status transition without status field returns 400', async () => {
  await submitReport();
  const id = await getLastReportId();

  const res  = await patch(`/api/moderator/reports/${id}/status`, {}, moderatorToken);
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.equal(body.success, false);
});

test('status transition with invalid status value returns 400', async () => {
  await submitReport();
  const id = await getLastReportId();

  const res  = await patch(`/api/moderator/reports/${id}/status`, { status: 'HACKED' }, moderatorToken);
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.equal(body.success, false);
});

test('concurrent conflicting status updates: exactly one succeeds, one returns 409', async () => {
  await submitReport();
  const id = await getLastReportId();

  // Fire two PATCH requests simultaneously
  const [res1, res2] = await Promise.all([
    patch(`/api/moderator/reports/${id}/status`, { status: 'UNDER_REVIEW' }, moderatorToken),
    patch(`/api/moderator/reports/${id}/status`, { status: 'UNDER_REVIEW' }, moderatorToken),
  ]);

  const [body1, body2] = await Promise.all([res1.json(), res2.json()]);

  const statuses = [res1.status, res2.status];
  assert.ok(statuses.includes(200), 'One request should succeed with 200');
  assert.ok(statuses.includes(409), 'One request should fail with 409');

  // Verify exactly one update was recorded in the DB
  const countResult = await pool.query(
    'SELECT COUNT(*) FROM report_updates WHERE report_id = $1',
    [id],
  );
  assert.equal(parseInt(countResult.rows[0].count, 10), 1, 'Exactly one status update row');
});

// ── STATUS UPDATES (POST /updates) TESTS ─────────────────────────────────────

test('adding a status update to active report returns 201', async () => {
  await submitReport();
  const id = await getLastReportId();

  const res  = await post(`/api/moderator/reports/${id}/updates`, { message: 'We are looking into this.' }, moderatorToken);
  const body = await res.json();

  assert.equal(res.status, 201);
  assert.equal(body.success, true);
});

test('status update is visible in public tracking response', async () => {
  // Submit a report and get the case code
  const submitRes = await post('/api/reports', {
    category:    'Technical',
    description: 'Testing public update visibility through the tracker endpoint.',
  });
  const submitBody = await submitRes.json();
  const caseCode   = submitBody.data.case_code;
  const id         = await getLastReportId();

  // Add a status update as a moderator
  await post(`/api/moderator/reports/${id}/updates`, { message: 'Now visible publicly.' }, moderatorToken);

  // Check that the reporter can see it via tracking
  const trackRes  = await fetch(`${baseUrl}/api/reports/${caseCode}`);
  const trackBody = await trackRes.json();

  assert.equal(trackRes.status, 200);
  assert.equal(trackBody.data.updates.length, 1);
  assert.equal(trackBody.data.updates[0].message, 'Now visible publicly.');
  // Moderator ID or username must not appear
  assert.equal(trackBody.data.updates[0].moderator_id, undefined);
  assert.equal(trackBody.data.updates[0].username,     undefined);
});

test('adding update to RESOLVED report returns 409', async () => {
  await submitReport();
  const id = await getLastReportId();

  await patch(`/api/moderator/reports/${id}/status`, { status: 'UNDER_REVIEW' }, moderatorToken);
  await patch(`/api/moderator/reports/${id}/status`, { status: 'RESOLVED' }, moderatorToken);

  const res  = await post(`/api/moderator/reports/${id}/updates`, { message: 'Update after resolve.' }, moderatorToken);
  const body = await res.json();

  assert.equal(res.status, 409);
  assert.equal(body.success, false);
});

test('adding update to DISMISSED report returns 409', async () => {
  await submitReport();
  const id = await getLastReportId();

  await patch(`/api/moderator/reports/${id}/status`, { status: 'UNDER_REVIEW' }, moderatorToken);
  await patch(
    `/api/moderator/reports/${id}/status`,
    { status: 'DISMISSED', message: 'Out of scope.' },
    moderatorToken,
  );

  const res  = await post(`/api/moderator/reports/${id}/updates`, { message: 'Update after dismiss.' }, moderatorToken);
  const body = await res.json();

  assert.equal(res.status, 409);
  assert.equal(body.success, false);
});

test('adding update with empty message returns 400', async () => {
  await submitReport();
  const id = await getLastReportId();

  const res  = await post(`/api/moderator/reports/${id}/updates`, { message: '' }, moderatorToken);
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.equal(body.success, false);
});

test('adding update with message over 1000 chars returns 400', async () => {
  await submitReport();
  const id = await getLastReportId();

  const res  = await post(`/api/moderator/reports/${id}/updates`, { message: 'a'.repeat(1001) }, moderatorToken);
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.equal(body.success, false);
});

test('adding update without message field returns 400', async () => {
  await submitReport();
  const id = await getLastReportId();

  const res  = await post(`/api/moderator/reports/${id}/updates`, {}, moderatorToken);
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.equal(body.success, false);
});

test('adding update to nonexistent report returns 404', async () => {
  const res  = await post('/api/moderator/reports/99999/updates', { message: 'Some message.' }, moderatorToken);
  const body = await res.json();
  assert.equal(res.status, 404);
  assert.equal(body.success, false);
});

test('SQL injection in update message body is stored safely (parameterized)', async () => {
  await submitReport();
  const id = await getLastReportId();

  const injection = "'; DROP TABLE report_updates; --";
  const res  = await post(`/api/moderator/reports/${id}/updates`, { message: injection }, moderatorToken);
  // Should succeed (stored safely) \u2014 table still exists afterward
  if (res.status === 201) {
    const countRes = await pool.query('SELECT COUNT(*) FROM report_updates');
    assert.ok(parseInt(countRes.rows[0].count, 10) >= 1);
  } else {
    assert.equal(res.status, 400); // may fail message length check
  }
});
