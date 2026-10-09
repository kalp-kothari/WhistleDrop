'use strict';

const express = require('express');
const router  = express.Router();

const { submitReport, trackReport } = require('../controllers/reportController');
const { submissionLimiter, trackingLimiter } = require('../middleware/rateLimitMiddleware');

// POST /api/reports — anonymous report submission
router.post('/', submissionLimiter, submitReport);

// GET /api/reports/:caseCode — track a report by case code
router.get('/:caseCode', trackingLimiter, trackReport);

module.exports = router;
