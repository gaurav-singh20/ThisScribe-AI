import os
import json
import logging
from typing import Literal

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ai_services.services.ai_errors import (
    AIServiceUnavailableError,
    build_ai_unavailable_payload,
)
from ai_services.services.rag_pipeline import run_rag_query_stream

router = APIRouter()
DEFAULT_TOP_K = int(os.getenv('RAG_TOP_K', '6'))
logger = logging.getLogger(__name__)


# Purpose: Pydantic model for one chat turn used as conversational memory.
# Input example: {"role": "user", "content": "What is React?"}
# Output example: Parsed object added to conversationHistory list.
# Pipeline stage: Query-time context preparation before retrieval/LLM.
class ConversationMessage(BaseModel):
    role: Literal['user', 'assistant']
    content: str = Field(..., min_length=1)


# Purpose: Pydantic request schema for query endpoint.
# Input example: {
#   "chatId": "chat-123",
#   "question": "What is React?",
#   "vectorCollection": "reactjs-basics-chat-123",
#   "conversationHistory": [{"role": "user", "content": "Summarize the PDF"}]
# }
# Output example: Parsed request object consumed by run_rag_query_stream.
# Pipeline stage: Query entry validation.
class QueryRequest(BaseModel):
    chatId: str = Field(..., min_length=1)
    question: str = Field(..., min_length=1)
    vectorCollection: str = Field(..., min_length=1)
    conversationHistory: list[ConversationMessage] = Field(default_factory=list)


# Purpose: Reference shape of final query payload emitted by the pipeline.
# Input example: Internal values after retrieval and answer generation.
# Output example: answer text + retrieved chunk count + source page metadata.
# Pipeline stage: Query/RAG response contract.
class QueryResponse(BaseModel):
    success: bool
    chatId: str
    vectorCollection: str
    answer: str
    chunksRetrieved: int
    sources: list[dict[str, object]]


@router.post("/query")
# Purpose: Query endpoint that streams RAG tokens and a final completion event.
# Input example: question "What is React?" against indexed ReactJS basics chunks.
# Output example: SSE events like
# data: {"type":"token","token":"- React ..."}
# data: {"type":"done","answer":"...","chunksRetrieved":4,"sources":[...]}
# Pipeline stage: Query + RAG answer delivery.
# Non-trivial library note: StreamingResponse keeps HTTP connection open for incremental tokens.
def query_document(payload: QueryRequest) -> StreamingResponse:
    question = payload.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="Question is required")

    # Convert Pydantic objects to plain dicts so the RAG service can process lightweight JSON-like data.
    conversation_history = [
        message.model_dump() for message in payload.conversationHistory
    ]

    # Probe first event so AI-unavailable failures can return HTTP 503 JSON before SSE starts.
    try:
        stream = run_rag_query_stream(
            vector_collection=payload.vectorCollection,
            question=question,
            top_k=DEFAULT_TOP_K,
            conversation_history=conversation_history,
        )
        first_event = next(stream)
    except StopIteration:
        return JSONResponse(
            status_code=500,
            content={"success": False, "message": "Query stream ended unexpectedly."},
        )
    except AIServiceUnavailableError:
        logger.exception('AI service unavailable while generating response')
        return JSONResponse(status_code=503, content=build_ai_unavailable_payload())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception('Unexpected query failure')
        raise HTTPException(status_code=500, detail=f"Query failed: {exc}") from exc

    # SSE generator: every yielded line becomes one server-sent event consumed by the frontend.
    def event_stream():
        first_event.setdefault("chatId", payload.chatId)
        first_event.setdefault("vectorCollection", payload.vectorCollection)
        yield f"data: {json.dumps(first_event)}\n\n"

        try:
            for event in stream:
                event.setdefault("chatId", payload.chatId)
                event.setdefault("vectorCollection", payload.vectorCollection)
                # SSE wire format: each event must be prefixed with "data:" and separated by a blank line.
                yield f"data: {json.dumps(event)}\n\n"
        except AIServiceUnavailableError:
            logger.exception('AI service became unavailable during streaming response')
            error_payload = {
                "type": "error",
                "error": build_ai_unavailable_payload()["message"],
            }
            yield f"data: {json.dumps(error_payload)}\n\n"
        except Exception as exc:
            logger.exception('Unexpected streaming query failure')
            error_payload = {"type": "error", "error": f"Query failed: {exc}"}
            yield f"data: {json.dumps(error_payload)}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")
