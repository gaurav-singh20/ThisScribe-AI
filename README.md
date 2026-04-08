# ThisScribe

ThisScribe is a document-grounded chat application.

You upload one PDF per chat, the document is indexed into a vector store, and every question is answered from that document context using retrieval-augmented generation (RAG).

## Features

- One chat = one document workflow
- PDF upload and indexing per chat
- Streaming assistant responses (token-by-token)
- Conversation memory (last 3 messages) for follow-up questions
- Deterministic handling for page-count and page-location questions
- Source metadata returned with answers
- Multi-service architecture (React + Express + FastAPI + Ollama + Chroma)

## Architecture

```text
React (Vite)
  -> POST /api/chat/:chatId/upload (PDF)
  -> POST /api/chat/:chatId/message (SSE)

Express (Node)
  -> stores chat metadata/messages in MongoDB
  -> stores PDFs in server/uploads
  -> calls FastAPI /process-document and /query

FastAPI (Python)
  -> /process-document: PDF load -> chunk -> embed -> Chroma index
  -> /query: retrieve context -> generate answer with Ollama -> SSE stream

Ollama
  -> embedding + chat model inference

Chroma
  -> persistent vector DB at ai_services/vector_db
```

## Project Structure

```text
ThisScribe/
  client/        React frontend
  server/        Express API + MongoDB integration
  ai_services/   FastAPI RAG service + Chroma vector DB
```

## Prerequisites

- Node.js 18+
- npm
- Python 3.11 or 3.12 (recommended; avoid 3.14 for current Chroma stack)
- MongoDB (local or remote)
- Ollama installed and running

Install required Ollama model(s):

```bash
ollama pull llama3.2
```

## Environment Setup

Create local env files from examples:

```bash
cp client/.env.example client/.env
cp server/.env.example server/.env
cp ai_services/.env.example ai_services/.env
```

Variables:

- `client/.env`
  - `VITE_API_URL`: Public URL of your Express API.

- `server/.env`
  - `PORT`: Express server port.
  - `CLIENT_ORIGIN`: Frontend origin allowed by CORS.
  - `AI_SERVICE_URL`: FastAPI AI service base URL.
  - `MONGO_URI`: MongoDB Atlas connection string, for example `mongodb+srv://gauravostro15_db_user:<db_password>@cluster0.mfpzmih.mongodb.net/thisscribe?retryWrites=true&w=majority&appName=Cluster0`.

- `ai_services/.env`
  - `PORT`: FastAPI service port.
  - `OLLAMA_URL`: Ollama base URL.
  - `CHROMA_DB_URL`: Chroma location (`file://...` path or `http(s)://...` server).
  - `OLLAMA_MODEL`: Chat model name.
  - `OLLAMA_EMBEDDING_MODEL`: Embedding model name.
  - `CHUNK_SIZE`: PDF chunk size.
  - `CHUNK_OVERLAP`: PDF chunk overlap.
  - `RAG_TOP_K`: Retrieval chunk count per query.

Deployment values:

- Render (server): set `PORT`, `CLIENT_ORIGIN` (your Vercel domain), `AI_SERVICE_URL` (your AI Render URL), `MONGO_URI` (your Atlas URI).
- Render (ai_services): set `PORT`, `OLLAMA_URL`, `CHROMA_DB_URL`, `OLLAMA_MODEL`, `OLLAMA_EMBEDDING_MODEL`, `CHUNK_SIZE`, `CHUNK_OVERLAP`, `RAG_TOP_K`.
- Vercel (client): set `VITE_API_URL` to the public Render server URL.

## Setup

Install dependencies for each service.

### 1) Client

```bash
cd client
npm install
```

### 2) Server

```bash
cd server
npm install
```

### 3) AI Service

From repository root:

```bash
python3.12 -m venv ai_services/.venv
source ai_services/.venv/bin/activate
pip install -r ai_services/requirements.txt
```

## Run Locally

Use three terminals (plus MongoDB/Ollama processes).

### 1) Start MongoDB

Run your MongoDB instance locally or provide a remote MONGO_URI.

### 2) Start Ollama

```bash
ollama serve
```

### 3) Start FastAPI (AI Service)

From repository root:

```bash
source ai_services/.venv/bin/activate
uvicorn ai_services.main:app --host 0.0.0.0 --port 8000 --reload
```

Health check:

```bash
curl http://127.0.0.1:8000/health
```

### 4) Start Express Server

```bash
cd server
node server.js
```

### 5) Start React Client

```bash
cd client
npm run dev
```

Open the URL shown by Vite (typically http://localhost:5173).

## How To Run After Getting The Project From GitHub

If you clone the repository or download a ZIP from GitHub, files listed in `.gitignore` may be missing (for example dependency folders, virtual environments, uploads, and vector DB files). Recreate them with the steps below.

### 1) Extract or clone the project

If you downloaded ZIP, extract it and open the project root in terminal.

### 2) Install Node dependencies

```bash
cd client
npm install

cd ../server
npm install

cd ..
```

### 3) Create Python environment and install AI dependencies

```bash
python3.12 -m venv ai_services/.venv
source ai_services/.venv/bin/activate
pip install -r ai_services/requirements.txt
```

### 4) Start required services

Start MongoDB (local or remote `MONGO_URI`), then start Ollama:

```bash
ollama serve
ollama pull llama3.2
```

### 5) Run the app (three terminals)

Terminal 1 (AI service):

```bash
source ai_services/.venv/bin/activate
uvicorn ai_services.main:app --host 0.0.0.0 --port 8000 --reload
```

Terminal 2 (Express server):

```bash
cd server
node server.js
```

Terminal 3 (React client):

```bash
cd client
npm run dev
```

### 6) Open the app

Visit the Vite URL (usually `http://localhost:5173`), create a chat, upload a PDF, scan it, and start asking questions.

## User Flow

1. Create a new chat.
2. Upload a PDF in that chat and click Scan Document.
3. Ask questions; answers stream in real time.
4. Start a new chat for a different document.

## API Overview

### Server API

- POST /api/chat/new
- GET /api/chat
- GET /api/chat/:chatId
- DELETE /api/chat/:chatId
- POST /api/chat/:chatId/upload
  - multipart/form-data field: pdf
- POST /api/chat/:chatId/message
  - multipart/form-data field: message
  - for streaming, send Accept: text/event-stream

### AI API

- GET /health
- POST /process-document
- POST /query (SSE stream)

SSE events from /query include:

- type=token with partial token text
- type=done with final answer + metadata
- type=error with error details

## Troubleshooting

### AI service unreachable from server

- Verify FastAPI is running on the same URL as AI_SERVICE_URL.
- Verify health endpoint: curl http://127.0.0.1:8000/health

### Ollama connection errors

- Start Ollama: ollama serve
- Confirm base URL and model names match your env vars.

### PDF uploads fail

- Only application/pdf files are accepted.
- Ensure server has write access to server/uploads.

### Empty or weak answers

- Ensure indexing completed after upload.
- Try increasing RAG_TOP_K.
- Confirm the PDF has extractable text (not only scanned images).

### Page count issues

- Page count is derived from indexed metadata.
- Re-upload/re-scan if metadata is stale after replacing a file.

## Build

### Client production build

```bash
cd client
npm run build
```

## Notes

- Uploaded PDFs are served statically from /uploads by the server.
- Vector data is stored locally in ai_services/vector_db.
- This project currently has no authentication/authorization layer.
