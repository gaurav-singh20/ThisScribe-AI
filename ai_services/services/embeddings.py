# Converts text → vectors

from functools import lru_cache

from langchain_ollama import OllamaEmbeddings
from ai_services.config import OLLAMA_EMBEDDING_MODEL, OLLAMA_URL


@lru_cache(maxsize=1)
# Purpose: Create and cache the embedding model client used by ingestion and retrieval.
# Input example: Chunk text "React is a JavaScript library for building user interfaces".
# Output example: Numeric embedding vector (e.g., [0.12, -0.03, ...]) produced by Ollama model.
# Pipeline stage: Ingestion (chunk embedding) and Query (query embedding for similarity search).
# Non-trivial library note: lru_cache ensures one reusable model client instead of reconnecting on every call.
def get_embeddings() -> OllamaEmbeddings:
    return OllamaEmbeddings(
        model=OLLAMA_EMBEDDING_MODEL,
        base_url=OLLAMA_URL,
    )
