const appError = require('../utils/app-error');
const { resolveSharedUploadPath } = require('../storage/shared-upload-path');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function pageNumber(value) {
  if (value === undefined || value === null || Number(value) <= 0) return null;
  return Number(value);
}

function buildIngestRequest(payload, config) {
  return {
    method: 'POST',
    path: '/api/ingest',
    body: {
      doc_id: String(payload.documentId),
      job_id: String(payload.jobId),
      attempt_count: Number(payload.attemptCount),
      subject_id: config.defaultSubjectId,
      file_path: resolveSharedUploadPath(payload.file.storageKey, config.sharedUploadDirectory),
      callback_url: config.callbackUrl,
      teacher_metadata: {}
    }
  };
}

function buildVisibilityRequest(payload, config) {
  return {
    method: 'PATCH',
    path: `/api/docs/${encodeURIComponent(String(payload.documentId))}/visibility`,
    body: {
      job_id: String(payload.jobId),
      attempt_count: Number(payload.attemptCount),
      action: payload.enabled ? 'unhide' : 'hide',
      callback_url: config.callbackUrl
    }
  };
}

function buildDeleteRequest(payload, config) {
  return {
    method: 'DELETE',
    path: `/api/ingest/${encodeURIComponent(String(payload.documentId))}`,
    body: {
      job_id: String(payload.jobId),
      attempt_count: Number(payload.attemptCount),
      callback_url: config.callbackUrl
    }
  };
}

function buildQueryRequest(payload) {
  return {
    method: 'POST',
    path: '/api/query',
    body: {
      request_id: payload.requestId,
      user_id: String(payload.userId),
      conversation_id: String(payload.sessionId),
      question: payload.question,
      history: (payload.history || []).map((message) => ({
        role: String(message.role).toLowerCase(),
        content: message.content
      }))
    }
  };
}

function responseData(payload) {
  return payload?.data && typeof payload.data === 'object' ? payload.data : payload || {};
}

function normalizeAcceptedResponse(payload, expectedJobId) {
  const result = responseData(payload);
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw appError(502, 'RAG_ACCEPTED_RESPONSE_INVALID', 'Python RAG accepted response must be an object.');
  }
  const responseJobId = result.job_id ?? result.jobId;
  if (responseJobId === undefined || responseJobId === null || String(responseJobId).trim() === '') {
    throw appError(502, 'RAG_ACCEPTED_RESPONSE_INVALID', 'Python RAG accepted response must include job_id.');
  }
  if (responseJobId !== undefined && String(responseJobId) !== String(expectedJobId)) {
    throw appError(502, 'RAG_JOB_ID_MISMATCH', 'Python RAG response job_id does not match the dispatched job.');
  }
  const status = String(result.status || '').toLowerCase();
  const accepted = result.accepted === true || status === 'accepted';
  const rejected = result.accepted === false || status === 'rejected';
  if (!accepted && !rejected) {
    throw appError(
      502,
      'RAG_ACCEPTED_RESPONSE_INVALID',
      'Python RAG accepted response must declare accepted or rejected status.'
    );
  }
  return {
    accepted: accepted && !rejected,
    completed: false,
    mode: 'remote',
    jobId: String(responseJobId)
  };
}

function normalizeCitation(citation) {
  const vectorNodeId = citation?.vector_node_id;
  const sourceText = citation?.source_text ?? citation?.snippet;
  if (!UUID.test(vectorNodeId || '') || typeof sourceText !== 'string' || !sourceText) {
    throw appError(
      502,
      'RAG_CITATION_INVALID',
      'Python citation must include vector_node_id and source_text.'
    );
  }
  return {
    vectorNodeId,
    sourceText,
    documentId: citation.doc_id ?? null,
    pageNumber: pageNumber(citation.page_number),
    sectionTitle: citation.section_title ?? citation.chapter ?? citation.section ?? null,
    sourceLocator: citation.source_locator ?? null,
    retrievalScore: citation.retrieval_score ?? null,
    rerankScore: citation.rerank_score ?? null
  };
}

function normalizeUsageCall(call, index, defaults = {}) {
  return {
    callIndex: call.call_index ?? index + 1,
    operationType: call.operation_type ?? defaults.operationType ?? 'ANSWER_GENERATION',
    provider: call.provider ?? defaults.provider ?? 'GOOGLE',
    model: call.model,
    promptTokens: call.prompt_tokens ?? call.input_tokens ?? 0,
    completionTokens: call.completion_tokens ?? call.output_tokens ?? 0,
    estimatedCost: call.estimated_cost ?? null,
    currency: call.currency ?? 'USD',
    latencyMs: call.latency_ms ?? null,
    status: call.status ?? defaults.status ?? 'SUCCEEDED',
    errorCode: call.error_code ?? null
  };
}

function normalizeQueryResult(payload) {
  const result = responseData(payload);
  if (!result || typeof result !== 'object' || Array.isArray(result)
    || typeof result.no_answer !== 'boolean'
    || typeof result.answer !== 'string'
    || !Array.isArray(result.citations)
    || (result.confidence !== undefined && result.confidence !== null
      && typeof result.confidence !== 'string')
    || (result.usage_calls !== undefined && !Array.isArray(result.usage_calls))
    || (result.usage !== undefined && result.usage !== null
      && (typeof result.usage !== 'object' || Array.isArray(result.usage)))) {
    throw appError(502, 'RAG_QUERY_RESPONSE_INVALID', 'Python RAG query response has an invalid shape.');
  }
  const noAnswer = result.no_answer;
  const citations = result.citations;
  if (!noAnswer && citations.length === 0) {
    throw appError(
      502,
      'RAG_CITATIONS_REQUIRED',
      'Python RAG answer must include at least one structured citation.'
    );
  }
  let usageCalls = [];

  if (Array.isArray(result.usage_calls)) {
    usageCalls = result.usage_calls.map((call, index) => normalizeUsageCall(call, index));
  } else if (result.usage && typeof result.usage === 'object') {
    usageCalls = [normalizeUsageCall(result.usage, 0, {
      operationType: 'ANSWER_GENERATION',
      provider: 'GOOGLE',
      status: 'SUCCEEDED'
    })];
  }

  return {
    answer: result.answer === undefined ? null : result.answer,
    noAnswer,
    confidence: result.confidence ?? null,
    sources: noAnswer ? [] : citations.map(normalizeCitation),
    usageCalls
  };
}

function normalizeCallbackChunk(chunk) {
  const chunkText = chunk?.chunk_text ?? chunk?.chunkText;
  const contentHash = chunk?.content_hash ?? chunk?.contentHash;
  const hasChunkAlias = chunk?.vector_node_id === undefined
    && chunk?.vectorNodeId === undefined
    && chunk?.chunk_id !== undefined;
  if (hasChunkAlias && (typeof chunkText !== 'string' || !contentHash)) {
    throw appError(
      400,
      'RAG_CALLBACK_INCOMPLETE_MANIFEST',
      'chunk_id alias is accepted only with full chunk_text and content_hash.'
    );
  }
  return {
    chunkIndex: chunk?.chunk_index ?? chunk?.chunkIndex,
    vectorNodeId: chunk?.vector_node_id ?? chunk?.vectorNodeId ?? chunk?.chunk_id,
    chunkText,
    contentHash,
    tokenCount: chunk?.token_count ?? chunk?.tokenCount,
    pageNumber: pageNumber(chunk?.page_number ?? chunk?.pageNumber),
    sectionTitle: chunk?.section_title ?? chunk?.sectionTitle
      ?? chunk?.chapter ?? chunk?.section ?? null,
    sourceLocator: chunk?.source_locator ?? chunk?.sourceLocator ?? null
  };
}

function normalizeProcessingCallback(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw appError(400, 'RAG_CALLBACK_INVALID', 'RAG callback body must be an object.');
  }
  const chunksManifest = payload.chunks === undefined
    ? undefined
    : Array.isArray(payload.chunks) ? payload.chunks.map(normalizeCallbackChunk) : payload.chunks;
  const pythonManifest = payload.chunk_manifest === undefined
    ? undefined
    : Array.isArray(payload.chunk_manifest)
      ? payload.chunk_manifest.map(normalizeCallbackChunk)
      : payload.chunk_manifest;
  if (chunksManifest !== undefined && pythonManifest !== undefined
    && JSON.stringify(chunksManifest) !== JSON.stringify(pythonManifest)) {
    throw appError(
      400,
      'RAG_CALLBACK_MANIFEST_CONFLICT',
      'Callback chunks and chunk_manifest contain conflicting data.'
    );
  }
  const chunks = chunksManifest ?? pythonManifest;
  const rawResult = payload.result || {};
  const rawError = payload.error || {};
  return {
    jobId: payload.job_id ?? payload.jobId,
    documentId: payload.doc_id ?? payload.document_id ?? payload.documentId,
    attemptCount: payload.attempt_count ?? payload.attemptCount,
    eventType: String(payload.event_type ?? payload.eventType ?? '').toUpperCase(),
    stage: payload.stage ?? null,
    chunks,
    result: payload.result === undefined ? undefined : {
      currentStage: rawResult.current_stage ?? rawResult.currentStage,
      pipelineVersion: rawResult.pipeline_version ?? rawResult.pipelineVersion,
      parserName: rawResult.parser_name ?? rawResult.parserName,
      embeddingModel: rawResult.embedding_model ?? rawResult.embeddingModel,
      embeddingDimension: rawResult.embedding_dimension ?? rawResult.embeddingDimension,
      vectorCollection: rawResult.vector_collection ?? rawResult.vectorCollection
    },
    error: payload.error === undefined && payload.error_code === undefined
      ? undefined
      : {
        code: rawError.error_code ?? rawError.code ?? payload.error_code,
        message: rawError.message ?? payload.message ?? null
      }
  };
}

module.exports = {
  buildIngestRequest,
  buildVisibilityRequest,
  buildDeleteRequest,
  buildQueryRequest,
  normalizeAcceptedResponse,
  normalizeQueryResult,
  normalizeProcessingCallback
};
