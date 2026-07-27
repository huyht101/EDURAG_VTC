const fs = require('fs/promises');
const path = require('path');

const pool = require('../src/configs/db');

function splitStatements(sql) {
  const statements = [];
  let current = '';
  let quote = null;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const next = sql[index + 1];
    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (!quote && char === '-' && next === '-' && /\s/.test(sql[index + 2] || '')) {
      lineComment = true;
      index += 1;
      continue;
    }
    if (!quote && char === '/' && next === '*') {
      blockComment = true;
      index += 1;
      continue;
    }
    if (quote) {
      current += char;
      if (char === '\\') {
        current += sql[index + 1] || '';
        index += 1;
      } else if (char === quote) {
        if (sql[index + 1] === quote) {
          current += sql[index + 1];
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (['\'', '"', '`'].includes(char)) {
      quote = char;
      current += char;
    } else if (char === ';') {
      if (current.trim()) statements.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}

async function run() {
  const connection = await pool.getConnection();
  let lockAcquired = false;
  try {
    const [lockRows] = await connection.query(
      "SELECT GET_LOCK('edurag_schema_migrations', 30) AS acquired"
    );
    lockAcquired = Number(lockRows[0].acquired) === 1;
    if (!lockAcquired) throw new Error('Could not acquire schema migration lock.');
    await connection.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
        name VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        CONSTRAINT pk_schema_migrations PRIMARY KEY (name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`
    );
    const directory = path.resolve(__dirname, '../src/database/migrations');
    const files = (await fs.readdir(directory))
      .filter((name) => name.endsWith('.sql'))
      .sort();
    for (const name of files) {
      const [rows] = await connection.execute(
        'SELECT 1 FROM schema_migrations WHERE name = ?',
        [name]
      );
      if (rows.length) {
        console.log(`[MIGRATION] SKIP ${name}`);
        continue;
      }
      const sql = await fs.readFile(path.join(directory, name), 'utf8');
      for (const statement of splitStatements(sql)) await connection.query(statement);
      await connection.execute('INSERT INTO schema_migrations (name) VALUES (?)', [name]);
      console.log(`[MIGRATION] APPLIED ${name}`);
    }
  } finally {
    if (lockAcquired) {
      await connection.query("SELECT RELEASE_LOCK('edurag_schema_migrations')");
    }
    connection.release();
    await pool.end();
  }
}

if (require.main === module) {
  run().catch((error) => {
    console.error('[MIGRATION] FAILED:', error.message);
    process.exitCode = 1;
  });
}

module.exports = { run, splitStatements };
