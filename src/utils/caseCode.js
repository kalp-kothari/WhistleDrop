'use strict';

const crypto = require('crypto');

// Unambiguous Base32 variant alphabet: 32 characters (no 0, 1, I, O to avoid
// visual confusion). Using exactly 32 symbols means byte % 32 has no modulo
// bias because 256 is evenly divisible by 32 (256 / 32 = 8).
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

// We generate 16 characters, giving 32^16 = 2^80 possible codes (~80 bits).
const CODE_LENGTH = 16;

/**
 * Generate a cryptographically random case code.
 * crypto.randomBytes(16) produces one byte per character.
 * Each byte is reduced to the range [0, 31] via byte % 32 — no bias because
 * 256 % 32 === 0, so every symbol is equally likely.
 * Format: WD-XXXX-XXXX-XXXX-XXXX
 * @returns {string}
 */
function generateCaseCode() {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let raw = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    raw += ALPHABET[bytes[i] % 32];
  }
  // Insert dashes: WD-XXXX-XXXX-XXXX-XXXX
  return `WD-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`;
}

/**
 * Compute HMAC-SHA256 of the case code using the CASE_CODE_PEPPER secret.
 * Only this hash is stored in the database — the raw code is never persisted.
 * Lookup is done via SQL WHERE case_code_hash = $1. The secret pepper makes
 * a brute-force search over case code space impractical even if the database
 * is compromised, so a separate timingSafeEqual is not required here.
 * WARNING: If CASE_CODE_PEPPER is lost or changed without migration, all
 * existing case codes become permanently untrackable.
 * @param {string} code - The raw or normalized case code.
 * @returns {string} Hex-encoded HMAC-SHA256 digest.
 */
function hashCaseCode(code) {
  return crypto
    .createHmac('sha256', process.env.CASE_CODE_PEPPER)
    .update(code)
    .digest('hex');
}

/**
 * Normalize a user-supplied case code: trim whitespace and convert to
 * uppercase so that "wd-abcd-..." and " WD-ABCD-... " both work.
 * @param {string} raw
 * @returns {string}
 */
function normalizeCaseCode(raw) {
  return String(raw).trim().toUpperCase();
}

/**
 * Validate that a normalized case code matches the expected format.
 * Pattern: WD- followed by four groups of four Base32 variant characters.
 * @param {string} code - Already normalized code.
 * @returns {boolean}
 */
function isValidCaseCodeFormat(code) {
  return /^WD-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/.test(code);
}

module.exports = { generateCaseCode, hashCaseCode, normalizeCaseCode, isValidCaseCodeFormat };
