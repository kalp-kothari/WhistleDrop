'use strict';

/**
 * Administrative script to create the initial moderator account.
 * Run: node scripts/createModerator.js
 *
 * Reads credentials from environment variables only — no credentials in source code.
 * Required env vars: DATABASE_URL, MODERATOR_USERNAME, MODERATOR_PASSWORD
 */

require('dotenv').config();

const bcrypt = require('bcrypt');
const { Pool } = require('pg');

const BCRYPT_ROUNDS = 12;

async function createModerator() {
  const username = process.env.MODERATOR_USERNAME;
  const password = process.env.MODERATOR_PASSWORD;

  if (!username || username.trim() === '') {
    console.error('[ERROR] MODERATOR_USERNAME environment variable is required');
    process.exit(1);
  }

  if (!password) {
    console.error('[ERROR] MODERATOR_PASSWORD environment variable is required');
    process.exit(1);
  }

  if (password.length < 12) {
    console.error('[ERROR] MODERATOR_PASSWORD must be at least 12 characters long');
    process.exit(1);
  }

  if (!process.env.DATABASE_URL) {
    console.error('[ERROR] DATABASE_URL environment variable is required');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    console.log(`[INFO] Creating moderator account for: ${username}`);

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    await pool.query(
      'INSERT INTO moderators (username, password_hash) VALUES ($1, $2)',
      [username.trim(), passwordHash],
    );

    console.log(`[SUCCESS] Moderator '${username}' created successfully`);
  } catch (err) {
    if (err.code === '23505') {
      console.error(`[ERROR] A moderator with username '${username}' already exists`);
      process.exit(1);
    }
    console.error('[ERROR] Failed to create moderator:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

createModerator();
