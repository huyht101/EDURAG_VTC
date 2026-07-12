require('dotenv').config();

module.exports = {
  get secret() {
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
      throw new Error('JWT_SECRET must contain at least 32 characters.');
    }
    return process.env.JWT_SECRET;
  },
  expiresIn: process.env.JWT_EXPIRES_IN || '7d'
};
