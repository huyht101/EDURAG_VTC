const crypto = require('crypto');

const ragConfig = require('../configs/rag');
const withTransaction = require('../database/transaction');
const sessionRepo = require('../repositories/chat-session-repository');
const messageRepo = require('../repositories/chat-message-repository');
const chunkRepo = require('../repositories/document-chunk-repository');
const citationRepo = require('../repositories/citation-repository');
const usageRepo = require('../repositories/usage-repository');
const { getRagClient } = require('../clients/rag-client');
const appError = require('../utils/app-error');

const USAGE_OPERATIONS = ['QUERY_REWRITE', 'ANSWER_GENERATION', 'REFINE', 'OTHER'];
const USAGE_STATUSES = ['SUCCEEDED', 'FAILED'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseId(value, name) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw appError(400, 'INVALID_ID', `${name} không hợp lệ.`);
  return id;
}

function publicSession(session) {
  return {
    id: session.id,
    title: session.title,
    lastMessageAt: session.last_message_at,
    createdAt: session.created_at,
    updatedAt: session.updated_at
  };
}

function publicCitation(row) {
  return {
    id: row.id,
    messageId: row.message_id,
    documentId: row.document_id,
    chunkId: row.chunk_id,
    citationOrder: row.citation_order,
    documentTitle: row.document_title_snapshot,
    pageNumber: row.page_number_snapshot,
    sectionTitle: row.section_title_snapshot,
    sourceText: row.source_text_snapshot,
    sourceLocator: row.source_locator_snapshot,
    retrievalScore: row.retrieval_score,
    rerankScore: row.rerank_score
  };
}

function publicMessage(row, citations = []) {
  return {
    id: row.id,
    sessionId: row.session_id,
    senderType: row.sender_type,
    messageOrder: row.message_order,
    content: row.content,
    status: row.status,
    noAnswer: Boolean(row.no_answer),
    clientRequestId: row.client_request_id,
    errorCode: row.error_code,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    citations
  };
}

async function createSession(user, body = {}) {
  const id = await sessionRepo.createSession(user.id, body.title?.trim() || null);
  return publicSession(await sessionRepo.findById(id));
}

async function listSessions(user, query) {
  const offset = Math.max(0, Number.parseInt(query.offset, 10) || 0);
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || 20));
  const result = await sessionRepo.listSessions(user.id, offset, limit);
  return { offset, limit, total: result.total, sessions: result.sessions.map(publicSession) };
}

async function requireSession(user, idValue) {
  const id = parseId(idValue, 'session id');
  const session = await sessionRepo.findOwnedById(id, user.id);
  if (!session || session.deleted_at) throw appError(404, 'CHAT_SESSION_NOT_FOUND', 'Không tìm thấy chat session.');
  return session;
}

async function getHistory(user, idValue, query = {}) {
  const session = await requireSession(user, idValue);
  const offset = Math.max(0, Number.parseInt(query.offset, 10) || 0);
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || 50));
  const result = await messageRepo.listMessages(session.id, offset, limit);
  const citations = await citationRepo.listByMessageIds(result.messages.map((message) => message.id));
  const byMessage = new Map();
  for (const citation of citations) {
    const list = byMessage.get(citation.message_id) || [];
    list.push(publicCitation(citation));
    byMessage.set(citation.message_id, list);
  }
  return {
    session: publicSession(session),
    offset,
    limit,
    total: result.total,
    messages: result.messages.map((message) => publicMessage(message, byMessage.get(message.id) || []))
  };
}

async function deleteSession(user, idValue) {
  const id = parseId(idValue, 'session id');
  await withTransaction(async (connection) => {
    const session = await sessionRepo.findOwnedByIdForUpdate(id, user.id, connection);
    if (!session || session.deleted_at) throw appError(404, 'CHAT_SESSION_NOT_FOUND', 'Không tìm thấy chat session.');
    await sessionRepo.softDelete(id, connection);
  });
}

async function duplicateResult(pair) {
  const citations = pair.assistant_message_id
    ? await citationRepo.listByMessageIds([pair.assistant_message_id]) : [];
  return {
    duplicate: true,
    clientRequestId: pair.client_request_id,
    userMessageId: pair.user_message_id,
    assistantMessage: pair.assistant_message_id ? {
      id: pair.assistant_message_id,
      status: pair.assistant_status,
      content: pair.answer,
      noAnswer: Boolean(pair.no_answer),
      errorCode: pair.error_code,
      citations: citations.map(publicCitation)
    } : null
  };
}

function resolveClientRequestId(value) {
  if (value === undefined || value === null) return crypto.randomUUID();
  if (typeof value !== 'string') {
    throw appError(400, 'VALIDATION_ERROR', 'clientRequestId phải là UUID.');
  }
  const normalized = value.trim();
  return normalized || crypto.randomUUID();
}

function normalizeSourceLocator(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch (_error) { return null; }
}

async function mapCitations(sources) {
  if (!sources.length) return [];
  if (sources.length > 100) {
    throw appError(502, 'RAG_SOURCE_INVALID', 'RAG trả quá nhiều sources cho một answer.');
  }
  const vectorIds = [...new Set(sources.map((source) => source.vectorNodeId))];
  if (vectorIds.some((id) => !UUID.test(id || ''))) {
    throw appError(502, 'RAG_SOURCE_INVALID', 'RAG source thiếu vectorNodeId.');
  }
  const rows = await chunkRepo.findByVectorNodeIds(vectorIds);
  const byVector = new Map(rows.map((row) => [row.vector_node_id, row]));
  return sources.map((source, index) => {
    const row = byVector.get(source.vectorNodeId);
    const pageNumber = source.pageNumber ?? row?.page_number ?? null;
    const sectionTitle = source.sectionTitle ?? row?.section_title ?? null;
    const sourceLocator = source.sourceLocator ?? normalizeSourceLocator(row?.source_locator);
    const scores = [source.retrievalScore, source.rerankScore]
      .filter((value) => value !== undefined && value !== null);
    if (!row || row.processing_status !== 'READY' || row.visibility_status !== 'VISIBLE'
      || typeof source.sourceText !== 'string' || !source.sourceText
      || Buffer.byteLength(source.sourceText, 'utf8') > 65535
      || (pageNumber !== null && (!Number.isInteger(pageNumber) || pageNumber < 1))
      || (sectionTitle !== null && (typeof sectionTitle !== 'string' || sectionTitle.length > 500))
      || (sourceLocator !== null && (typeof sourceLocator !== 'object' || Array.isArray(sourceLocator)))
      || scores.some((value) => !Number.isFinite(Number(value)))) {
      throw appError(502, 'RAG_SOURCE_UNVERIFIABLE', 'Không thể xác minh structured source từ RAG service.');
    }
    return {
      documentId: row.document_id,
      chunkId: row.id,
      vectorNodeId: row.vector_node_id,
      citationOrder: index + 1,
      documentTitle: row.document_title,
      pageNumber,
      sectionTitle,
      sourceText: source.sourceText,
      sourceLocator,
      retrievalScore: source.retrievalScore === undefined || source.retrievalScore === null
        ? null : Number(source.retrievalScore),
      rerankScore: source.rerankScore === undefined || source.rerankScore === null
        ? null : Number(source.rerankScore)
    };
  });
}

function normalizeUsageCalls(calls, requestId) {
  if (calls.length > 100) {
    throw appError(502, 'RAG_USAGE_INVALID', 'RAG trả quá nhiều usage calls.');
  }
  const callIndexes = new Set();
  return calls.map((call, index) => {
    const operationType = call.operationType;
    const status = call.status || 'SUCCEEDED';
    const promptTokens = Number(call.promptTokens || 0);
    const completionTokens = Number(call.completionTokens || 0);
    const estimatedCost = call.estimatedCost === null || call.estimatedCost === undefined
      ? null : Number(call.estimatedCost);
    const callIndex = Number.isInteger(call.callIndex) && call.callIndex >= 1 ? call.callIndex : index + 1;
    const latencyMs = call.latencyMs === null || call.latencyMs === undefined
      ? null : Number(call.latencyMs);
    if (!USAGE_OPERATIONS.includes(operationType) || !USAGE_STATUSES.includes(status)
      || typeof call.provider !== 'string' || !call.provider || call.provider.length > 50
      || typeof call.model !== 'string' || !call.model || call.model.length > 150
      || !Number.isInteger(promptTokens) || promptTokens < 0
      || !Number.isInteger(completionTokens) || completionTokens < 0
      || callIndex > 65535 || callIndexes.has(callIndex)
      || promptTokens > 4294967295 || completionTokens > 4294967295
      || (latencyMs !== null
        && (!Number.isSafeInteger(latencyMs) || latencyMs < 0 || latencyMs > 4294967295))
      || (call.errorCode !== undefined && call.errorCode !== null
        && (typeof call.errorCode !== 'string' || call.errorCode.length > 64))) {
      throw appError(502, 'RAG_USAGE_INVALID', 'RAG usage metadata không hợp lệ.');
    }
    callIndexes.add(callIndex);
    if (estimatedCost !== null && (!Number.isFinite(estimatedCost) || estimatedCost < 0)) {
      throw appError(502, 'RAG_USAGE_INVALID', 'RAG estimatedCost không hợp lệ.');
    }
    if (!/^[A-Z]{3}$/.test(call.currency || 'USD')) {
      throw appError(502, 'RAG_USAGE_INVALID', 'RAG usage currency không hợp lệ.');
    }
    return {
      requestId,
      callIndex,
      operationType,
      provider: call.provider,
      model: call.model,
      promptTokens,
      completionTokens,
      estimatedCost,
      currency: call.currency || 'USD',
      latencyMs,
      status,
      errorCode: call.errorCode ?? null
    };
  });
}

async function markAssistantFailed(assistantMessageId, errorCode) {
  try {
    await messageRepo.updateAssistantFailed(assistantMessageId, errorCode);
  } catch (_error) {
    // Preserve the original failure; a later reconciliation can inspect a PENDING row.
  }
}

async function sendMessage(user, idValue, body) {
  const sessionId = parseId(idValue, 'session id');
  const question = body.content.trim();
  const requestId = resolveClientRequestId(body.clientRequestId);
  let prepared;
  for (let attempt = 1; attempt <= 3 && !prepared; attempt += 1) {
    try {
      prepared = await withTransaction(async (connection) => {
        const session = await sessionRepo.findOwnedByIdForUpdate(sessionId, user.id, connection);
        if (!session || session.deleted_at) throw appError(404, 'CHAT_SESSION_NOT_FOUND', 'Không tìm thấy chat session.');
        const duplicate = await messageRepo.findRequestPair(requestId, connection);
        if (duplicate) {
          if (Number(duplicate.session_id) !== sessionId) {
            throw appError(409, 'CLIENT_REQUEST_ID_CONFLICT', 'clientRequestId đã được dùng cho session khác.');
          }
          if (duplicate.assistant_status === 'PENDING' && duplicate.assistant_message_id) {
            const recovered = await messageRepo.failStalePending(
              duplicate.assistant_message_id,
              ragConfig.pendingTimeoutMs,
              connection
            );
            if (recovered) {
              duplicate.assistant_status = 'FAILED';
              duplicate.error_code = 'RAG_PENDING_TIMEOUT';
            }
          }
          return { duplicate };
        }
        const userOrder = await messageRepo.nextMessageOrder(sessionId, connection);
        const userMessageId = await messageRepo.insertMessage({
          sessionId,
          senderType: 'USER',
          messageOrder: userOrder,
          content: question,
          status: 'COMPLETED',
          clientRequestId: requestId,
          completedAt: new Date()
        }, connection);
        const assistantMessageId = await messageRepo.insertMessage({
          sessionId,
          senderType: 'ASSISTANT',
          messageOrder: userOrder + 1,
          content: null,
          status: 'PENDING'
        }, connection);
        return { userOrder, userMessageId, assistantMessageId };
      });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY' || error.code === 'ER_LOCK_DEADLOCK') {
        const duplicate = await messageRepo.findRequestPair(requestId);
        if (duplicate) {
          if (Number(duplicate.session_id) === sessionId) return duplicateResult(duplicate);
          throw appError(409, 'CLIENT_REQUEST_ID_CONFLICT', 'clientRequestId đã được dùng cho session khác.');
        }
        if (error.code === 'ER_LOCK_DEADLOCK' && attempt < 3) {
          await new Promise((resolve) => setTimeout(resolve, 20 * attempt));
          continue;
        }
      }
      throw error;
    }
  }

  if (prepared.duplicate) return duplicateResult(prepared.duplicate);

  const history = await messageRepo.loadHistoryWindow(
    sessionId,
    prepared.userOrder,
    Math.min(100, Math.max(1, ragConfig.historyMessageLimit))
  );

  let result;
  try {
    result = await getRagClient().query({
      requestId,
      userId: String(user.id),
      sessionId: String(sessionId),
      question,
      history: history.map((message) => ({ role: message.sender_type, content: message.content }))
    });
  } catch (error) {
    await markAssistantFailed(prepared.assistantMessageId, error.code || 'RAG_QUERY_FAILED');
    throw error;
  }

  if (!result.noAnswer && (typeof result.answer !== 'string' || !result.answer || result.answer.length > 1000000)) {
    await markAssistantFailed(prepared.assistantMessageId, 'RAG_ANSWER_INVALID');
    throw appError(502, 'RAG_ANSWER_INVALID', 'RAG answer không hợp lệ.');
  }
  if (!result.noAnswer && (!Array.isArray(result.sources) || result.sources.length === 0)) {
    await markAssistantFailed(prepared.assistantMessageId, 'RAG_CITATIONS_REQUIRED');
    throw appError(502, 'RAG_CITATIONS_REQUIRED', 'RAG answer phải có ít nhất một structured citation.');
  }

  try {
    const citations = result.noAnswer ? [] : await mapCitations(result.sources || []);
    const usageCalls = normalizeUsageCalls(result.usageCalls || [], requestId);
    await withTransaction(async (connection) => {
      const completed = await messageRepo.updateAssistantCompleted(prepared.assistantMessageId, {
        content: result.answer,
        noAnswer: result.noAnswer
      }, connection);
      if (!completed) throw appError(409, 'ASSISTANT_NOT_PENDING', 'Assistant message không còn ở trạng thái PENDING.');
      for (const citation of citations) {
        await citationRepo.insertCitation({ ...citation, messageId: prepared.assistantMessageId }, connection);
      }
      for (const usage of usageCalls) {
        await usageRepo.insertUsageCall({
          ...usage,
          userId: user.id,
          messageId: prepared.assistantMessageId
        }, connection);
      }
      await sessionRepo.touch(sessionId, connection);
    });
    const persistedCitations = await citationRepo.listByMessageIds([prepared.assistantMessageId]);
    return {
      duplicate: false,
      clientRequestId: requestId,
      userMessageId: prepared.userMessageId,
      assistantMessage: {
        id: prepared.assistantMessageId,
        status: 'COMPLETED',
        content: result.answer,
        noAnswer: result.noAnswer,
        citations: persistedCitations.map(publicCitation)
      }
    };
  } catch (error) {
    await markAssistantFailed(prepared.assistantMessageId, error.code || 'ASSISTANT_PERSIST_FAILED');
    throw error;
  }
}

module.exports = {
  createSession,
  listSessions,
  getHistory,
  deleteSession,
  sendMessage,
  publicCitation
};
