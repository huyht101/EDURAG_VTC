const pool = require('../configs/db');

function dateFilter(alias, from, to) {
  const conditions = [];
  const params = [];
  if (from) { conditions.push(`${alias}.created_at >= ?`); params.push(from); }
  if (to) { conditions.push(`${alias}.created_at < ?`); params.push(to); }
  return { where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', params };
}

async function documentCounts(from, to) {
  const filter = dateFilter('d', from, to);
  const [rows] = await pool.execute(
    `SELECT processing_status, visibility_status, COUNT(*) AS total
     FROM documents d ${filter.where}
     GROUP BY processing_status, visibility_status`,
    filter.params
  );
  return rows;
}

async function entityCounts(from, to) {
  const result = {};
  for (const [key, table, alias] of [
    ['sessions', 'chat_sessions', 's'],
    ['messages', 'chat_messages', 'm'],
    ['citations', 'citations', 'c']
  ]) {
    const filter = dateFilter(alias, from, to);
    const [rows] = await pool.execute(
      `SELECT COUNT(*) AS total FROM ${table} ${alias} ${filter.where}`,
      filter.params
    );
    result[key] = Number(rows[0].total);
  }
  return result;
}

async function usageSummary(from, to) {
  const filter = dateFilter('u', from, to);
  const [totals] = await pool.execute(
    `SELECT COUNT(*) AS calls,
            COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
            COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
            COALESCE(SUM(total_tokens), 0) AS total_tokens
     FROM llm_usage_logs u ${filter.where}`,
    filter.params
  );
  const [breakdown] = await pool.execute(
    `SELECT provider, model, status, currency, COUNT(*) AS calls,
            COALESCE(SUM(total_tokens), 0) AS total_tokens,
            SUM(estimated_cost) AS estimated_cost
     FROM llm_usage_logs u ${filter.where}
     GROUP BY provider, model, status, currency
     ORDER BY provider, model, status, currency`,
    filter.params
  );
  return { totals: totals[0], breakdown };
}

module.exports = { documentCounts, entityCounts, usageSummary };
