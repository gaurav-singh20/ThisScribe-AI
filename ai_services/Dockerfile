# syntax=docker/dockerfile:1
FROM python:3.12-slim
WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app

COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

# Keep package imports stable: ai_services.main, ai_services.routes, etc.
COPY . /app/ai_services

EXPOSE 8000
CMD ["uvicorn", "ai_services.main:app", "--host", "0.0.0.0", "--port", "8000"]
