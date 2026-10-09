'use strict';

require('dotenv').config();

const db  = require('./config/db');
const app = require('./app');

// Fail fast if critical environment variables are missing.
// This prevents the server from starting in a broken state.
const REQUIRED_ENV = ['DATABASE_URL', 'JWT_SECRET', 'CASE_CODE_PEPPER'];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`[FATAL] Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

const PORT = parseInt(process.env.PORT, 10) || 3000;

async function start() {
  try {
    // Verify database connectivity before accepting requests
    await db.query('SELECT 1');
    console.log('[DB] Database connection verified');
  } catch (err) {
    console.error('[FATAL] Could not connect to the database:', err.message);
    process.exit(1);
  }

  const server = app.listen(PORT, () => {
    console.log(`[SERVER] WhistleDrop running on port ${PORT} (${process.env.NODE_ENV || 'development'})`);
  });

  // Graceful shutdown: close DB pool on termination signals
  async function shutdown(signal) {
    console.log(`[SERVER] ${signal} received. Shutting down gracefully...`);
    server.close(async () => {
      await db.close();
      console.log('[SERVER] Shutdown complete');
      process.exit(0);
    });
  }

  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start();
