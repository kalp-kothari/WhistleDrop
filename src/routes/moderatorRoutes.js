'use strict';

const express = require('express');
const router  = express.Router();

const {
  login,
  listReportsHandler,
  getReportHandler,
  updateStatusHandler,
  addUpdateHandler,
} = require('../controllers/moderatorController');

const { authMiddleware }  = require('../middleware/authMiddleware');
const { loginLimiter }    = require('../middleware/rateLimitMiddleware');

// POST /api/moderator/login — public, rate-limited
router.post('/login', loginLimiter, login);

// All routes below require a valid moderator JWT
router.use(authMiddleware);

// GET /api/moderator/reports — list with filters and pagination
router.get('/reports', listReportsHandler);

// GET /api/moderator/reports/:id — single report detail
router.get('/reports/:id', getReportHandler);

// PATCH /api/moderator/reports/:id/status — atomic status transition
router.patch('/reports/:id/status', updateStatusHandler);

// POST /api/moderator/reports/:id/updates — append public update
router.post('/reports/:id/updates', addUpdateHandler);

module.exports = router;
