const dashboardRepo = require('../repositories/dashboard-repository');

async function summary(query) {
  const from = query.from ? new Date(query.from) : null;
  const to = query.to ? new Date(query.to) : null;
  const [documents, entities, usage] = await Promise.all([
    dashboardRepo.documentCounts(from, to),
    dashboardRepo.entityCounts(from, to),
    dashboardRepo.usageSummary(from, to)
  ]);
  return {
    range: { from, to },
    documents,
    chat: entities,
    usage: {
      scope: 'LLM_CALLS_ONLY',
      totals: {
        calls: Number(usage.totals.calls),
        promptTokens: Number(usage.totals.prompt_tokens),
        completionTokens: Number(usage.totals.completion_tokens),
        totalTokens: Number(usage.totals.total_tokens)
      },
      breakdown: usage.breakdown.map((row) => ({
        provider: row.provider,
        model: row.model,
        status: row.status,
        currency: row.currency,
        calls: Number(row.calls),
        totalTokens: Number(row.total_tokens),
        estimatedCost: row.estimated_cost
      }))
    }
  };
}

module.exports = { summary };
