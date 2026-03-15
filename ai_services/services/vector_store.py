import uuid
from pathlib import Path

import chromadb
from langchain_chroma import Chroma
from langchain_core.documents import Document

from ai_services.services.embeddings import get_embeddings

VECTOR_DB_DIR = Path(__file__).resolve().parent.parent / "vector_db"
VECTOR_DB_DIR.mkdir(parents=True, exist_ok=True)


def _get_client() -> chromadb.PersistentClient:
    return chromadb.PersistentClient(path=str(VECTOR_DB_DIR))


def reset_collection(collection_name: str) -> None:
    if not collection_name:
        raise ValueError("vectorCollection is required")

    client = _get_client()
    try:
        client.delete_collection(name=collection_name)
    except Exception:
        # If the collection does not exist yet, treat as a no-op.
        pass


def get_vector_store(collection_name: str) -> Chroma:
    if not collection_name:
        raise ValueError("vectorCollection is required")

    return Chroma(
        collection_name=collection_name,
        persist_directory=str(VECTOR_DB_DIR),
        embedding_function=get_embeddings(),
    )


def index_documents(
    collection_name: str,
    documents: list[Document],
    chat_id: str,
    file_path: str,
) -> int:
    if not documents:
        return 0

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

    vector_store = get_vector_store(collection_name)
    vector_store.add_documents(enriched_documents, ids=ids)

    return len(enriched_documents)


def retrieve_similar(collection_name: str, query: str, top_k: int = 4) -> list[Document]:
    vector_store = get_vector_store(collection_name)
    return vector_store.similarity_search(query, k=top_k)


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
