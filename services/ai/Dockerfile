# syntax=docker/dockerfile:1
# services/ai — WRG AI & data microservice (FastAPI).
# Build context = monorepo root (docker-compose: `context: .`).
#   docker build -f services/ai/Dockerfile -t wrg-ai .

FROM python:3.14-slim AS base
WORKDIR /app

# Deps dulu → layer cache
COPY services/ai/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY services/ai/app ./app

ENV PORT=8000
EXPOSE 8000
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
