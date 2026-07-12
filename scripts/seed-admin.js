'use strict';

require('dotenv').config();

const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');

function requiredEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error('Missing required environment variable: ' + name);
  }
  return value.trim();
}

async function main() {
  const adminEmail = requiredEnv('ADMIN_EMAIL').toLowerCase();
  const adminPassword = requiredEnv('ADMIN_PASSWORD');
  const adminFullName = requiredEnv('ADMIN_FULL_NAME');
  const bcryptRounds = Number(process.env.BCRYPT_ROUNDS || 12);

  if (adminPassword.length < 12) {
    throw new Error('ADMIN_PASSWORD must contain at least 12 characters');
  }
  if (!Number.isInteger(bcryptRounds) || bcryptRounds < 10 || bcryptRounds > 15) {
    throw new Error('BCRYPT_ROUNDS must be an integer from 10 to 15');
  }

  const connection = await mysql.createConnection({
    host: requiredEnv('DB_HOST'),
    port: Number(process.env.DB_PORT || 3306),
    user: requiredEnv('DB_USER'),
    password: requiredEnv('DB_PASSWORD'),
    database: process.env.DB_NAME || 'edurag',
    charset: 'utf8mb4',
    timezone: 'Z',
  });

  try {
    await connection.beginTransaction();

    const [roleRows] = await connection.execute(
      'SELECT id FROM roles WHERE code = ? LIMIT 1',
      ['ADMIN']
    );
    if (roleRows.length !== 1) {
      throw new Error('ADMIN role is missing. Run database_setup.sql first.');
    }
    const adminRoleId = roleRows[0].id;

    const [existingRows] = await connection.execute(
      'SELECT id, role_id FROM users WHERE email = ? LIMIT 1 FOR UPDATE',
      [adminEmail]
    );

    if (existingRows.length > 0) {
      if (Number(existingRows[0].role_id) !== Number(adminRoleId)) {
        throw new Error('ADMIN_EMAIL already belongs to a non-admin account');
      }
      await connection.commit();
      console.log('Admin account already exists; no password or profile data was changed.');
      return;
    }

    const passwordHash = await bcrypt.hash(adminPassword, bcryptRounds);
    await connection.execute(
      'INSERT INTO users (role_id, full_name, email, password_hash, status, auth_version, email_verified_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))',
      [adminRoleId, adminFullName, adminEmail, passwordHash, 'ACTIVE', 1]
    );

    await connection.commit();
    console.log('Admin account created successfully.');
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error('Admin seed failed:', error.message);
  process.exitCode = 1;
});
