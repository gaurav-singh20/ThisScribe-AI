from fastapi import FastAPI

from ai_services.routes.process_document import router as process_document_router
from ai_services.routes.query import router as query_router

app = FastAPI(
    title="ThisScribe AI Service",
    version="1.0.0",
    description="Independent RAG service for PDF processing and querying.",
)

app.include_router(process_document_router)
app.include_router(query_router)


@app.get("/health")
def health_check() -> dict[str, str]:
    return {"status": "ok"}
