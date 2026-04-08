# Stores embeddings in ChromaDB
# Create collection
# Insert vectors
# Query similar chunks

import uuid
from pathlib import Path
from urllib.parse import urlparse

import chromadb
from langchain_chroma import Chroma
from langchain_core.documents import Document

from ai_services.config import CHROMA_DB_URL
from ai_services.services.ai_errors import (
    AIServiceUnavailableError,
    is_ollama_unavailable_error,
)
from ai_services.services.embeddings import get_embeddings


def _resolve_local_chroma_dir() -> Path | None:
    parsed = urlparse(CHROMA_DB_URL)
    if parsed.scheme in {'http', 'https'}:
        return None

    if parsed.scheme == 'file':
        raw_path = parsed.path
    elif parsed.scheme == '':
        raw_path = CHROMA_DB_URL
    else:
        raise ValueError('CHROMA_DB_URL must use http(s), file://, or plain filesystem path')

    path = Path(raw_path)
    if not path.is_absolute():
        path = (Path(__file__).resolve().parent.parent / path).resolve()

    path.mkdir(parents=True, exist_ok=True)
    return path


VECTOR_DB_DIR = _resolve_local_chroma_dir()


# Purpose: Create a persistent Chroma client pointing to on-disk vector database storage.
# Input example: None (uses configured VECTOR_DB_DIR).
# Output example: chromadb.PersistentClient connected to ai_services/vector_db.
# Pipeline stage: Shared infrastructure for ingestion and query.
# Non-trivial library note: Chroma persistent client keeps vectors available across server restarts.
def _get_client() -> chromadb.PersistentClient:
    parsed = urlparse(CHROMA_DB_URL)

    if parsed.scheme in {'http', 'https'}:
        return chromadb.HttpClient(
            host=parsed.hostname or 'localhost',
            port=parsed.port or (443 if parsed.scheme == 'https' else 80),
            ssl=parsed.scheme == 'https',
        )

    if VECTOR_DB_DIR is None:
        raise ValueError('CHROMA_DB_URL local path could not be resolved')

    return chromadb.PersistentClient(path=str(VECTOR_DB_DIR))


# Purpose: Delete existing vector collection so a fresh ingestion can replace prior embeddings.
# Input example: "reactjs-basics-chat-123"
# Output example: None (collection removed if it exists).
# Pipeline stage: Ingestion reset step before adding new chunk vectors.
def reset_collection(collection_name: str) -> None:
    if not collection_name:
        raise ValueError("vectorCollection is required")

    client = _get_client()
    try:
        client.delete_collection(name=collection_name)
    except Exception:
        # If the collection does not exist yet, treat as a no-op.
        pass


# Purpose: Build a LangChain Chroma vector store wrapper for one collection.
# Input example: "reactjs-basics-chat-123"
# Output example: Chroma store object that can add documents and run similarity search.
# Pipeline stage: Shared helper for ingestion indexing and query retrieval.
# Non-trivial library note: embedding_function connects Chroma with Ollama embeddings.
def get_vector_store(collection_name: str) -> Chroma:
    if not collection_name:
        raise ValueError("vectorCollection is required")

    return Chroma(
        collection_name=collection_name,
        persist_directory=str(VECTOR_DB_DIR) if VECTOR_DB_DIR else None,
        client=_get_client(),
        embedding_function=get_embeddings(),
    )


# Purpose: Index chunked documents by embedding and storing them in Chroma.
# Input example:
# - documents include chunk "React is a JavaScript library for building user interfaces"
# - chat_id "chat-123"
# - file_path "/tmp/reactjs-basics.pdf"
# Output example: 42 (number of chunks embedded and stored).
# Pipeline stage: Ingestion (embedding + vector storage).
def index_documents(
    collection_name: str,
    documents: list[Document],
    chat_id: str,
    file_path: str,
) -> int:
    if not documents:
        return 0

    # Replace old vectors for this collection so retrieval uses only the latest uploaded PDF content.
    reset_collection(collection_name)

    enriched_documents: list[Document] = []
    for doc in documents:
        metadata = dict(doc.metadata or {})
        metadata.update(
            {
                "chatId": chat_id,
                "filePath": file_path,
            }
        )
        enriched_documents.append(Document(page_content=doc.page_content, metadata=metadata))

    ids = [str(uuid.uuid4()) for _ in enriched_documents]

    # AI operation: this call computes embeddings for each chunk and writes vectors + metadata to Chroma.
    # Example result in DB: id -> vector for "React is a JavaScript library for building user interfaces".
    vector_store = get_vector_store(collection_name)
    try:
        vector_store.add_documents(enriched_documents, ids=ids)
    except Exception as exc:
        if is_ollama_unavailable_error(exc):
            raise AIServiceUnavailableError() from exc
        raise

    return len(enriched_documents)


# Purpose: Retrieve top-k chunks that are semantically closest to the user question.
# Input example: query "What is React?", top_k=4, collection "reactjs-basics-chat-123".
# Output example: [Document(page_content="React is a JavaScript library for building user interfaces", metadata={"page": 1, ...}), ...]
# Pipeline stage: Query retrieval (vector similarity search).
# Non-trivial library note: similarity_search embeds the query text and compares vectors in Chroma.
def retrieve_similar(collection_name: str, query: str, top_k: int = 4) -> list[Document]:
    vector_store = get_vector_store(collection_name)
    try:
        return vector_store.similarity_search(query, k=top_k)
    except Exception as exc:
        if is_ollama_unavailable_error(exc):
            raise AIServiceUnavailableError() from exc
        raise


# Purpose: Read page metadata distribution from a collection for page-aware responses.
# Input example: "reactjs-basics-chat-123"
# Output example: {"pages": [1, 2, 3], "total_pages": 10}
# Pipeline stage: Query helper (used by RAG logic for page count/page lookup style questions).
def get_collection_page_stats(collection_name: str) -> dict[str, object]:
    if not collection_name:
        raise ValueError("vectorCollection is required")

    client = _get_client()
    collection = client.get_collection(collection_name)
    payload = collection.get(include=['metadatas'])
    metadatas = payload.get('metadatas') or []

    pages: list[int] = []
    totals: list[int] = []
    for metadata in metadatas:
        if not isinstance(metadata, dict):
            continue

        page = metadata.get('page')
        if isinstance(page, int):
            pages.append(page)

        total_pages = metadata.get('total_pages')
        if isinstance(total_pages, int):
            totals.append(total_pages)

    unique_pages = sorted(set(pages))
    declared_total = max(totals) if totals else None

    return {
        'pages': unique_pages,
        'total_pages': declared_total,
    }
