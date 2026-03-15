from pathlib import Path

from langchain_core.documents import Document
from pypdf import PdfReader


def load_pdf_pages(file_path: str) -> list[Document]:
    resolved_path = Path(file_path).expanduser().resolve()

    if not resolved_path.exists() or not resolved_path.is_file():
        raise FileNotFoundError(f"PDF file not found: {resolved_path}")

    reader = PdfReader(str(resolved_path))

    total_pages = len(reader.pages)
    documents: list[Document] = []
    for page_number, page in enumerate(reader.pages, start=1):
        text = (page.extract_text() or "").strip()
        if not text:
            continue

        documents.append(
            Document(
                page_content=text,
                metadata={
                    "source": str(resolved_path),
                    "page": page_number,
                    "total_pages": total_pages,
                },
            )
        )

    if not documents:
        raise ValueError("No extractable text found in PDF")

    return documents
