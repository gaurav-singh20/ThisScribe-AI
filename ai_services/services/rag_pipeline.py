# User Query
#    ↓
# Convert to embedding
#    ↓
# Search similar chunks (vector DB)
#    ↓
# Send to LLM with context
#    ↓
# Generate answer

import re

from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate
from langchain_ollama import ChatOllama

from ai_services.config import OLLAMA_MODEL, OLLAMA_URL
from ai_services.services.ai_errors import (
    AIServiceUnavailableError,
    is_ollama_unavailable_error,
)
from ai_services.services.vector_store import (
    get_collection_page_stats,
    retrieve_similar,
)

PROMPT_TEMPLATE = """You are ThisScribe AI assistant.
Answer the question using only the supplied context from the current PDF.
Treat references like "the pdf", "this document", or "the file" as the current indexed document.

Rules:
0. If the user asks about prior chat turns (for example, "what did I ask last time?"), answer from Recent conversation history.
1. If the user asks a broad question (for example, "what is in the pdf?"), provide a concise summary of the retrieved context.
2. If exact details are not present, state what is available in the context instead of asking the user for more context.
3. Do not invent facts that are not supported by the context.
4. Return the answer as bullet points for list-style questions or summaries.
5. Include page citations in the format (p. X) only when the user asks for sources/citations OR when giving a broad summary.

Recent conversation history:
{conversation_history}

Context:
{context}

Question:
{question}

Answer:
"""


# Purpose: Build one context string with page tags from retrieved documents.
# Input example: Retrieved chunks including
# "React is a JavaScript library for building user interfaces" with page metadata.
# Output example:
# - context string: "[Page 1]\nReact is a JavaScript library for building user interfaces\n\n---..."
# - pages list: [1, 3]
# Pipeline stage: Query/RAG context assembly before LLM call.
def _build_context_with_page_tags(documents: list) -> tuple[str, list[int]]:
    context_parts: list[str] = []
    pages: list[int] = []

    for doc in documents:
        metadata = doc.metadata or {}
        page = metadata.get("page")
        if isinstance(page, int):
            pages.append(page)
            tag = f"[Page {page}]"
        else:
            tag = "[Page Unknown]"

        context_parts.append(f"{tag}\n{doc.page_content}")

    unique_pages = sorted(set(pages))
    return "\n\n---\n\n".join(context_parts), unique_pages


# Purpose: Decide whether final answer should include page citations.
# Input example: question "What is React?" -> citations usually false.
# Output example: False for direct question, True for "Summarize with sources".
# Pipeline stage: Query response formatting after LLM generation.
def _needs_citations(question: str) -> bool:
    q = question.lower()
    citation_signals = [
        'source',
        'sources',
        'citation',
        'citations',
        'cite',
        'reference',
        'references',
        'according to',
    ]
    summary_signals = ['summarize', 'summary', "what's inside", 'what is inside']
    return any(token in q for token in citation_signals + summary_signals)


# Purpose: Detect if user asks total page count so system can answer from metadata without LLM.
# Input example: "How many pages are in this PDF?"
# Output example: True
# Pipeline stage: Query intent routing (fast path before vector retrieval).
def _is_page_count_question(question: str) -> bool:
    q = question.lower()
    signals = [
        'how many pages',
        'number of pages',
        'total pages',
        'page count',
    ]
    return any(token in q for token in signals)


# Purpose: Detect page lookup style questions such as "Which page explains React?".
# Input example: "Which page covers what React is?"
# Output example: True
# Pipeline stage: Query intent routing.
def _is_page_lookup_question(question: str) -> bool:
    q = question.lower()
    signals = [
        'which page',
        'what page',
        'what pages',
        'which pages',
        'on which page',
    ]
    return any(token in q for token in signals)


# Purpose: Detect "last query" questions answerable from conversation memory only.
# Input example: "What did I ask last?"
# Output example: True
# Pipeline stage: Query intent routing (conversation-memory shortcut).
def _is_last_query_question(question: str) -> bool:
    q = question.lower().strip()
    signals = [
        'what did i ask last',
        'what did i asked last',
        'what was my last query',
        'what was my previous query',
        'my previous question',
        'my last question',
        'last question i asked',
        'previous question i asked',
    ]
    return any(signal in q for signal in signals)


# Purpose: Return prior user query from conversation history when user asks for it.
# Input example:
# - question: "What was my last query?"
# - conversation_history includes {"role": "user", "content": "What is React?"}
# Output example: "- Your last query was: \"What is React?\""
# Pipeline stage: Query shortcut path (no retrieval/LLM needed).
def _answer_last_query_from_history(
    question: str,
    conversation_history: list[dict[str, str]] | None,
) -> str | None:
    if not _is_last_query_question(question):
        return None

    if not conversation_history:
        return "- I do not have any earlier user query in this chat yet."

    user_messages = [
        (message.get('content') or '').strip()
        for message in conversation_history
        if (message.get('role') or '').lower() == 'user'
        and (message.get('content') or '').strip()
    ]

    if not user_messages:
        return "- I do not have any earlier user query in this chat yet."

    return f"- Your last query was: \"{user_messages[-1]}\""


# Purpose: Expand short/ambiguous follow-up questions with recent chat context.
# Input example: "Which one is better?" after prior turn about ReactJS basics topics.
# Output example: Original question plus appended conversation hint text.
# Pipeline stage: Query preprocessing before retrieval.
def _resolve_follow_up_question(
    question: str,
    conversation_history: list[dict[str, str]] | None,
) -> str:
    q = (question or '').strip()
    if not q or not conversation_history:
        return q

    lower_q = q.lower()
    ambiguity_signals = [
        ' it ',
        ' this ',
        ' that ',
        ' these ',
        ' those ',
        'which one',
        'which is better',
        'better one',
        'what about it',
        'and this',
        'and that',
    ]

    looks_follow_up = any(signal in f" {lower_q} " for signal in ambiguity_signals)
    short_question = len(lower_q.split()) <= 8
    if not (looks_follow_up or short_question):
        return q

    prior_user = None
    prior_assistant = None
    for message in reversed(conversation_history):
        role = (message.get('role') or '').lower()
        content = (message.get('content') or '').strip()
        if not content:
            continue
        if role == 'assistant' and prior_assistant is None:
            prior_assistant = content
            continue
        if role == 'user' and prior_user is None:
            prior_user = content
        if prior_user and prior_assistant:
            break

    if not prior_user and not prior_assistant:
        return q

    context_parts = []
    if prior_user:
        context_parts.append(f"Previous user query: {prior_user}")
    if prior_assistant:
        context_parts.append(f"Previous assistant reply: {prior_assistant}")

    contextual_hint = " | ".join(context_parts)
    return f"{q}\n\nConversation context for reference: {contextual_hint}"


# Purpose: Normalize LLM answer into consistent bullet format and optional citations.
# Input example: answer "React is...", pages [1], add_citations=False.
# Output example: "- React is a JavaScript library for building user interfaces"
# Pipeline stage: Query post-processing after LLM generation.
def _format_bullets(answer: str, pages: list[int], add_citations: bool) -> str:
    clean_answer = answer.strip()
    if not clean_answer:
        return clean_answer

    lines = [line.strip() for line in clean_answer.splitlines() if line.strip()]
    content_lines: list[str] = []
    for line in lines:
        lower = line.lower()
        if lower == "references:" or re.fullmatch(r"\(p\.\s*\d+\)", lower):
            continue
        content_lines.append(line)

    if not content_lines:
        return clean_answer

    bullet_candidates = [line for line in content_lines if re.match(r"^[-*•]\s+", line)]

    if bullet_candidates:
        citation_pages = pages or ['unknown']
        rebuilt: list[str] = []
        idx = 0
        for line in content_lines:
            if re.match(r"^[-*•]\s+", line):
                text = re.sub(r"^[-*•]\s+", "", line).strip()
                text = re.sub(r"\s*\(p\.\s*\d+\)\s*$", "", text, flags=re.IGNORECASE)
                if add_citations:
                    page = citation_pages[idx % len(citation_pages)]
                    rebuilt.append(f"- {text} (p. {page})")
                else:
                    rebuilt.append(f"- {text}")
                idx += 1
            else:
                rebuilt.append(line)

        return "\n".join(rebuilt)

    if add_citations:
        citation = f"(p. {pages[0]})" if pages else "(p. unknown)"
        return f"- {content_lines[0]} {citation}"
    return f"- {content_lines[0]}"


# Purpose: Create ChatOllama client used to generate final grounded answers.
# Input example: Prompt containing retrieved ReactJS chunk + question "What is React?".
# Output example: ChatOllama model client ready for invoke()/stream().
# Pipeline stage: Query/RAG generation.
# Non-trivial library note: ChatOllama is the LLM interface; temperature controls response variability.
def _get_llm() -> ChatOllama:
    return ChatOllama(
        model=OLLAMA_MODEL,
        base_url=OLLAMA_URL,
        temperature=0.2,
    )


# Purpose: Convert structured conversation history into prompt-ready plain text.
# Input example: [{"role": "user", "content": "What is React?"}]
# Output example: "User: What is React?"
# Pipeline stage: Query context construction for prompt template.
def _build_conversation_history(conversation_history: list[dict[str, str]] | None) -> str:
    if not conversation_history:
        return "No prior conversation."

    lines: list[str] = []
    for message in conversation_history:
        role = (message.get('role') or 'user').capitalize()
        content = (message.get('content') or '').strip()
        if not content:
            continue
        lines.append(f"{role}: {content}")

    return "\n".join(lines) if lines else "No prior conversation."


# Purpose: Execute non-streaming RAG flow and return final answer payload.
# Input example:
# - vector_collection: "reactjs-basics-chat-123"
# - question: "What is React?"
# - top_k: 4
# Output example: {"answer": "- React is a JavaScript library for building user interfaces", "chunksRetrieved": 4, "sources": [{"source": "...reactjs-basics.pdf", "page": 1}]}
# Pipeline stage: Query/RAG (retrieve context then generate answer).
def run_rag_query(
    vector_collection: str,
    question: str,
    top_k: int = 4,
    conversation_history: list[dict[str, str]] | None = None,
) -> dict[str, object]:
    if not question.strip():
        raise ValueError("Question is required")

    resolved_question = _resolve_follow_up_question(question, conversation_history)

    memory_answer = _answer_last_query_from_history(question, conversation_history)
    if memory_answer is not None:
        return {
            'answer': memory_answer,
            'chunksRetrieved': 0,
            'sources': [],
        }

    # Query metadata step: read indexed page info to answer page-count/page-lookup intents quickly.
    # Example return: {'pages': [1, 2, 3], 'total_pages': 10}
    page_stats = get_collection_page_stats(vector_collection)
    collection_pages = page_stats.get('pages') or []
    declared_total_pages = page_stats.get('total_pages')

    if _is_page_count_question(question):
      resolved_total = declared_total_pages or len(collection_pages)
      if not resolved_total:
          return {
              'answer': '- I could not determine the total page count from the indexed document.',
              'chunksRetrieved': 0,
              'sources': [],
          }

      return {
          'answer': f'- The PDF has {resolved_total} pages.',
          'chunksRetrieved': 0,
          'sources': [],
      }

    # AI retrieval step: embed "What is React?" and fetch nearest chunks from Chroma.
    # Example returned chunk: Document(page_content="React is a JavaScript library for building user interfaces", metadata={"page": 1, ...})
    documents = retrieve_similar(vector_collection, resolved_question, top_k=top_k)

    if not documents:
        return {
            "answer": "I could not find relevant information in this document.",
            "chunksRetrieved": 0,
            "sources": [],
        }

    context, pages = _build_context_with_page_tags(documents)

    if _is_page_lookup_question(question):
        if not pages:
            return {
                'answer': '- I could not identify specific pages for that topic from the retrieved context.',
                'chunksRetrieved': len(documents),
                'sources': [],
            }

        page_list = ', '.join(str(page) for page in sorted(set(pages)))
        answer = f'- Relevant information appears on page(s): {page_list}.'

        sources: list[dict[str, object]] = []
        for doc in documents:
            metadata = doc.metadata or {}
            sources.append(
                {
                    'source': metadata.get('source'),
                    'page': metadata.get('page'),
                }
            )

        return {
            'answer': answer,
            'chunksRetrieved': len(documents),
            'sources': sources,
        }

    # Prompt assembly step: inject conversation history + retrieved context into one grounded prompt.
    prompt = ChatPromptTemplate.from_template(PROMPT_TEMPLATE)
    chain = prompt | _get_llm() | StrOutputParser()
    # AI generation step: LLM returns answer text constrained by retrieved PDF context.
    # Example answer before formatting: "React is a JavaScript library for building user interfaces."
    try:
        answer = chain.invoke(
            {
                "context": context,
                "question": resolved_question,
                "conversation_history": _build_conversation_history(conversation_history),
            }
        )
    except Exception as exc:
        if is_ollama_unavailable_error(exc):
            raise AIServiceUnavailableError() from exc
        raise
    answer = _format_bullets(
        answer=answer,
        pages=pages,
        add_citations=_needs_citations(question),
    )

    sources: list[dict[str, object]] = []
    for doc in documents:
        metadata = doc.metadata or {}
        sources.append(
            {
                "source": metadata.get("source"),
                "page": metadata.get("page"),
            }
        )

    return {
        "answer": answer.strip(),
        "chunksRetrieved": len(documents),
        "sources": sources,
    }


# Purpose: Split final text into simple token chunks for SSE streaming.
# Input example: "- React is a JavaScript library"
# Output example: yields "- ", "React ", "is ", ...
# Pipeline stage: Query streaming helper.
def _yield_text_tokens(text: str):
    for token in text.split(' '):
        if token:
            yield f"{token} "


# Purpose: Execute streaming RAG flow and yield incremental token + done events.
# Input example: question "What is React?" with collection from ReactJS basics PDF.
# Output example sequence:
# - {"type": "token", "token": "React "}
# - ...
# - {"type": "done", "answer": "- React is a JavaScript library for building user interfaces", "chunksRetrieved": 4, "sources": [...]}
# Pipeline stage: Query/RAG streaming API path.
def run_rag_query_stream(
    vector_collection: str,
    question: str,
    top_k: int = 4,
    conversation_history: list[dict[str, str]] | None = None,
):
    if not question.strip():
        raise ValueError("Question is required")

    resolved_question = _resolve_follow_up_question(question, conversation_history)

    memory_answer = _answer_last_query_from_history(question, conversation_history)
    if memory_answer is not None:
        for token in _yield_text_tokens(memory_answer):
            yield {"type": "token", "token": token}
        yield {
            "type": "done",
            "answer": memory_answer,
            "chunksRetrieved": 0,
            "sources": [],
        }
        return

    # Query metadata step for quick page-aware answers without LLM when possible.
    page_stats = get_collection_page_stats(vector_collection)
    collection_pages = page_stats.get('pages') or []
    declared_total_pages = page_stats.get('total_pages')

    if _is_page_count_question(question):
        resolved_total = declared_total_pages or len(collection_pages)
        answer = (
            '- I could not determine the total page count from the indexed document.'
            if not resolved_total
            else f'- The PDF has {resolved_total} pages.'
        )
        for token in _yield_text_tokens(answer):
            yield {"type": "token", "token": token}
        yield {
            "type": "done",
            "answer": answer,
            "chunksRetrieved": 0,
            "sources": [],
        }
        return

    # AI retrieval step: semantic search over indexed chunk vectors in Chroma.
    documents = retrieve_similar(vector_collection, resolved_question, top_k=top_k)
    if not documents:
        answer = "I could not find relevant information in this document."
        for token in _yield_text_tokens(answer):
            yield {"type": "token", "token": token}
        yield {
            "type": "done",
            "answer": answer,
            "chunksRetrieved": 0,
            "sources": [],
        }
        return

    context, pages = _build_context_with_page_tags(documents)
    sources: list[dict[str, object]] = []
    for doc in documents:
        metadata = doc.metadata or {}
        sources.append(
            {
                "source": metadata.get("source"),
                "page": metadata.get("page"),
            }
        )

    if _is_page_lookup_question(question):
        if not pages:
            answer = '- I could not identify specific pages for that topic from the retrieved context.'
        else:
            page_list = ', '.join(str(page) for page in sorted(set(pages)))
            answer = f'- Relevant information appears on page(s): {page_list}.'

        for token in _yield_text_tokens(answer):
            yield {"type": "token", "token": token}
        yield {
            "type": "done",
            "answer": answer,
            "chunksRetrieved": len(documents),
            "sources": sources,
        }
        return

    # Build prompt text that combines retrieved ReactJS chunks with conversation context.
    prompt = ChatPromptTemplate.from_template(PROMPT_TEMPLATE)
    prompt_value = prompt.invoke(
        {
            "context": context,
            "question": resolved_question,
            "conversation_history": _build_conversation_history(conversation_history),
        }
    )

    # AI generation step (streaming): model emits partial tokens progressively.
    llm = _get_llm()
    full_answer = ""
    # Example streamed chunk token sequence for "What is React?": "React ", "is ", "a ", ...
    try:
        for chunk in llm.stream(prompt_value):
            token = chunk.content or ""
            if not token:
                continue
            full_answer += token
            yield {"type": "token", "token": token}
    except Exception as exc:
        if is_ollama_unavailable_error(exc):
            raise AIServiceUnavailableError() from exc
        raise

    final_answer = _format_bullets(
        answer=full_answer,
        pages=pages,
        add_citations=_needs_citations(question),
    ).strip()

    yield {
        "type": "done",
        "answer": final_answer,
        "chunksRetrieved": len(documents),
        "sources": sources,
    }
