'use strict';

const { Pool } = require('pg');

// Use test database when running tests, production database otherwise.
const connectionString =
  process.env.NODE_ENV === 'test'
    ? process.env.TEST_DATABASE_URL
    : process.env.DATABASE_URL;

const pool = new Pool({
  connectionString,
  // Enable SSL in production (required by Render managed Postgres).
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

/**
 * Execute a parameterized SQL query using a connection from the pool.
 * @param {string} text - SQL query string with $1, $2 ... placeholders.
 * @param {Array}  params - Array of parameter values.
 * @returns {Promise<import('pg').QueryResult>}
 */
async function query(text, params) {
  return pool.query(text, params);
}

/**
 * Acquire a dedicated client from the pool for use in transactions.
 * Caller is responsible for calling client.release() when done.
 * @returns {Promise<import('pg').PoolClient>}
 */
async function getClient() {
  return pool.connect();
}

/**
 * Gracefully close all idle and active connections in the pool.
 * Called on SIGINT/SIGTERM in server.js.
 */
async function close() {
  await pool.end();
}

module.exports = { query, getClient, close };
