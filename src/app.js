'use strict';

require('dotenv').config();

const express = require('express');
const helmet  = require('helmet');

const reportRoutes    = require('./routes/reportRoutes');
const moderatorRoutes = require('./routes/moderatorRoutes');
const { notFoundHandler, errorHandler } = require('./middleware/errorMiddleware');
const db = require('./config/db');

const app = express();

// Trust the first proxy in front of this app (e.g., Render's load balancer).
// Required for express-rate-limit to read the correct client IP from X-Forwarded-For.
app.set('trust proxy', 1);

// Set secure HTTP headers
app.use(helmet());

// Parse JSON bodies up to 10 KB; larger payloads return 413
app.use(express.json({ limit: '10kb' }));

// Health check — does not require authentication
app.get('/health', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.status(200).json({ success: true, message: 'Service is healthy' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Database connection failed' });
  }
});

// Public reporter routes
app.use('/api/reports', reportRoutes);

// Moderator management routes
app.use('/api/moderator', moderatorRoutes);

// 404 — must be after all routes
app.use(notFoundHandler);

// Centralized error handler — must be last, receives (err, req, res, next)
app.use(errorHandler);

module.exports = app;
