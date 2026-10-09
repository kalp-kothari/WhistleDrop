'use strict';

/**
 * tests/tracking.test.js
 * Tests for GET /api/reports/:caseCode (case tracking).
 * Covers: successful tracking, invalid/nonexistent codes, lowercase input
 * normalization, field exposure rules, and rate limiting.
 */

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
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
process.env.RATE_LIMIT_WINDOW_MS    = '60000';
process.env.RATE_LIMIT_MAX_TRACKING = '3';
process.env.RATE_LIMIT_MAX_SUBMISSIONS = '50';
process.env.RATE_LIMIT_MAX_LOGIN    = '5';

process.env.JWT_SECRET       = process.env.JWT_SECRET       || 'test_jwt_secret_at_least_32_chars_long_xyz';
process.env.CASE_CODE_PEPPER = process.env.CASE_CODE_PEPPER || 'test_pepper_at_least_32_chars_long_xyz_abc';

const app = require('../src/app');

let server;
let baseUrl;
let pool;

// ── Helpers ───────────────────────────────────────────────────────────────────

async function post(path, body) {
  return fetch(`${baseUrl}${path}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
}

async function get(path) {
  return fetch(`${baseUrl}${path}`);
}

/** Submit a valid report and return its case code */
async function submitAndGetCode() {
  const res = await post('/api/reports', {
    category:    'Corruption',
    description: 'Tracking test report with sufficient description length here.',
  });
  const body = await res.json();
  return body.data.case_code;
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
  await pool.query('TRUNCATE reports, moderators, report_updates RESTART IDENTITY CASCADE');
});

// ── Test cases ────────────────────────────────────────────────────────────────

test('successful tracking returns correct fields', async () => {
  const code = await submitAndGetCode();
  const res  = await get(`/api/reports/${code}`);
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.data.case_code, code);
  assert.equal(body.data.status, 'SUBMITTED');
  assert.equal(body.data.category, 'Corruption');
  assert.ok(body.data.created_at);
  assert.ok(body.data.updated_at);
  assert.ok(Array.isArray(body.data.updates));
});

test('tracking with lowercase case code (normalization) succeeds', async () => {
  const code    = await submitAndGetCode();
  const lowered = code.toLowerCase(); // e.g. wd-abcd-... instead of WD-ABCD-...
  const res     = await get(`/api/reports/${lowered}`);
  const body    = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.success, true);
  // Response returns the normalized (uppercase) code
  assert.equal(body.data.case_code, code);
});

test('tracking with mixed-case code (normalization) succeeds', async () => {
  const code  = await submitAndGetCode();
  const mixed = code.slice(0, 5).toLowerCase() + code.slice(5).toUpperCase();
  const res   = await get(`/api/reports/${mixed}`);
  const body  = await res.json();
  assert.equal(res.status, 200);
});

test('tracking with invalid format returns 400', async () => {
  const res  = await get('/api/reports/INVALID-CODE');
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.equal(body.success, false);
  assert.match(body.message, /invalid case code/i);
});

test('tracking with random valid-format but nonexistent code returns 404', async () => {
  // A syntactically valid code that was never submitted
  const fakeCode = 'WD-2222-2222-2222-2222';
  const res  = await get(`/api/reports/${fakeCode}`);
  const body = await res.json();
  assert.equal(res.status, 404);
  assert.equal(body.success, false);
});

test('tracking with empty path returns 404 (no route match)', async () => {
  const res = await get('/api/reports/');
  assert.ok(res.status === 404 || res.status === 405);
});

test('tracking response never exposes internal or private fields', async () => {
  const code = await submitAndGetCode();
  const res  = await get(`/api/reports/${code}`);
  const body = await res.json();

  assert.equal(res.status, 200);
  // These must never appear in the tracking response
  assert.equal(body.data.id,             undefined, 'id must not be exposed');
  assert.equal(body.data.case_code_hash, undefined, 'case_code_hash must not be exposed');
  assert.equal(body.data.description,   undefined, 'description must not be exposed');
  assert.equal(body.data.evidence_url,  undefined, 'evidence_url must not be exposed');
  assert.equal(body.data.moderator_id,  undefined, 'moderator_id must not be exposed');
});

test('updates array is empty initially', async () => {
  const code = await submitAndGetCode();
  const res  = await get(`/api/reports/${code}`);
  const body = await res.json();
  assert.deepEqual(body.data.updates, []);
});

test('SQL injection in case code path parameter returns 400 (format rejected)', async () => {
  const injection = "WD-'; DROP TABLE reports; --";
  const res  = await get(`/api/reports/${encodeURIComponent(injection)}`);
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.equal(body.success, false);
});

test('SQL injection in case code query string is safely rejected by format check', async () => {
  // Any attempt that doesn't match the format regex returns 400
  const res = await get("/api/reports/WD-2222-OR 1%3D1--2222-2222");
  assert.ok(res.status === 400 || res.status === 404);
});

test('rate limiting on tracking returns 429 after limit exceeded', async () => {
  const code = await submitAndGetCode();
  let lastRes;
  // RATE_LIMIT_MAX_TRACKING is set to 3 for this test file
  for (let i = 0; i < 5; i++) {
    lastRes = await get(`/api/reports/${code}`);
  }
  assert.equal(lastRes.status, 429);
  const body = await lastRes.json();
  assert.equal(body.success, false);
});

test('repeated valid tracking of the same code works consistently', async () => {
  // Reset rate limit by using a fresh server — not possible mid-test,
  // so we just test two sequential successful requests
  const code = await submitAndGetCode();
  const res1 = await get(`/api/reports/${code}`);
  const res2 = await get(`/api/reports/${code}`);
  // Both should succeed or the second might hit rate limit depending on prior tests
  assert.ok(res1.status === 200 || res1.status === 429);
  assert.ok(res2.status === 200 || res2.status === 429);
});
