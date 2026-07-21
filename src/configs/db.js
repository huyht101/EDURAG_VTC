// Database Connection Pool Config
const mysql = require('mysql2/promise');
require('dotenv').config();

function boundedInteger(name, fallback, minimum, maximum) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}.`);
  }
  return value;
}

const queryTimeoutMs = boundedInteger('DB_QUERY_TIMEOUT_MS', 30000, 1000, 300000);
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER || 'vtc_user',
  password: process.env.DB_PASSWORD || 'vtc_password',
  database: process.env.DB_NAME || 'edurag',
  charset: 'utf8mb4',
  timezone: 'Z',
  waitForConnections: true,
  connectionLimit: boundedInteger('DB_CONNECTION_LIMIT', 10, 1, 100),
  queueLimit: boundedInteger('DB_QUEUE_LIMIT', 50, 1, 10000),
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  connectTimeout: boundedInteger('DB_CONNECT_TIMEOUT_MS', 10000, 1000, 120000),
});

function addQueryTimeout(executor) {
  if (!executor || executor.__eduragQueryTimeoutApplied) return executor;
  for (const method of ['query', 'execute']) {
    const original = executor[method].bind(executor);
    executor[method] = (statement, values) => {
      const options = typeof statement === 'string'
        ? { sql: statement, timeout: queryTimeoutMs }
        : { ...statement, timeout: statement.timeout ?? queryTimeoutMs };
      return original(options, values);
    };
  }
  Object.defineProperty(executor, '__eduragQueryTimeoutApplied', { value: true });
  return executor;
}

const getConnection = pool.getConnection.bind(pool);
pool.getConnection = async () => addQueryTimeout(await getConnection());
addQueryTimeout(pool);
Object.defineProperty(pool, 'queryTimeoutMs', { value: queryTimeoutMs });
Object.defineProperty(pool, 'applyQueryTimeout', { value: addQueryTimeout });

module.exports = pool;
