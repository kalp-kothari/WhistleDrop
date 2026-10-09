'use strict';

const { validateReportSubmission } = require('../utils/validation');
const { normalizeCaseCode, isValidCaseCodeFormat, hashCaseCode } = require('../utils/caseCode');
const { createReport, findReportByCaseCodeHash } = require('../services/reportService');
const { AppError } = require('../middleware/errorMiddleware');

/**
 * POST /api/reports
 * Submit an anonymous report. Returns the one-time case code on success.
 */
async function submitReport(req, res, next) {
  try {
    const validationError = validateReportSubmission(req.body);
    if (validationError) {
      return next(new AppError(validationError, 400));
    }

    const { category, description, evidence_url } = req.body;
    const { rawCode, report } = await createReport(category, description, evidence_url);

    return res.status(201).json({
      success: true,
      message: 'Report submitted. Save your case code — it will not be shown again.',
      data: {
        case_code:  rawCode,
        category:   report.category,
        status:     report.status,
        created_at: report.created_at,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/reports/:caseCode
 * Track a report by case code. Normalizes and validates the code format
 * before hashing and querying the database.
 */
async function trackReport(req, res, next) {
  try {
    const normalized = normalizeCaseCode(req.params.caseCode);

    if (!isValidCaseCodeFormat(normalized)) {
      return next(new AppError('Invalid case code format', 400));
    }

    const codeHash = hashCaseCode(normalized);
    const result   = await findReportByCaseCodeHash(codeHash);

    if (!result) {
      return next(new AppError('No report found for this case code', 404));
    }

    return res.status(200).json({
      success: true,
      data: {
        case_code:  normalized,
        category:   result.category,
        status:     result.status,
        created_at: result.created_at,
        updated_at: result.updated_at,
        updates:    result.updates,
      },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { submitReport, trackReport };
