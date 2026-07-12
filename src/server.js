// Server Entry Point
require('dotenv').config();

const app = require('./app');
const pool = require('./configs/db');

const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    // Verify DB connection on startup
    const conn = await pool.getConnection();
    console.log('[DB] Kết nối MySQL thành công.');
    conn.release();

    app.listen(PORT, () => {
      console.log(`[SERVER] Đang chạy tại: http://localhost:${PORT}`);
      console.log(`[SERVER] Môi trường: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (err) {
    console.error('[DB] Lỗi kết nối MySQL:', err.message);
    process.exit(1);
  }
}

startServer();
