'use strict';

const db = require('../config/db');
const { generateCaseCode, hashCaseCode } = require('../utils/caseCode');

/**
 * Insert a new anonymous report into the database.
 * Generates a case code, stores only its HMAC hash.
 * Returns the raw case code (for one-time return to the reporter)
 * and the stored report data.
 */
async function createReport(category, description, evidenceUrl) {
  const rawCode = generateCaseCode();
  const codeHash = hashCaseCode(rawCode);

  const sql = `
    INSERT INTO reports (case_code_hash, category, description, evidence_url)
    VALUES ($1, $2, $3, $4)
    RETURNING id, category, description, evidence_url, status, created_at, updated_at
  `;
  const params = [
    codeHash,
    category,
    description.trim(),
    evidenceUrl || null,
  ];

  const result = await db.query(sql, params);
  return { rawCode, report: result.rows[0] };
}

/**
 * Find a report and its public updates by the HMAC of the case code.
 * Returns null if not found.
 * Never returns: id, case_code_hash, moderator_id, or moderator username.
 */
async function findReportByCaseCodeHash(codeHash) {
  const reportSql = `
    SELECT category, status, created_at, updated_at
    FROM reports
    WHERE case_code_hash = $1
  `;
  const reportResult = await db.query(reportSql, [codeHash]);
  if (reportResult.rows.length === 0) return null;

  const report = reportResult.rows[0];

  // Fetch public status updates — no moderator username or id exposed
  const updatesSql = `
    SELECT message, created_at
    FROM report_updates
    WHERE report_id = (
      SELECT id FROM reports WHERE case_code_hash = $1
    )
    ORDER BY created_at ASC
  `;
  const updatesResult = await db.query(updatesSql, [codeHash]);

  return {
    category:   report.category,
    status:     report.status,
    created_at: report.created_at,
    updated_at: report.updated_at,
    updates:    updatesResult.rows,
  };
}

module.exports = { createReport, findReportByCaseCodeHash };
