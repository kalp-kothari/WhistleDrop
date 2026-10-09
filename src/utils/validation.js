'use strict';

const VALID_CATEGORIES = ['Security', 'Harassment', 'Corruption', 'Technical', 'Other'];
const VALID_STATUSES   = ['SUBMITTED', 'UNDER_REVIEW', 'RESOLVED', 'DISMISSED'];

/**
 * Validate the fields required for an anonymous report submission.
 * Returns an error message string if invalid, or null if valid.
 * @param {object} body - Request body.
 * @returns {string|null}
 */
function validateReportSubmission(body) {
  const { category, description, evidence_url } = body;

  if (!category || typeof category !== 'string') {
    return 'Category is required';
  }
  if (!VALID_CATEGORIES.includes(category)) {
    return `Invalid category. Must be one of: ${VALID_CATEGORIES.join(', ')}`;
  }

  if (!description || typeof description !== 'string') {
    return 'Description is required';
  }
  const trimmedDesc = description.trim();
  if (trimmedDesc.length < 10) {
    return 'Description must be at least 10 characters';
  }
  if (trimmedDesc.length > 5000) {
    return 'Description must not exceed 5000 characters';
  }

  if (evidence_url !== undefined && evidence_url !== null && evidence_url !== '') {
    if (typeof evidence_url !== 'string') {
      return 'Evidence URL must be a string';
    }
    if (evidence_url.length > 2048) {
      return 'Evidence URL must not exceed 2048 characters';
    }
    if (!/^https?:\/\//i.test(evidence_url)) {
      return 'Evidence URL must start with http:// or https://';
    }
  }

  return null;
}

/**
 * Validate a report ID path parameter.
 * Must be a positive integer within the safe int32 range.
 * Returns parsed integer or null if invalid.
 * @param {string} raw
 * @returns {number|null}
 */
function validateReportId(raw) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 2147483647) return null;
  return n;
}

/**
 * Validate pagination query parameters.
 * Returns { page, limit } or an error string.
 * @param {object} query
 * @returns {{ page: number, limit: number }|string}
 */
function validatePagination(query) {
  let page  = parseInt(query.page,  10);
  let limit = parseInt(query.limit, 10);

  if (query.page !== undefined && (isNaN(page) || page < 1)) {
    return 'page must be a positive integer';
  }
  if (query.limit !== undefined && (isNaN(limit) || limit < 1 || limit > 100)) {
    return 'limit must be an integer between 1 and 100';
  }

  if (isNaN(page))  page  = 1;
  if (isNaN(limit)) limit = 20;

  return { page, limit };
}

/**
 * Validate an optional status filter query parameter.
 * Returns the value, undefined (if absent), or an error string.
 * @param {string|undefined} value
 * @returns {string|undefined|string}
 */
function validateStatusFilter(value) {
  if (value === undefined) return undefined;
  if (!VALID_STATUSES.includes(value)) {
    return `Invalid status filter. Must be one of: ${VALID_STATUSES.join(', ')}`;
  }
  return value;
}

/**
 * Validate an optional category filter query parameter.
 * @param {string|undefined} value
 * @returns {string|undefined|string}
 */
function validateCategoryFilter(value) {
  if (value === undefined) return undefined;
  if (!VALID_CATEGORIES.includes(value)) {
    return `Invalid category filter. Must be one of: ${VALID_CATEGORIES.join(', ')}`;
  }
  return value;
}

/**
 * Validate a status value supplied in a PATCH /status request body.
 * @param {string} value
 * @returns {string|null} Error message or null.
 */
function validateNewStatus(value) {
  if (!value || typeof value !== 'string') {
    return 'New status is required';
  }
  if (!VALID_STATUSES.includes(value)) {
    return `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`;
  }
  return null;
}

/**
 * Validate a status update message for POST /updates.
 * @param {string} value
 * @returns {string|null} Error message or null.
 */
function validateUpdateMessage(value) {
  if (!value || typeof value !== 'string') {
    return 'Message is required';
  }
  const trimmed = value.trim();
  if (trimmed.length < 1) {
    return 'Message must not be empty';
  }
  if (trimmed.length > 1000) {
    return 'Message must not exceed 1000 characters';
  }
  return null;
}

/**
 * Validate moderator login credentials.
 * @param {object} body
 * @returns {string|null} Error message or null.
 */
function validateLoginInput(body) {
  const { username, password } = body;
  if (!username || typeof username !== 'string' || username.trim() === '') {
    return 'Username is required';
  }
  if (!password || typeof password !== 'string' || password.trim() === '') {
    return 'Password is required';
  }
  return null;
}

module.exports = {
  VALID_CATEGORIES,
  VALID_STATUSES,
  validateReportSubmission,
  validateReportId,
  validatePagination,
  validateStatusFilter,
  validateCategoryFilter,
  validateNewStatus,
  validateUpdateMessage,
  validateLoginInput,
};
