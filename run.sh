#!/bin/bash
# Run from project root so templates and app are found
cd "$(dirname "$0")"
source .venv/bin/activate 2>/dev/null || true
uvicorn app:app --reload --host 0.0.0.0 --port 8000
