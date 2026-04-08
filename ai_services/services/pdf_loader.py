#Reads PDF -> Extracts raw text

#Input: PDF path -> Output: Full text

from pathlib import Path

from langchain_core.documents import Document
from pypdf import PdfReader


# Purpose: Load a PDF file and convert each text-bearing page into a LangChain Document.
# Input example: "/tmp/reactjs-basics.pdf" where one page contains
# "React is a JavaScript library for building user interfaces".
# Output example: [Document(page_content="React is a JavaScript library for building user interfaces", metadata={"source": ".../reactjs-basics.pdf", "page": 1, "total_pages": 10}), ...]
# Pipeline stage: Ingestion (first step before chunking).
# Non-trivial library note: pypdf extracts raw page text; LangChain Document wraps text + metadata for downstream AI steps.
def load_pdf_pages(file_path: str) -> list[Document]:
    resolved_path = Path(file_path).expanduser().resolve()

    if not resolved_path.exists() or not resolved_path.is_file():
        raise FileNotFoundError(f"PDF file not found: {resolved_path}")

    # AI ingestion source read: PdfReader parses PDF structure so each page can be iterated.
    # Example: for ReactJS basics PDF, reader.pages[0] may include "What is React?" section text.
    reader = PdfReader(str(resolved_path))

    total_pages = len(reader.pages)
    documents: list[Document] = []
    for page_number, page in enumerate(reader.pages, start=1):
        text = (page.extract_text() or "").strip()
        if not text:
            continue

        # Transform runtime data from raw text into standardized Document objects.
        # This metadata is later used for source attribution during retrieval and answer generation.
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