import os
from pathlib import Path
from urllib.parse import urlparse

from dotenv import load_dotenv

load_dotenv()

_is_production = os.getenv('ENVIRONMENT', '').lower() == 'production' or os.getenv(
    'PYTHON_ENV', ''
).lower() == 'production'

_local_vector_db = (Path(__file__).resolve().parent / 'vector_db').resolve()


def get_env(name: str, dev_fallback: str | None = None) -> str:
    value = os.getenv(name)
    if value:
        return value

    if not _is_production and dev_fallback is not None:
        return dev_fallback

    raise RuntimeError(f'Missing required environment variable: {name}')


OLLAMA_URL = get_env('OLLAMA_URL', 'http://localhost:11434')
OLLAMA_MODEL = get_env('OLLAMA_MODEL', 'llama3.2')
OLLAMA_EMBEDDING_MODEL = get_env('OLLAMA_EMBEDDING_MODEL', 'llama3.2')


def _resolve_chroma_db_url() -> str:
    # Some shell setups export CHROMA_DB_URL as /vector_db, which is read-only outside containers.
    configured = os.getenv('CHROMA_DB_URL', '').strip()

    if not configured:
        return f'file://{_local_vector_db.as_posix()}'

    parsed = urlparse(configured)
    if parsed.scheme == 'file' and parsed.path == '/vector_db' and not _is_production:
        return f'file://{_local_vector_db.as_posix()}'

    if parsed.scheme == '' and configured == '/vector_db' and not _is_production:
        return f'file://{_local_vector_db.as_posix()}'

    return configured


CHROMA_DB_URL = _resolve_chroma_db_url()


def is_chroma_http() -> bool:
    parsed = urlparse(CHROMA_DB_URL)
    return parsed.scheme in {'http', 'https'}
