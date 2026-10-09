'use strict';

/**
 * tests/reports.test.js
 * Tests for POST /api/reports (anonymous report submission).
 * Covers: successful submission, field validation, SQL injection, unique codes,
 * rate limiting, and that reporter identity is never collected.
 */

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const fs   = require('fs');
const path = require('path');

// ── Safety guard ──────────────────────────────────────────────────────────────
// Tests must use a separate test database. Refuse to run if the guard fails.
if (!process.env.TEST_DATABASE_URL) {
  console.error('[FATAL] TEST_DATABASE_URL is not set. Aborting to protect data.');
  process.exit(1);
}
if (process.env.TEST_DATABASE_URL === process.env.DATABASE_URL) {
  console.error('[FATAL] TEST_DATABASE_URL must not equal DATABASE_URL. Aborting.');
  process.exit(1);
}

// Point the app at the test database
process.env.NODE_ENV        = 'test';
process.env.DATABASE_URL    = process.env.TEST_DATABASE_URL;
// Use low rate-limit values so rate-limit tests work quickly
process.env.RATE_LIMIT_WINDOW_MS        = '60000';
process.env.RATE_LIMIT_MAX_SUBMISSIONS  = '3';
process.env.RATE_LIMIT_MAX_TRACKING     = '30';
process.env.RATE_LIMIT_MAX_LOGIN        = '5';

// Ensure required env vars exist for app bootstrap
process.env.JWT_SECRET       = process.env.JWT_SECRET       || 'test_jwt_secret_at_least_32_chars_long_xyz';
process.env.CASE_CODE_PEPPER = process.env.CASE_CODE_PEPPER || 'test_pepper_at_least_32_chars_long_xyz_abc';

const app = require('../src/app');

let server;
let baseUrl;
let pool;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** POST to the running test server */
async function post(path, body) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** GET from the running test server */
async function get(path) {
  return fetch(`${baseUrl}${path}`);
}

/** Submit a valid report and return the response JSON */
async function submitValidReport(overrides = {}) {
  return post('/api/reports', {
    category:    'Security',
    description: 'This is a valid test report with enough characters to pass validation.',
    ...overrides,
  });
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

before(async () => {
  // Apply schema to test database
  pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const schema = fs.readFileSync(path.join(__dirname, '../database/schema.sql'), 'utf8');
  await pool.query(schema);

  // Start server on ephemeral port
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
  // Truncate all tables between tests for isolation
  await pool.query('TRUNCATE reports, moderators, report_updates RESTART IDENTITY CASCADE');
});

// ── Test cases ────────────────────────────────────────────────────────────────

test('successful report submission returns 201 with case code', async () => {
  const res  = await submitValidReport();
  const body = await res.json();

  assert.equal(res.status, 201);
  assert.equal(body.success, true);
  assert.ok(body.data.case_code, 'case_code should be present');
  assert.match(body.data.case_code, /^WD-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/);
  assert.equal(body.data.status, 'SUBMITTED');
  assert.equal(body.data.category, 'Security');
  assert.ok(body.data.created_at, 'created_at should be present');
});

test('submission with optional evidence_url succeeds', async () => {
  const res  = await submitValidReport({ evidence_url: 'https://example.com/evidence' });
  const body = await res.json();
  assert.equal(res.status, 201);
  assert.equal(body.success, true);
});

test('submission with null evidence_url succeeds', async () => {
  const res  = await submitValidReport({ evidence_url: null });
  const body = await res.json();
  assert.equal(res.status, 201);
});

test('submission without category returns 400', async () => {
  const res  = await post('/api/reports', { description: 'Valid description that is long enough.' });
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.equal(body.success, false);
  assert.ok(body.message);
});

test('submission with invalid category returns 400', async () => {
  const res  = await submitValidReport({ category: 'InvalidCategory' });
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.equal(body.success, false);
  assert.match(body.message, /category/i);
});

test('submission without description returns 400', async () => {
  const res  = await post('/api/reports', { category: 'Security' });
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.equal(body.success, false);
});

test('submission with description too short returns 400', async () => {
  const res  = await submitValidReport({ description: 'Too short' });
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.equal(body.success, false);
  assert.match(body.message, /10 characters/i);
});

test('submission with description exactly 10 chars succeeds', async () => {
  const res  = await submitValidReport({ description: '1234567890' });
  const body = await res.json();
  assert.equal(res.status, 201);
});

test('submission with description over 5000 chars returns 400', async () => {
  const res  = await submitValidReport({ description: 'a'.repeat(5001) });
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.equal(body.success, false);
  assert.match(body.message, /5000/);
});

test('submission with invalid evidence_url returns 400', async () => {
  const res  = await submitValidReport({ evidence_url: 'not-a-url' });
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.equal(body.success, false);
  assert.match(body.message, /url/i);
});

test('submission with evidence_url over 2048 chars returns 400', async () => {
  const res  = await submitValidReport({ evidence_url: 'https://example.com/' + 'a'.repeat(2040) });
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.equal(body.success, false);
});

test('each submission generates a unique case code', async () => {
  const res1 = await submitValidReport();
  const res2 = await submitValidReport();
  const body1 = await res1.json();
  const body2 = await res2.json();
  assert.notEqual(body1.data.case_code, body2.data.case_code);
});

test('response never contains reporter identity fields', async () => {
  const res  = await submitValidReport();
  const body = await res.json();
  // These fields must never be in the response
  assert.equal(body.data.id, undefined, 'id must not be exposed');
  assert.equal(body.data.case_code_hash, undefined, 'case_code_hash must not be exposed');
});

test('all valid categories are accepted', async () => {
  for (const cat of ['Security', 'Harassment', 'Corruption', 'Technical', 'Other']) {
    const res  = await submitValidReport({ category: cat });
    const body = await res.json();
    assert.equal(res.status, 201, `Category '${cat}' should be accepted`);
  }
});

test('malformed JSON body returns 400', async () => {
  const res = await fetch(`${baseUrl}/api/reports`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    '{invalid json',
  });
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.equal(body.success, false);
  assert.match(body.message, /malformed json/i);
});

test('payload over 10kb returns 413', async () => {
  const res = await fetch(`${baseUrl}/api/reports`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      category:    'Security',
      description: 'a'.repeat(12000),
    }),
  });
  assert.equal(res.status, 413);
});

test('SQL injection in description is stored safely (parameterized query)', async () => {
  const maliciousDescription = "'; DROP TABLE reports; -- injection attempt here";
  const res  = await submitValidReport({ description: maliciousDescription });
  // Should succeed (stored safely) or return 400 if too short — not a 500
  assert.ok(res.status === 201 || res.status === 400);
  if (res.status === 201) {
    // Verify the table still exists
    const countRes = await pool.query('SELECT COUNT(*) FROM reports');
    assert.ok(parseInt(countRes.rows[0].count, 10) >= 1);
  }
});

test('SQL injection in category field is rejected as invalid category', async () => {
  const res  = await submitValidReport({ category: "'; DROP TABLE reports; --" });
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.equal(body.success, false);
});

test('rate limiting returns 429 after exceeding submission limit', async () => {
  // RATE_LIMIT_MAX_SUBMISSIONS is set to 3 for tests
  let lastRes;
  for (let i = 0; i < 5; i++) {
    lastRes = await submitValidReport();
  }
  // At some point (after 3) we must get a 429
  const body = await lastRes.json();
  assert.equal(lastRes.status, 429);
  assert.equal(body.success, false);
});
