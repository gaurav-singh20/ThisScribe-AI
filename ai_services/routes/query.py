import os
import json
from typing import Literal

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ai_services.services.rag_pipeline import run_rag_query_stream

router = APIRouter()
DEFAULT_TOP_K = int(os.getenv('RAG_TOP_K', '6'))


class ConversationMessage(BaseModel):
    role: Literal['user', 'assistant']
    content: str = Field(..., min_length=1)


class QueryRequest(BaseModel):
    chatId: str = Field(..., min_length=1)
    question: str = Field(..., min_length=1)
    vectorCollection: str = Field(..., min_length=1)
    conversationHistory: list[ConversationMessage] = Field(default_factory=list)


class QueryResponse(BaseModel):
    success: bool
    chatId: str
    vectorCollection: str
    answer: str
    chunksRetrieved: int
    sources: list[dict[str, object]]


@router.post("/query")
def query_document(payload: QueryRequest) -> StreamingResponse:
    question = payload.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="Question is required")

    conversation_history = [
        message.model_dump() for message in payload.conversationHistory
    ]

    def event_stream():
        try:
            stream = run_rag_query_stream(
                vector_collection=payload.vectorCollection,
                question=question,
                top_k=DEFAULT_TOP_K,
                conversation_history=conversation_history,
            )
            for event in stream:
                event.setdefault("chatId", payload.chatId)
                event.setdefault("vectorCollection", payload.vectorCollection)
                yield f"data: {json.dumps(event)}\n\n"
        except ValueError as exc:
            error_payload = {"type": "error", "error": str(exc)}
            yield f"data: {json.dumps(error_payload)}\n\n"
        except Exception as exc:
            error_payload = {"type": "error", "error": f"Query failed: {exc}"}
            yield f"data: {json.dumps(error_payload)}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")
