#Splits text into chunks

import os

from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter

CHUNK_SIZE = int(os.getenv("CHUNK_SIZE", "1000"))
CHUNK_OVERLAP = int(os.getenv("CHUNK_OVERLAP", "150"))

_splitter = RecursiveCharacterTextSplitter(
    chunk_size=CHUNK_SIZE,
    chunk_overlap=CHUNK_OVERLAP,
)


# Purpose: Split page-level Document objects into smaller overlapping chunks for retrieval.
# Input example: [Document(page_content="...React is a JavaScript library for building user interfaces...", metadata={"page": 1})]
# Output example: [Document(page_content="React is a JavaScript library for building user interfaces", metadata={"page": 1}), ...]
# Pipeline stage: Ingestion (chunking between PDF loading and embeddings).
# Non-trivial library note: RecursiveCharacterTextSplitter preserves context by overlap so nearby ideas remain connected.
def split_documents(documents: list[Document]) -> list[Document]:
    if not documents:
        return []
    return _splitter.split_documents(documents)
