#!/bin/bash
# Run from project root so templates and app are found
cd "$(dirname "$0")"
source .venv/bin/activate 2>/dev/null || true
APP_ENV="${APP_ENV:-development}"
HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-8000}"

if [ "$APP_ENV" = "production" ]; then
  uvicorn app:app --host "$HOST" --port "$PORT"
else
  uvicorn app:app --reload --host "$HOST" --port "$PORT"
fi
