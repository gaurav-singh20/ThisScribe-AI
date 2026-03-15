from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ai_services.services.chunker import split_documents
from ai_services.services.pdf_loader import load_pdf_pages
from ai_services.services.vector_store import index_documents

router = APIRouter()


class ProcessDocumentRequest(BaseModel):
    chatId: str = Field(..., min_length=1)
    filePath: str = Field(..., min_length=1)
    vectorCollection: str = Field(..., min_length=1)


class ProcessDocumentResponse(BaseModel):
    success: bool
    chatId: str
    vectorCollection: str
    chunksIndexed: int
    message: str


@router.post("/process-document", response_model=ProcessDocumentResponse)
def process_document(payload: ProcessDocumentRequest) -> ProcessDocumentResponse:
    try:
        pages = load_pdf_pages(payload.filePath)
        chunks = split_documents(pages)

        if not chunks:
            raise HTTPException(status_code=400, detail="No text chunks were created from the PDF")

        chunks_indexed = index_documents(
            collection_name=payload.vectorCollection,
            documents=chunks,
            chat_id=payload.chatId,
            file_path=payload.filePath,
        )

        return ProcessDocumentResponse(
            success=True,
            chatId=payload.chatId,
            vectorCollection=payload.vectorCollection,
            chunksIndexed=chunks_indexed,
            message="Document processed and indexed successfully",
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Document processing failed: {exc}") from exc
