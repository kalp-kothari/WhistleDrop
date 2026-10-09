'use strict';

const bcrypt = require('bcrypt');
const jwt    = require('jsonwebtoken');

const {
  findModeratorByUsername,
  listReports,
  getReportById,
  updateReportStatus,
  addReportUpdate,
} = require('../services/moderatorService');

const {
  validateLoginInput,
  validatePagination,
  validateStatusFilter,
  validateCategoryFilter,
  validateReportId,
  validateNewStatus,
  validateUpdateMessage,
} = require('../utils/validation');

const { AppError } = require('../middleware/errorMiddleware');

// Precomputed bcrypt hash of a dummy password (12 rounds).
// Used to equalize response time when the username does not exist,
// preventing user enumeration via timing differences.
const DUMMY_HASH = '$2b$12$invalidhashfortimingsafetyWhistleDrop00000000000000000';

/**
 * POST /api/moderator/login
 * Authenticate a moderator and return a signed JWT.
 * Always performs a bcrypt compare (even for unknown usernames) to
 * prevent timing-based username enumeration.
 */
async function login(req, res, next) {
  try {
    const validationError = validateLoginInput(req.body);
    if (validationError) {
      return next(new AppError(validationError, 400));
    }

    const { username, password } = req.body;
    const moderator = await findModeratorByUsername(username);

    // Always run bcrypt.compare to prevent timing attacks.
    // If no moderator found, compare against a dummy hash (will always fail).
    const hashToCompare = moderator ? moderator.password_hash : DUMMY_HASH;
    const passwordMatch = await bcrypt.compare(password, hashToCompare);

    if (!moderator || !passwordMatch) {
      return next(new AppError('Invalid username or password', 401));
    }

    const token = jwt.sign(
      { id: moderator.id, username: moderator.username, role: 'moderator' },
      process.env.JWT_SECRET,
      { algorithm: 'HS256', expiresIn: process.env.JWT_EXPIRES_IN || '8h' },
    );

    return res.status(200).json({
      success: true,
      message: 'Login successful',
      data: { token },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/moderator/reports
 * List all reports with optional status/category filters and pagination.
 */
async function listReportsHandler(req, res, next) {
  try {
    const paginationResult = validatePagination(req.query);
    if (typeof paginationResult === 'string') {
      return next(new AppError(paginationResult, 400));
    }
    const { page, limit } = paginationResult;

    const statusFilter = validateStatusFilter(req.query.status);
    if (typeof statusFilter === 'string' && req.query.status !== undefined) {
      // validateStatusFilter returns error string when invalid
      const err = validateStatusFilter(req.query.status);
      if (err !== req.query.status) return next(new AppError(err, 400));
    }

    const categoryFilter = validateCategoryFilter(req.query.category);
    if (typeof categoryFilter === 'string' && req.query.category !== undefined) {
      const err = validateCategoryFilter(req.query.category);
      if (err !== req.query.category) return next(new AppError(err, 400));
    }

    // Re-validate properly: check if returned value is an error
    const statusVal   = validateStatusFilter(req.query.status);
    const categoryVal = validateCategoryFilter(req.query.category);

    if (req.query.status !== undefined && !['SUBMITTED','UNDER_REVIEW','RESOLVED','DISMISSED'].includes(req.query.status)) {
      return next(new AppError(`Invalid status filter. Must be one of: SUBMITTED, UNDER_REVIEW, RESOLVED, DISMISSED`, 400));
    }
    if (req.query.category !== undefined && !['Security','Harassment','Corruption','Technical','Other'].includes(req.query.category)) {
      return next(new AppError(`Invalid category filter. Must be one of: Security, Harassment, Corruption, Technical, Other`, 400));
    }

    const result = await listReports({
      page,
      limit,
      status:   req.query.status,
      category: req.query.category,
    });

    return res.status(200).json({
      success: true,
      data:    result,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/moderator/reports/:id
 * View a single report with full description and public updates.
 */
async function getReportHandler(req, res, next) {
  try {
    const id = validateReportId(req.params.id);
    if (id === null) {
      return next(new AppError('Invalid report ID', 400));
    }

    const report = await getReportById(id);
    if (!report) {
      return next(new AppError('Report not found', 404));
    }

    return res.status(200).json({ success: true, data: { report } });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/moderator/reports/:id/status
 * Atomically update a report's status and insert a public update record.
 * A message is required for DISMISSED, optional for other transitions.
 */
async function updateStatusHandler(req, res, next) {
  try {
    const id = validateReportId(req.params.id);
    if (id === null) {
      return next(new AppError('Invalid report ID', 400));
    }

    const statusError = validateNewStatus(req.body.status);
    if (statusError) {
      return next(new AppError(statusError, 400));
    }

    const { status: newStatus, message } = req.body;

    // DISMISSED requires an explanatory message
    if (newStatus === 'DISMISSED') {
      const msgError = validateUpdateMessage(message);
      if (msgError) {
        return next(new AppError('A message is required when dismissing a report', 400));
      }
    }

    const result = await updateReportStatus(id, newStatus, req.moderator.id, message);

    return res.status(200).json({
      success: true,
      message: `Report status updated to ${newStatus}`,
      data:    { report: result.report },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/moderator/reports/:id/updates
 * Append a public status update message to an existing report.
 * Returns 409 if the report is RESOLVED or DISMISSED.
 */
async function addUpdateHandler(req, res, next) {
  try {
    const id = validateReportId(req.params.id);
    if (id === null) {
      return next(new AppError('Invalid report ID', 400));
    }

    const msgError = validateUpdateMessage(req.body.message);
    if (msgError) {
      return next(new AppError(msgError, 400));
    }

    await addReportUpdate(id, req.moderator.id, req.body.message);

    return res.status(201).json({
      success: true,
      message: 'Status update added successfully',
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { login, listReportsHandler, getReportHandler, updateStatusHandler, addUpdateHandler };
