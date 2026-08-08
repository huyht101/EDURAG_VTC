"""
services/rag_engine.py
----------------------
Luồng RAG chính với Query Router.

Phiên bản v4 (Tuần 4):
- RAG-004: Multi-call usage tracking.
  Mỗi LLM call (router + answer) tạo 1 UsageCall entry với call_index stable.
  Node.js nhận usage_calls[] để lưu đủ vào llm_usage_logs.
  Legacy usage field giữ aggregate để backward-compatible.
- Retrieval filter: is_active == true và is_hidden == false (chỉ point đã ACK và visible).
- Citation quality: no_answer=True bắt buộc khi không có structured citation.
- CHIT_CHAT trả no_answer=True (không có indexed evidence).

Luồng:
  1. Router: phân loại câu hỏi → CHIT_CHAT hoặc RAG_REQUIRED.
  2. CHIT_CHAT → LLM trả lời giao tiếp (no_answer=True, no citation).
  3. RAG_REQUIRED → Search (is_active=true, is_hidden=false) → LLM → Citations.
  4. Không citation hợp lệ → no_answer=True (fail-closed).
"""

import json
import logging
import re
from typing import Any

# pyrefly: ignore [missing-import]
from qdrant_client import models

from core.config import get_settings
from core.database import get_qdrant_client
from core.llm_setup import get_embedding_model, get_llm, get_router_llm
from models.schemas import (
    Citation,
    ChatMessage,
    QueryIntent,
    QueryRequest,
    QueryResponse,
    UsageInfo,
    UsageCall,
)

logger = logging.getLogger(__name__)


# ══════════════════════════════════════════════════════════════════
# USAGE TRACKING HELPERS (RAG-004)
# ══════════════════════════════════════════════════════════════════

def _extract_usage_info(llm_response: Any, model_name: str) -> UsageInfo:
    """
    Trích xuất token counts từ LLM response của Gemini qua LlamaIndex.
    Fallback về 0 nếu không có usage metadata.
    """
    try:
        raw = getattr(llm_response, "raw", None)
        if raw and hasattr(raw, "usage_metadata"):
            meta = raw.usage_metadata
            return UsageInfo(
                prompt_tokens=getattr(meta, "prompt_token_count", 0) or 0,
                completion_tokens=getattr(meta, "candidates_token_count", 0) or 0,
                total_tokens=getattr(meta, "total_token_count", 0) or 0,
                model=model_name,
            )
    except Exception:
        pass
    return UsageInfo(prompt_tokens=0, completion_tokens=0, total_tokens=0, model=model_name)


def _make_usage_call(
    call_index: int,
    operation_type: str,
    model_name: str,
    usage_info: UsageInfo,
    status: str = "SUCCEEDED",
    error_code: str | None = None,
) -> UsageCall:
    """Tạo UsageCall entry từ kết quả một LLM call."""
    return UsageCall(
        call_index=call_index,
        operation_type=operation_type,
        provider="google",
        model=model_name,
        prompt_tokens=usage_info.prompt_tokens,
        completion_tokens=usage_info.completion_tokens,
        total_tokens=usage_info.total_tokens,
        status=status,
        error_code=error_code,
    )


def _aggregate_usage(usage_calls: list[UsageCall], model_name: str) -> UsageInfo:
    """
    Tính aggregate UsageInfo từ tất cả usage_calls có status=SUCCEEDED.
    Dùng cho legacy usage field.
    """
    total_prompt = sum(c.prompt_tokens for c in usage_calls if c.status == "SUCCEEDED")
    total_completion = sum(c.completion_tokens for c in usage_calls if c.status == "SUCCEEDED")
    total_tokens = sum(c.total_tokens for c in usage_calls if c.status == "SUCCEEDED")
    return UsageInfo(
        prompt_tokens=total_prompt,
        completion_tokens=total_completion,
        total_tokens=total_tokens,
        model=model_name,
    )


# ══════════════════════════════════════════════════════════════════
# BƯỚC 1: QUERY ROUTER — Phân loại ý định câu hỏi
# ══════════════════════════════════════════════════════════════════

async def _classify_intent(
    question: str,
    call_index: int,
    model_name: str,
) -> tuple[QueryIntent, UsageCall]:
    """
    Sử dụng LLM (temperature=0) để phân loại ý định câu hỏi.
    Trả về (intent, usage_call) để track đầy đủ.
    """
    router_llm = get_router_llm()

    router_prompt = (
        "Bạn là một bộ phân loại câu hỏi. Nhiệm vụ DUY NHẤT của bạn là xác định "
        "ý định của câu hỏi dưới đây.\n\n"
        "QUY TẮC:\n"
        "- Chỉ phân loại câu hỏi là CHIT_CHAT hay RAG_REQUIRED.\n"
        "- TUYỆT ĐỐI KHÔNG trả lời câu hỏi.\n"
        "- TUYỆT ĐỐI KHÔNG giải thích lý do.\n"
        "- Chỉ trả về JSON object duy nhất.\n\n"
        "ĐỊNH NGHĨA:\n"
        "- CHIT_CHAT: Câu chào hỏi, cảm ơn, tạm biệt, hỏi thăm sức khoẻ, "
        "nói chuyện phiếm, câu không cần tra cứu tài liệu.\n"
        "- RAG_REQUIRED: Câu hỏi về kiến thức, bài học, khái niệm, "
        "yêu cầu giải thích nội dung học thuật, cần tra cứu tài liệu.\n\n"
        'RESPONSE FORMAT (JSON):\n'
        '{"intent": "CHIT_CHAT"} hoặc {"intent": "RAG_REQUIRED"}\n\n'
        f'Câu hỏi: "{question}"\n\n'
        "Trả về JSON:"
    )

    usage_call: UsageCall
    try:
        response = await router_llm.acomplete(router_prompt)
        response_text = response.text.strip()

        if "```" in response_text:
            json_match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", response_text, re.DOTALL)
            if json_match:
                response_text = json_match.group(1)

        parsed = json.loads(response_text)
        intent = QueryIntent(**parsed)

        usage_info = _extract_usage_info(response, model_name)
        usage_call = _make_usage_call(call_index, "QUERY_REWRITE", model_name, usage_info)
        logger.info("[RAG] Router phân loại: %s (tokens=%d)", intent.intent, usage_info.total_tokens)

    except Exception as error:
        logger.warning(
            "Router fallback → RAG_REQUIRED: error_type=%s",
            type(error).__name__,
        )
        intent = QueryIntent(intent="RAG_REQUIRED")
        # Track router call dù thất bại
        empty_usage = UsageInfo(prompt_tokens=0, completion_tokens=0, total_tokens=0, model=model_name)
        usage_call = _make_usage_call(
            call_index, "QUERY_REWRITE", model_name, empty_usage,
            status="FAILED", error_code="QUERY_REWRITE_FAILED",
        )

    return intent, usage_call


# ══════════════════════════════════════════════════════════════════
# BƯỚC 1B: XỬ LÝ CHIT_CHAT
# ══════════════════════════════════════════════════════════════════

async def _handle_chit_chat(
    question: str,
    history: list[ChatMessage],
    call_index: int,
    model_name: str,
    router_usage_call: UsageCall,
) -> QueryResponse:
    """Xử lý câu hỏi giao tiếp bình thường (CHIT_CHAT)."""
    llm = get_llm()

    history_text = _format_history(history)

    chit_chat_prompt = (
        "Bạn là trợ lý giáo dục thân thiện tên là EduBot. "
        "Hãy trả lời câu hỏi giao tiếp sau một cách tự nhiên, "
        "vui vẻ và ngắn gọn bằng tiếng Việt.\n\n"
    )

    if history_text:
        chit_chat_prompt += f"Lịch sử hội thoại:\n{history_text}\n\n"

    chit_chat_prompt += f"Câu hỏi: {question}"

    answer_usage_call: UsageCall
    answer: str

    try:
        response = await llm.acomplete(chit_chat_prompt)
        answer = response.text.strip()
        usage_info = _extract_usage_info(response, model_name)
        answer_usage_call = _make_usage_call(call_index, "ANSWER_GENERATION", model_name, usage_info)

    except Exception as error:
        logger.error(
            "[RAG] CHIT_CHAT provider failed: error_type=%s",
            type(error).__name__,
        )
        empty_usage = UsageInfo(prompt_tokens=0, completion_tokens=0, total_tokens=0, model=model_name)
        answer_usage_call = _make_usage_call(
            call_index, "ANSWER_GENERATION", model_name, empty_usage,
            status="FAILED", error_code="ANSWER_GENERATION_FAILED",
        )
        raise

    usage_calls = [router_usage_call, answer_usage_call]
    aggregate = _aggregate_usage(usage_calls, model_name)

    return QueryResponse(
        answer=answer,
        citations=[],
        confidence="high",
        # CHIT_CHAT không có indexed evidence → no_answer=True
        no_answer=True,
        usage_calls=usage_calls,
        usage=aggregate,
    )


# ══════════════════════════════════════════════════════════════════
# HÀM CHÍNH: PROCESS QUERY
# ══════════════════════════════════════════════════════════════════

async def process_query(request: QueryRequest) -> QueryResponse:
    """
    Xử lý truy vấn với Query Router.

    Bước 1: Router — Phân loại intent → usage_calls[0].
    Bước 2: CHIT_CHAT → trả lời giao tiếp → usage_calls[1].
    Bước 3: RAG_REQUIRED → Embedding → Search (active + visible) → LLM → Citations → usage_calls[1].
    """
    settings = get_settings()
    model_name = settings.GEMINI_LLM_MODEL
    history = request.history or []

    logger.info(
        "[RAG] Bắt đầu xử lý: conv=%s, question='%s...', history=%d",
        request.conversation_id,
        request.question[:80],
        len(history),
    )

    # ── Bước 1: Query Router ──────────────────────────────────────
    intent, router_usage_call = await _classify_intent(
        request.question, call_index=1, model_name=model_name
    )

    # ── Bước 2: CHIT_CHAT ────────────────────────────────────────
    if intent.intent == "CHIT_CHAT":
        logger.info("[RAG] Intent = CHIT_CHAT")
        return await _handle_chit_chat(
            request.question, history, call_index=2,
            model_name=model_name, router_usage_call=router_usage_call,
        )

    # ── Từ đây: RAG_REQUIRED ─────────────────────────────────────
    logger.info("[RAG] Intent = RAG_REQUIRED → Bắt đầu luồng RAG")

    # ── Bước 3: Embedding câu hỏi ────────────────────────────────
    embed_model = get_embedding_model()
    try:
        question_vector = await embed_model.aget_text_embedding(request.question)
    except Exception as error:
        logger.error(
            "[RAG] Query embedding failed: error_type=%s",
            type(error).__name__,
        )
        raise

    # ── Bước 4: Search Qdrant (is_active=true, is_hidden=false) ──
    client = await get_qdrant_client()
    try:
        search_results = client.query_points(
            collection_name=settings.QDRANT_COLLECTION_NAME,
            query=question_vector,
            query_filter=_active_retrieval_filter(),
            limit=settings.TOP_K,
            with_payload=True,
        )
    except Exception as error:
        logger.error(
            "[RAG] Qdrant query failed: error_type=%s",
            type(error).__name__,
        )
        raise

    results = search_results.points
    logger.info("[RAG] Tìm thấy %d kết quả (active + visible filter)", len(results))

    # ── Bước 5: Guardrail — similarity threshold ──────────────────
    filtered_results = [r for r in results if r.score >= settings.SIMILARITY_THRESHOLD]

    if not filtered_results:
        logger.warning(
            "[RAG] Không có chunk nào vượt ngưỡng similarity %.2f",
            settings.SIMILARITY_THRESHOLD,
        )
        # Trả no_answer=True với usage đã track được (router call)
        usage_calls = [router_usage_call]
        aggregate = _aggregate_usage(usage_calls, model_name)
        return QueryResponse(
            answer="Không đủ dữ liệu/Không tìm thấy thông tin liên quan trong tài liệu hiện có.",
            citations=[],
            confidence="low",
            no_answer=True,
            usage_calls=usage_calls,
            usage=aggregate,
        )

    # ── Bước 6: Build prompt + gọi LLM ───────────────────────────
    context_text = _build_context(filtered_results)
    prompt = _build_rag_prompt(
        question=request.question,
        context=context_text,
        history=history,
    )

    llm = get_llm()
    answer_usage_call: UsageCall
    answer_text: str

    try:
        llm_response = await llm.acomplete(prompt)
        answer_text = llm_response.text.strip()
        usage_info = _extract_usage_info(llm_response, model_name)
        answer_usage_call = _make_usage_call(2, "ANSWER_GENERATION", model_name, usage_info)
        logger.info("[RAG] LLM answer tokens=%d", usage_info.total_tokens)

    except Exception as error:
        logger.error(
            "[RAG] Answer provider failed: error_type=%s",
            type(error).__name__,
        )
        empty_usage = UsageInfo(prompt_tokens=0, completion_tokens=0, total_tokens=0, model=model_name)
        answer_usage_call = _make_usage_call(
            2, "ANSWER_GENERATION", model_name, empty_usage,
            status="FAILED", error_code="ANSWER_GENERATION_FAILED",
        )
        raise

    # ── Bước 7: Trích xuất citations ─────────────────────────────
    extracted = _extract_citations(answer_text, filtered_results, request.question)
    if extracted is None:
        citations = []
    else:
        answer_text, citations = extracted
    confidence = _evaluate_confidence(filtered_results)

    usage_calls = [router_usage_call, answer_usage_call]
    aggregate = _aggregate_usage(usage_calls, model_name)

    result = _finalize_rag_answer(answer_text, citations, confidence, usage_calls, aggregate)
    logger.info(
        "[RAG] ✓ Hoàn tất: no_answer=%s, citations=%d, total_tokens=%d",
        result.no_answer, len(result.citations), aggregate.total_tokens,
    )
    return result


# ══════════════════════════════════════════════════════════════════
# HÀM PHỤ TRỢ
# ══════════════════════════════════════════════════════════════════

def _finalize_rag_answer(
    answer: str,
    citations: list[Citation],
    confidence: str,
    usage_calls: list[UsageCall],
    aggregate: UsageInfo,
) -> QueryResponse:
    """
    Quyết định final response.
    - Không có citation hợp lệ → fail-closed → no_answer=True.
    - Có citation → normal RAG answer với no_answer=False.
    """
    if not citations:
        logger.warning("[RAG] Answer không có citation hợp lệ → no_answer=True")
        return QueryResponse(
            answer="Không đủ dữ liệu có thể trích dẫn để trả lời an toàn.",
            citations=[],
            confidence="low",
            no_answer=True,
            usage_calls=usage_calls,
            usage=aggregate,
        )
    return QueryResponse(
        answer=answer,
        citations=citations,
        confidence=confidence,
        no_answer=False,
        usage_calls=usage_calls,
        usage=aggregate,
    )


def _format_history(history: list[ChatMessage]) -> str:
    """Format history thành text cho prompt."""
    if not history:
        return ""
    parts = []
    for msg in history[-6:]:  # Chỉ lấy 6 tin nhắn gần nhất
        role_label = "Người dùng" if msg.role == "user" else "Trợ lý"
        parts.append(f"{role_label}: {msg.content}")
    return "\n".join(parts)


def _build_context(results: list[Any]) -> str:
    """Xây dựng đoạn context từ kết quả Qdrant."""
    context_parts = []
    for idx, result in enumerate(results, start=1):
        payload = result.payload
        text = payload.get("text", "")
        doc_id = payload.get("doc_id", "N/A")
        page = payload.get("page_number")
        chapter = payload.get("chapter", "")
        section = payload.get("section", "")

        meta_parts = [f"Tài liệu: {doc_id}"]
        if page is not None:
            meta_parts.append(f"Trang: {page}")
        if chapter:
            meta_parts.append(f"Chương: {chapter}")
        if section:
            meta_parts.append(f"Mục: {section}")

        meta_line = ", ".join(meta_parts)
        context_parts.append(f"[{idx}] ({meta_line})\n{text}")

    return "\n\n---\n\n".join(context_parts)


def _active_retrieval_filter() -> models.Filter:
    """Fail closed: legacy/missing is_active and hidden points are not retrievable."""
    return models.Filter(
        must=[
            models.FieldCondition(
                key="is_active",
                match=models.MatchValue(value=True),
            )
        ],
        must_not=[
            models.FieldCondition(
                key="is_hidden",
                match=models.MatchValue(value=True),
            )
        ],
    )


def _build_rag_prompt(
    question: str,
    context: str,
    history: list[ChatMessage],
) -> str:
    """Xây dựng prompt RAG với history support."""
    system_instruction = (
        "Bạn là trợ lý giáo dục thông minh. Hãy tuân thủ NGHIÊM NGẶT các quy tắc sau:\n\n"
        "1. CHỈ sử dụng thông tin từ phần CONTEXT bên dưới để trả lời câu hỏi.\n"
        "2. BẮT BUỘC trích dẫn nguồn ở định dạng [1], [2], ... đằng sau mỗi ý "
        "tương ứng với số thứ tự trong CONTEXT.\n"
        "3. KHÔNG ĐƯỢC tự bịa thông tin hoặc sử dụng kiến thức bên ngoài.\n"
        "4. Nếu CONTEXT không đủ thông tin để trả lời, hãy nói rõ ràng rằng "
        "không tìm thấy thông tin.\n"
        "5. Trả lời bằng tiếng Việt, rõ ràng, có cấu trúc. Được phép và nên dùng "
        "Markdown khi giúp nội dung dễ hiểu hơn: bảng, danh sách, **in đậm**, "
        "code inline và fenced code block.\n"
        "6. Với công thức toán, dùng LaTeX: `$...$` cho công thức inline và "
        "`$$...$$` cho công thức dạng khối. Giữ nguyên ký hiệu LaTeX, không escape "
        "dấu `$` hoặc dấu `\\` và không đặt công thức trong code block.\n"
        "7. Không xuất raw HTML, khối `edurag-chart`, chart JSON hoặc structured "
        "visualizations. Chỉ trả nội dung văn bản Markdown trong field answer.\n"
    )

    history_text = _format_history(history)
    history_section = ""
    if history_text:
        history_section = (
            f"--- LỊCH SỬ HỘI THOẠI ---\n"
            f"{history_text}\n"
            f"--- HẾT LỊCH SỬ ---\n\n"
        )

    full_prompt = (
        f"{system_instruction}\n"
        f"{history_section}"
        f"--- CONTEXT ---\n"
        f"{context}\n"
        f"--- HẾT CONTEXT ---\n\n"
        f"Câu hỏi: {question}\n\n"
        f"Hãy trả lời câu hỏi trên dựa HOÀN TOÀN vào CONTEXT. "
        f"Nhớ trích dẫn nguồn [1], [2], ... sau mỗi ý."
    )

    return full_prompt


def _extract_citations(
    answer: str,
    results: list[Any],
    question: str = "",
) -> tuple[str, list[Citation]] | None:
    """
    Resolve valid Markdown citation markers without rewriting unrelated syntax.

    Numeric markers inside inline/fenced code or attached to an identifier are
    ignored. Out-of-range markers are removed individually so they cannot be
    rendered as fabricated citations; other valid markers remain usable.
    """
    marker_pattern = re.compile(r"(?<!\w)\[(\d+)\]", flags=re.UNICODE)
    protected_ranges = _markdown_code_ranges(answer)

    def is_protected(position: int) -> bool:
        return any(start <= position < end for start, end in protected_ranges)

    matches = [
        match for match in marker_pattern.finditer(answer)
        if not is_protected(match.start())
    ]
    if not matches:
        return None

    referenced_indices: list[int] = []
    seen: set[int] = set()
    for match in matches:
        idx = int(match.group(1))
        if not 1 <= idx <= len(results) or not _has_citable_source(results[idx - 1]):
            continue
        if idx not in seen:
            seen.add(idx)
            referenced_indices.append(idx)

    if not referenced_indices:
        return None

    marker_map = {
        original_idx: citation_idx
        for citation_idx, original_idx in enumerate(referenced_indices, start=1)
    }

    def replace_marker(match: re.Match) -> str:
        if is_protected(match.start()):
            return match.group(0)
        mapped = marker_map.get(int(match.group(1)))
        return f"[{mapped}]" if mapped is not None else ""

    normalized_answer = marker_pattern.sub(replace_marker, answer)

    citations = []
    for idx in referenced_indices:
        result = results[idx - 1]
        payload = result.payload
        page_number = payload.get("page_number")
        if page_number is not None:
            try:
                page_number = int(page_number)
                if page_number < 1:
                    page_number = None
            except (ValueError, TypeError):
                page_number = None

        citations.append(
            Citation(
                vector_node_id=str(result.id),
                doc_id=str(payload.get("doc_id", "unknown")),
                page_number=page_number,
                snippet=_select_relevant_snippet(
                    text=payload.get("text", ""),
                    question=question,
                    answer=answer,
                ),
                chapter=payload.get("chapter") or None,
                section=payload.get("section") or None,
            )
        )
    return normalized_answer, citations


def _has_citable_source(result: Any) -> bool:
    payload = getattr(result, "payload", None)
    if not isinstance(payload, dict) or getattr(result, "id", None) is None:
        return False
    return bool(str(payload.get("doc_id") or "").strip() and str(payload.get("text") or "").strip())


def _markdown_code_ranges(answer: str) -> list[tuple[int, int]]:
    """Return inline/fenced-code ranges, including unclosed spans to end-of-answer."""
    ranges: list[tuple[int, int]] = []
    index = 0
    length = len(answer)
    while index < length:
        if answer.startswith("```", index) or answer.startswith("~~~", index):
            fence = answer[index:index + 3]
            end = answer.find(fence, index + 3)
            end = length if end < 0 else end + 3
            ranges.append((index, end))
            index = end
            continue
        if answer[index] == "`":
            end = answer.find("`", index + 1)
            end = length if end < 0 else end + 1
            ranges.append((index, end))
            index = end
            continue
        index += 1
    return ranges


def _select_relevant_snippet(
    text: str,
    question: str,
    answer: str,
    max_chars: int = 500,
) -> str:
    """Chọn đoạn nguồn liên quan nhất, không sinh hoặc diễn giải lại nội dung."""
    text = text.strip()
    if not text:
        return ""
    if len(text) <= 220:
        return text
    segments = [
        segment.strip()
        for segment in re.split(r"(?<=[.!?])\s+|\n+", text)
        if segment.strip()
    ]
    if not segments:
        return text[:max_chars].strip()
    stop_words = {
        "các", "cho", "của", "được", "hay", "khi", "là", "một", "này",
        "những", "phần", "qua", "sau", "theo", "thì", "trong", "trên",
        "vào", "và", "với", "tài", "liệu",
    }

    def keywords(value: str) -> set[str]:
        return {
            word
            for word in re.findall(r"\w+", value.lower(), flags=re.UNICODE)
            if len(word) > 2 and word not in stop_words and not word.isdigit()
        }

    question_words = keywords(question)
    answer_words = keywords(re.sub(r"\[\d+\]", "", answer))

    def score(segment: str) -> tuple[int, int]:
        words = keywords(segment)
        return 3 * len(words & question_words) + len(words & answer_words), -len(segment)

    best_index = max(range(len(segments)), key=lambda index: score(segments[index]))
    selected = segments[best_index]
    if len(selected) > max_chars:
        relevant_words = question_words | answer_words
        positions = [
            match.start()
            for match in re.finditer(r"\w+", selected.lower(), flags=re.UNICODE)
            if match.group(0) in relevant_words
        ]
        center = positions[0] if positions else 0
        start = max(0, center - max_chars // 3)
        end = min(len(selected), start + max_chars)
        selected = selected[max(0, end - max_chars):end]
    left = best_index - 1
    right = best_index + 1
    while len(selected) < 220 and (left >= 0 or right < len(segments)):
        candidates = []
        if left >= 0:
            candidates.append(("left", segments[left]))
        if right < len(segments):
            candidates.append(("right", segments[right]))
        side, candidate = max(candidates, key=lambda item: score(item[1]))
        combined = f"{candidate}\n{selected}" if side == "left" else f"{selected}\n{candidate}"
        if len(combined) > max_chars:
            break
        selected = combined
        if side == "left":
            left -= 1
        else:
            right += 1
    return selected[:max_chars].strip()


def _evaluate_confidence(results: list[Any]) -> str:
    """Đánh giá mức độ tin cậy dựa trên similarity score."""
    if not results:
        return "low"
    avg_score = sum(r.score for r in results) / len(results)
    if avg_score >= 0.7:
        return "high"
    elif avg_score >= 0.5:
        return "medium"
    else:
        return "low"
