const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);
const KEY_LENGTH = 64;

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = await scrypt(String(password), salt, KEY_LENGTH);
  return { salt, hash: Buffer.from(derived).toString('hex') };
}

async function verifyPassword(password, salt, expectedHash) {
  if (!salt || !expectedHash || !/^[a-f0-9]{128}$/i.test(String(expectedHash))) return false;
  const derived = Buffer.from(await scrypt(String(password), String(salt), KEY_LENGTH));
  const expected = Buffer.from(String(expectedHash), 'hex');
  return expected.length === derived.length && crypto.timingSafeEqual(derived, expected);
}

function createToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

module.exports = { hashPassword, verifyPassword, createToken, hashToken };
