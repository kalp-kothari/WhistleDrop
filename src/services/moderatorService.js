'use strict';

const db = require('../config/db');

// Valid status transitions: maps current status to allowed next statuses.
const ALLOWED_TRANSITIONS = {
  SUBMITTED:    ['UNDER_REVIEW'],
  UNDER_REVIEW: ['RESOLVED', 'DISMISSED'],
  RESOLVED:     [],
  DISMISSED:    [],
};

// Default messages when none is supplied by the moderator.
const DEFAULT_MESSAGES = {
  UNDER_REVIEW: 'Your report is now under review by our team.',
  RESOLVED:     'Your report has been resolved. Thank you for submitting.',
};

/**
 * Find a moderator by username.
 * Returns the moderator row or null.
 */
async function findModeratorByUsername(username) {
  const sql = 'SELECT id, username, password_hash FROM moderators WHERE username = $1';
  const result = await db.query(sql, [username]);
  return result.rows[0] || null;
}

/**
 * Fetch a paginated, optionally filtered list of reports for moderators.
 * Returns report summary (truncated description) and pagination metadata.
 * Never returns case_code_hash.
 */
async function listReports({ page, limit, status, category }) {
  const offset = (page - 1) * limit;
  const conditions = [];
  const params     = [];

  if (status) {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }
  if (category) {
    params.push(category);
    conditions.push(`category = $${params.length}`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Count total matching rows for pagination metadata
  const countSql    = `SELECT COUNT(*) FROM reports ${whereClause}`;
  const countResult = await db.query(countSql, params);
  const total       = parseInt(countResult.rows[0].count, 10);

  // Fetch the page of results — truncate description to 200 chars for listing
  params.push(limit);
  params.push(offset);
  const dataSql = `
    SELECT
      id,
      category,
      LEFT(description, 200) AS description,
      evidence_url,
      status,
      created_at,
      updated_at
    FROM reports
    ${whereClause}
    ORDER BY created_at DESC
    LIMIT $${params.length - 1} OFFSET $${params.length}
  `;
  const dataResult = await db.query(dataSql, params);

  return {
    reports:    dataResult.rows,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

/**
 * Fetch a single report with its full description and all public updates.
 * Returns null if not found. Never returns case_code_hash.
 */
async function getReportById(id) {
  const reportSql = `
    SELECT id, category, description, evidence_url, status, created_at, updated_at
    FROM reports
    WHERE id = $1
  `;
  const reportResult = await db.query(reportSql, [id]);
  if (reportResult.rows.length === 0) return null;

  const report = reportResult.rows[0];

  const updatesSql = `
    SELECT message, created_at
    FROM report_updates
    WHERE report_id = $1
    ORDER BY created_at ASC
  `;
  const updatesResult = await db.query(updatesSql, [id]);
  report.updates = updatesResult.rows;

  return report;
}

/**
 * Atomically transition a report's status and insert a public update record.
 * Uses SELECT ... FOR UPDATE to lock the row and prevent concurrent conflicts.
 * Exactly one concurrent request succeeds; the other receives a 409.
 *
 * @param {number} reportId
 * @param {string} newStatus
 * @param {number} moderatorId
 * @param {string|undefined} message - Required for DISMISSED, optional otherwise.
 * @returns {{ report: object }} Updated report row.
 * @throws {AppError} 404 if not found, 409 if transition invalid.
 */
async function updateReportStatus(reportId, newStatus, moderatorId, message) {
  // Require AppError here to avoid circular deps — import inline
  const { AppError } = require('../middleware/errorMiddleware');

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // Lock the row so concurrent updates wait for this transaction to complete.
    const lockResult = await client.query(
      'SELECT status FROM reports WHERE id = $1 FOR UPDATE',
      [reportId],
    );

    if (lockResult.rows.length === 0) {
      await client.query('ROLLBACK');
      throw new AppError('Report not found', 404);
    }

    const currentStatus = lockResult.rows[0].status;
    const allowed       = ALLOWED_TRANSITIONS[currentStatus] || [];

    if (!allowed.includes(newStatus)) {
      await client.query('ROLLBACK');
      throw new AppError(
        `Invalid status transition from ${currentStatus} to ${newStatus}`,
        409,
      );
    }

    // Resolve the update message
    const resolvedMessage = (message && message.trim()) || DEFAULT_MESSAGES[newStatus];

    // Update the report status
    await client.query(
      'UPDATE reports SET status = $1, updated_at = NOW() WHERE id = $2',
      [newStatus, reportId],
    );

    // Insert the public status update record
    await client.query(
      'INSERT INTO report_updates (report_id, moderator_id, message) VALUES ($1, $2, $3)',
      [reportId, moderatorId, resolvedMessage],
    );

    await client.query('COMMIT');

    // Fetch and return the updated report
    const updated = await db.query(
      'SELECT id, category, description, evidence_url, status, created_at, updated_at FROM reports WHERE id = $1',
      [reportId],
    );
    return { report: updated.rows[0] };
  } catch (err) {
    // Only rollback if we haven't already done so above
    if (err.name !== 'AppError') {
      await client.query('ROLLBACK');
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Add a public status update message to an existing report.
 * Returns 409 if the report is RESOLVED or DISMISSED (terminal state).
 * Bumps reports.updated_at inside the same transaction.
 */
async function addReportUpdate(reportId, moderatorId, message) {
  const { AppError } = require('../middleware/errorMiddleware');

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const lockResult = await client.query(
      'SELECT status FROM reports WHERE id = $1 FOR UPDATE',
      [reportId],
    );

    if (lockResult.rows.length === 0) {
      await client.query('ROLLBACK');
      throw new AppError('Report not found', 404);
    }

    const { status } = lockResult.rows[0];
    if (status === 'RESOLVED' || status === 'DISMISSED') {
      await client.query('ROLLBACK');
      throw new AppError(
        `Cannot add updates to a ${status} report`,
        409,
      );
    }

    await client.query(
      'INSERT INTO report_updates (report_id, moderator_id, message) VALUES ($1, $2, $3)',
      [reportId, moderatorId, message.trim()],
    );

    await client.query(
      'UPDATE reports SET updated_at = NOW() WHERE id = $1',
      [reportId],
    );

    await client.query('COMMIT');

    return { message: 'Update added successfully' };
  } catch (err) {
    if (err.name !== 'AppError') {
      await client.query('ROLLBACK');
    }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  findModeratorByUsername,
  listReports,
  getReportById,
  updateReportStatus,
  addReportUpdate,
  ALLOWED_TRANSITIONS,
};
