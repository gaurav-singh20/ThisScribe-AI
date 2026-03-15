# ThisScribe AI Service

Independent FastAPI service for PDF processing and RAG querying.

## Endpoints

- `GET /health`
- `POST /process-document`
- `POST /query` (SSE stream)

## Python Version

Use Python 3.11 or 3.12 for best compatibility with the LangChain + Chroma stack.
Python 3.14 currently causes runtime issues with Chroma dependencies.

## Setup

From repository root:

```bash
python3.12 -m venv ai_services/.venv
source ai_services/.venv/bin/activate
pip install -r ai_services/requirements.txt
```

## Run

From repository root:

```bash
source ai_services/.venv/bin/activate
uvicorn ai_services.main:app --host 0.0.0.0 --port 8000 --reload
```

## Environment Variables

- `OLLAMA_BASE_URL` (default: `http://localhost:11434`)
- `OLLAMA_MODEL` (default: `llama3.2`)
- `OLLAMA_EMBEDDING_MODEL` (default: `llama3.2`)
- `CHUNK_SIZE` (default: `1000`)
- `CHUNK_OVERLAP` (default: `150`)
- `RAG_TOP_K` (default: `6`)

## Request Examples

### Process Document

```bash
curl -X POST http://127.0.0.1:8000/process-document \
  -H "Content-Type: application/json" \
  -d '{
    "chatId": "67d4e8f7db2fce9d8f938111",
    "filePath": "/absolute/path/to/server/uploads/sample.pdf",
    "vectorCollection": "chat_67d4e8f7db2fce9d8f938111"
  }'
```

### Query (SSE)

```bash
curl -N -X POST http://127.0.0.1:8000/query \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{
    "chatId": "67d4e8f7db2fce9d8f938111",
    "question": "What is this document about?",
    "vectorCollection": "chat_67d4e8f7db2fce9d8f938111",
    "conversationHistory": [
      {"role": "user", "content": "Give me a summary"}
    ]
  }'
```

Stream events include:

- `{"type":"token","token":"..."}`
- `{"type":"done","answer":"...","chunksRetrieved":N,"sources":[...]}`
- `{"type":"error","error":"..."}`
