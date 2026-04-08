import tempfile
from pathlib import Path
import logging

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field 
#pydantic converts unstructured JSON → structured Python object

from ai_services.services.ai_errors import (
    AIServiceUnavailableError,
    build_ai_unavailable_payload,
)
from ai_services.services.chunker import split_documents
from ai_services.services.pdf_loader import load_pdf_pages
from ai_services.services.vector_store import index_documents

router = APIRouter()
logger = logging.getLogger(__name__)


# Purpose: Pydantic request schema for the ingestion API.
# Input example: {
#   "chatId": "chat-123",
#   "filePath": "/tmp/reactjs-basics.pdf",
#   "vectorCollection": "reactjs-basics-chat-123"
# }
# Output example: Parsed Python object with validated non-empty fields.
# Pipeline stage: Ingestion request validation before PDF loading/chunking/indexing.
# Non-trivial library note: Pydantic validates and coerces request JSON automatically.
class ProcessDocumentRequest(BaseModel):
    chatId: str = Field(..., min_length=1)
    filePath: str = Field(..., min_length=1)
    vectorCollection: str = Field(..., min_length=1)


# Purpose: Pydantic response schema returned after ingestion finishes.
# Input example: Internal values like chunksIndexed=42 after indexing.
# Output example: {
#   "success": true,
#   "chatId": "chat-123",
#   "vectorCollection": "reactjs-basics-chat-123",
#   "chunksIndexed": 42,
#   "message": "Document processed and indexed successfully"
# }
# Pipeline stage: Ingestion completion payload sent back to caller.
class ProcessDocumentResponse(BaseModel):
    success: bool
    chatId: str
    vectorCollection: str
    chunksIndexed: int
    message: str


def _run_ingestion(chat_id: str, file_path: str, vector_collection: str) -> ProcessDocumentResponse:
    # AI pipeline step 1 (PDF loading): returns LangChain Document objects, one per page.
    # Example returned item:
    # Document(page_content="React is a JavaScript library for building user interfaces", metadata={"page": 1, ...})
    pages = load_pdf_pages(file_path)

    # AI pipeline step 2 (chunking): splits long page text into retrieval-friendly chunks.
    # Example returned chunk text:
    # "React is a JavaScript library for building user interfaces"
    chunks = split_documents(pages)

    # Stop early if chunking produced no usable text.
    if not chunks:
        raise HTTPException(status_code=400, detail="No text chunks were created from the PDF")

    # AI pipeline step 3 and 4 (embedding + vector storage):
    # this call creates embeddings for each chunk and stores vectors in Chroma.
    # Example return value: 42 (meaning 42 chunks were embedded and indexed).
    chunks_indexed = index_documents(
        collection_name=vector_collection,
        documents=chunks,
        chat_id=chat_id,
        file_path=file_path,
    )

    # Ingestion result for client: confirms where query-time retrieval will read from.
    return ProcessDocumentResponse(
        success=True,
        chatId=chat_id,
        vectorCollection=vector_collection,
        chunksIndexed=chunks_indexed,
        message="Document processed and indexed successfully",
    )


@router.post("/process-document", response_model=ProcessDocumentResponse)
# Purpose: Ingestion endpoint that executes PDF -> chunks -> embeddings -> vector DB indexing.
# Input example: PDF path to a ReactJS basics document.
# Output example: Count of indexed chunks that can later answer "What is React?".
# Pipeline stage: Ingestion.
# Non-trivial library note: FastAPI uses the decorator to bind this function to POST /process-document.
def process_document(payload: ProcessDocumentRequest) -> ProcessDocumentResponse:
    try:
        return _run_ingestion(
            chat_id=payload.chatId,
            file_path=payload.filePath,
            vector_collection=payload.vectorCollection,
        )
    except AIServiceUnavailableError:
        logger.exception('AI service unavailable while processing document')
        return JSONResponse(status_code=503, content=build_ai_unavailable_payload())
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Document processing failed: {exc}") from exc


@router.post("/process-document-file", response_model=ProcessDocumentResponse)
def process_document_file(
    chatId: str = Form(..., min_length=1),
    vectorCollection: str = Form(..., min_length=1),
    pdf: UploadFile = File(...),
) -> ProcessDocumentResponse:
    if (pdf.content_type or '').lower() != 'application/pdf':
        raise HTTPException(status_code=400, detail='Only PDF uploads are supported')

    suffix = Path(pdf.filename or 'document.pdf').suffix.lower() or '.pdf'
    if suffix != '.pdf':
        suffix = '.pdf'

    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp_file:
            tmp_file.write(pdf.file.read())
            tmp_path = Path(tmp_file.name)

        return _run_ingestion(
            chat_id=chatId,
            file_path=str(tmp_path),
            vector_collection=vectorCollection,
        )
    except AIServiceUnavailableError:
        logger.exception('AI service unavailable while processing uploaded document')
        return JSONResponse(status_code=503, content=build_ai_unavailable_payload())
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Document processing failed: {exc}") from exc
    finally:
        try:
            pdf.file.close()
        except Exception:
            pass

        if 'tmp_path' in locals() and tmp_path.exists():
            tmp_path.unlink(missing_ok=True)
