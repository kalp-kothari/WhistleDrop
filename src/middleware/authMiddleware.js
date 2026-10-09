'use strict';

const jwt = require('jsonwebtoken');

/**
 * Authentication and authorization middleware for moderator routes.
 *
 * - Missing or malformed Authorization header -> 401
 * - Invalid or expired token                  -> 401
 * - Valid token but role !== 'moderator'       -> 403
 * - Valid moderator token                      -> calls next(), sets req.moderator
 */
function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];

  // Expect: "Authorization: Bearer <token>"
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Authentication token required' });
  }

  const token = authHeader.slice(7); // strip "Bearer "

  let payload;
  try {
    // Pin the algorithm to HS256 to prevent algorithm-switching attacks.
    payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
  } catch (err) {
    // Covers expired, malformed, invalid signature, etc.
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }

  // Role check: even a valid JWT must carry role: "moderator"
  if (payload.role !== 'moderator') {
    return res.status(403).json({ success: false, message: 'Insufficient permissions' });
  }

  // Attach moderator info for use in downstream controllers
  req.moderator = { id: payload.id, username: payload.username, role: payload.role };
  next();
}

module.exports = { authMiddleware };
