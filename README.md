# CarePilot Urgent v3.1

FastAPI + Jinja urgent-care intake, kiosk check-in, tokenized waiting room display, staff queue workflow, and analytics.

## Local development

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --reload --host 0.0.0.0 --port 8000
```

Open:
- `http://localhost:8000/intake`
- `http://localhost:8000/kiosk`
- `http://localhost:8000/display`
- `http://localhost:8000/staff`
- `http://localhost:8000/analytics`

## Production configuration

Copy `.env.example` to `.env` and adjust values:

```bash
cp .env.example .env
```

Important env vars:
- `APP_ENV=production`
- `PORT=8000` (or platform-provided port)
- `ENABLE_DOCS=0` to disable docs in production
- `TRUSTED_HOSTS=yourdomain.com,www.yourdomain.com`
- `FORCE_HTTPS=1` only when TLS termination is configured
- `APP_SECRET_KEY=<long random secret>`
- `STAFF_ACCESS_PASSWORD=<staff login password>`
- `STAFF_SESSION_TTL_MINUTES=480`

## Role-based hospital access

- `/` -> Access Portal (Patient / Kiosk / Staff)
- `/intake` and `/qr/{pid}` -> Patient flow
- `/kiosk` -> Kiosk-only check-in station
- `/display` -> Public waiting room display (token-only)
- `/staff/login` -> Staff sign-in
- `/staff` and `/analytics` -> Staff-only protected pages

## Health checks

- `GET /healthz` -> liveness
- `GET /readyz` -> readiness
- `GET /api/ping` -> version + env

## Deploy with Docker

```bash
docker build -t carepilot-urgent:latest .
docker run --env-file .env -p 8000:8000 carepilot-urgent:latest
```

Or:

```bash
docker compose up --build -d
```

## Deploy to PaaS (Render/Railway/Fly-style)

- Runtime: Python
- Start command: `uvicorn app:app --host 0.0.0.0 --port $PORT`
- Add env vars from `.env.example`
- Health check path: `/healthz`

## Production notes

- This version uses in-memory storage for hackathon speed.
- Run a single app instance to keep queue state consistent.
- For multi-instance production, move state to a shared database/cache.
