'use strict';

/**
 * AppError: a lightweight error class that carries an HTTP status code.
 * Controllers create and pass these to next(err) for centralized handling.
 */
class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'AppError';
  }
}

/**
 * 404 handler — mounted after all routes.
 * Any request that reaches here matched no route.
 */
function notFoundHandler(req, res, next) {
  res.status(404).json({ success: false, message: 'Route not found' });
}

/**
 * Centralized error-handling middleware.
 * Express identifies this as an error handler because it has 4 parameters.
 *
 * Handles:
 *  - body-parser JSON syntax errors  -> 400
 *  - body-parser payload too large   -> 413
 *  - AppError instances              -> statusCode from the error
 *  - Everything else                 -> 500 with a generic message
 *
 * Never exposes stack traces, SQL, or internal details in production.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // Malformed JSON body
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, message: 'Malformed JSON in request body' });
  }

  // Payload too large
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ success: false, message: 'Request body too large' });
  }

  // Known application error with an explicit status code
  if (err.name === 'AppError') {
    return res.status(err.statusCode).json({ success: false, message: err.message });
  }

  // Unexpected error — log internally but hide details from the client
  if (process.env.NODE_ENV !== 'production') {
    // In development, log the full error for easier debugging
    console.error('[ERROR]', err);
  } else {
    console.error('[ERROR]', err.message);
  }

  return res.status(500).json({ success: false, message: 'An unexpected error occurred' });
}

module.exports = { AppError, notFoundHandler, errorHandler };
