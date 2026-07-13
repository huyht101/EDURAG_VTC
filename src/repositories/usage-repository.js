const pool = require('../configs/db');

function db(executor) {
  return executor || pool;
}

async function insertUsageCall(data, executor) {
  const [result] = await db(executor).execute(
    `INSERT INTO llm_usage_logs
      (user_id, message_id, request_id, call_index, operation_type, provider, model,
       prompt_tokens, completion_tokens, estimated_cost, currency, latency_ms, status, error_code)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.userId, data.messageId, data.requestId, data.callIndex, data.operationType,
      data.provider, data.model, data.promptTokens, data.completionTokens,
      data.estimatedCost ?? null, data.currency, data.latencyMs ?? null,
      data.status, data.errorCode ?? null
    ]
  );
  return result.insertId;
}

module.exports = { insertUsageCall };
