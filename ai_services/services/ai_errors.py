from __future__ import annotations

from typing import Any

AI_UNAVAILABLE_MESSAGE = (
    "The AI response service is currently unavailable because this application relies on "
    "a locally hosted language model (Ollama), which is not accessible in the deployed "
    "environment. Please run the application locally to enable full functionality."
)


class AIServiceUnavailableError(RuntimeError):
    def __init__(self, message: str = AI_UNAVAILABLE_MESSAGE):
        super().__init__(message)
        self.message = message


def build_ai_unavailable_payload() -> dict[str, Any]:
    return {
        "success": False,
        "message": AI_UNAVAILABLE_MESSAGE,
    }


def is_ollama_unavailable_error(exc: Exception) -> bool:
    text = str(exc).lower()
    markers = [
        'ollama',
        'connection refused',
        'failed to connect',
        'connecterror',
        'connection error',
        'service unavailable',
        '503',
        'timeout',
        'timed out',
        'name or service not known',
        'nodename nor servname provided',
    ]
    return any(marker in text for marker in markers)
