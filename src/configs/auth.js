require('dotenv').config();

function claimSetting(name, fallback) {
  const value = String(process.env[name] || fallback).trim();
  if (value.length < 3 || value.length > 200 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${name} must contain 3 to 200 printable characters.`);
  }
  return value;
}

module.exports = {
  get secret() {
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
      throw new Error('JWT_SECRET must contain at least 32 characters.');
    }
    return process.env.JWT_SECRET;
  },
  expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  algorithm: 'HS256',
  issuer: claimSetting('JWT_ISSUER', 'edurag-core'),
  audience: claimSetting('JWT_AUDIENCE', 'edurag-clients'),
  purpose: 'access'
};
