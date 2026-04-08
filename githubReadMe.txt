# Reminder for My System Setup

This project has **3 services + Ollama** that must run simultaneously.

Architecture:

React (client) → Node Backend (server) → FastAPI AI Service → Ollama → ChromaDB

So **4 terminals** are required when running the project locally.

Important:
The AI service **must use Python 3.11 or 3.12**. Python 3.14 is not compatible with the current LangChain/Chroma stack.

---

# 1. First-Time Setup (AI Service Python Environment)

Directory:

ThisScribe/ai_services

Steps:

1. Go to the AI service folder

cd ai_services

2. Create a virtual environment using Python 3.11

python3.11 -m venv .venv
//will make a folder .venv of around 100mbs

3. Activate the environment

Mac/Linux:

source .venv/bin/activate

4. Install required Python packages

pip install -r requirements.txt
//this will load the venv with all necessary dependencies (LangChain, FastAPI, etc), approx 500mbs

After this step the environment is ready and you **do not need to reinstall dependencies again** unless requirements change.

---

# 2. Running the Project (4 Terminals)

Always start services in this order.

---

# Terminal 1 — Ollama

Start the local LLM server.

Command:

ollama serve

Optional check:

ollama list

Expected model:

llama3.2

---

# Terminal 2 — AI Service (FastAPI)

Directory:

ThisScribe/

Commands:

source ai_services/.venv/bin/activate

uvicorn ai_services.main:app --reload

Service runs on:

http://127.0.0.1:8000

FastAPI docs:

http://127.0.0.1:8000/docs

---

# Terminal 3 — Node Backend

Directory:

ThisScribe/server

Commands:

cd server
npm install      (only first time)
node server.js //listens on 5001

Backend usually runs on:

http://localhost:5001

---

# Terminal 4 — React Frontend

Directory:

ThisScribe/client

Commands:

cd client
npm install      (only first time)
npm run dev

Frontend runs on:

http://localhost:5173

---

# Final Running System

client (React) → http://localhost:5173
↓
server (Node API) → http://localhost:5000
↓
AI service (FastAPI) → http://localhost:8000
↓
Ollama → http://localhost:11434
↓
ChromaDB (local vector database)

---

# Quick Health Checks

AI service:

http://127.0.0.1:8000/health

FastAPI docs:

http://127.0.0.1:8000/docs

Ollama:

ollama list

---

# Important Notes

• AI service **must use Python 3.11 or 3.12**
• Python 3.14 breaks LangChain/Chroma dependencies
• Only one virtual environment is used:

ThisScribe/ai_services/.venv

• The root `.venv` (if present) can be ignored or removed.

---

# Typical Development Workflow

1. Start Ollama
2. Start AI service
3. Start Node backend
4. Start React frontend

Then open:

http://localhost:5173
