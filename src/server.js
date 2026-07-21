// Server Entry Point
require('dotenv').config();

const app = require('./app');
const pool = require('./configs/db');

const PORT = process.env.PORT || 5000;
const SHUTDOWN_TIMEOUT_MS = Number(process.env.SHUTDOWN_TIMEOUT_MS || 10000);
if (!Number.isInteger(SHUTDOWN_TIMEOUT_MS) || SHUTDOWN_TIMEOUT_MS < 1000 || SHUTDOWN_TIMEOUT_MS > 120000) {
  throw new Error('SHUTDOWN_TIMEOUT_MS must be between 1000 and 120000.');
}
let server = null;
let shutdownPromise = null;

async function startServer() {
  try {
    // Verify DB connection on startup
    const conn = await pool.getConnection();
    console.log('[DB] Kết nối MySQL thành công.');
    conn.release();

    server = app.listen(PORT, () => {
      console.log(`[SERVER] Đang chạy tại: http://localhost:${PORT}`);
      console.log(`[SERVER] Môi trường: ${process.env.NODE_ENV || 'development'}`);
    });
    return server;
  } catch (err) {
    console.error('[DB] Lỗi kết nối MySQL:', err.message);
    process.exit(1);
  }
}

function shutdown(signal, dependencies = {}) {
  if (shutdownPromise) return shutdownPromise;
  const activeServer = dependencies.server || server;
  const db = dependencies.pool || pool;
  const timeoutMs = dependencies.timeoutMs || SHUTDOWN_TIMEOUT_MS;
  shutdownPromise = new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (typeof activeServer?.closeAllConnections === 'function') activeServer.closeAllConnections();
      resolve({ graceful: false, signal });
    }, timeoutMs);
    timer.unref();
    const closeHttp = activeServer
      ? new Promise((done) => activeServer.close(() => done()))
      : Promise.resolve();
    Promise.allSettled([closeHttp, db.end()]).then(() => {
      clearTimeout(timer);
      resolve({ graceful: true, signal });
    });
  });
  return shutdownPromise;
}

function installSignalHandlers() {
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.once(signal, () => {
      shutdown(signal).then((result) => {
        if (!result.graceful) {
          process.exit(1);
        } else {
          process.exitCode = 0;
        }
      });
    });
  }
}

if (require.main === module) {
  installSignalHandlers();
  startServer();
}

module.exports = { startServer, shutdown, installSignalHandlers };
