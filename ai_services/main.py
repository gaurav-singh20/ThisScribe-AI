from fastapi import FastAPI
from dotenv import load_dotenv

load_dotenv()

from ai_services.routes.process_document import router as process_document_router
from ai_services.routes.query import router as query_router

# FastAPI application bootstrap for the AI service.
# Runtime role in pipeline: Entry point that wires ingestion and query APIs.
# Input example (HTTP): POST /process-document with PDF path for a ReactJS basics file,
# then POST /query with question "What is React?".
# Output example (HTTP): JSON responses for ingestion and SSE stream events for query.
app = FastAPI(
    title="ThisScribe AI Service",
    version="1.0.0",
    description="Independent RAG service for PDF processing and querying.",
)

# FastAPI router registration: this exposes ingestion and query endpoints.
# At runtime, requests first enter here, then are delegated to route handlers.
app.include_router(process_document_router)
app.include_router(query_router)


# Purpose: Lightweight health endpoint to verify the FastAPI service is running.
# Input example: GET /health
# Output example: {"status": "ok"}
# Pipeline stage: Infrastructure/ops check (outside ingestion/query/RAG logic).
@app.get("/health")
def health_check() -> dict[str, str]:
    return {"status": "ok"}
