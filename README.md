# CarePilot Urgent v3.1

CarePilot Urgent is a FastAPI + Jinja urgent care workflow app with:
- patient intake + QR/token handoff
- kiosk check-in
- privacy-safe public waiting display
- secure staff queue and analytics tools

---

## 1) Quick Start (Local)

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app:app --reload --host 0.0.0.0 --port 8000
```

Open: `http://localhost:8000/`

---

## 2) Role-Based Access (Hospital Style)

- `GET /` -> Access Portal (Patient / Kiosk / Staff)
- `GET /intake` -> Patient intake wizard
- `GET /qr/{pid}` -> Patient QR + token
- `GET /kiosk` -> Kiosk station check-in
- `GET /display` -> Public waiting room display (token only)
- `GET /staff/login` -> Staff login
- `GET /staff` -> Staff queue operations (protected)
- `GET /analytics` -> Staff analytics (protected)

---

## 3) Default Staff Login (Current Demo Setup)

- Password: `1234`

For any real deployment, **change this immediately** via env variable:
- `STAFF_ACCESS_PASSWORD=<your-strong-password>`

---

## 4) Environment Variables

Copy `.env.example` to `.env` and edit:

```bash
cp .env.example .env
```

Key variables:
- `APP_ENV=production`
- `HOST=0.0.0.0`
- `PORT=8000` (or your platform-provided port)
- `ENABLE_DOCS=0` (disable docs in prod)
- `FORCE_HTTPS=1` (enable only behind TLS)
- `TRUSTED_HOSTS=yourdomain.com,www.yourdomain.com`
- `APP_SECRET_KEY=<long-random-secret>`
- `STAFF_ACCESS_PASSWORD=<staff-password>`
- `STAFF_SESSION_TTL_MINUTES=480`

---

## 5) API and Health Endpoints

- `GET /healthz` -> liveness
- `GET /readyz` -> readiness
- `GET /api/ping` -> app status/version/env
- `GET /api/queue` -> public queue (privacy-safe)
- `GET /api/staff-queue` -> staff queue (protected)

---

## 6) Production Deployment

### Docker

```bash
docker build -t carepilot-urgent:latest .
docker run --env-file .env -p 8000:8000 carepilot-urgent:latest
```

Or:

```bash
docker compose up --build -d
```

### PaaS (Render / Railway / Fly.io style)

- Runtime: Python
- Start command: `uvicorn app:app --host 0.0.0.0 --port $PORT`
- Set env vars from `.env.example`
- Health check path: `/healthz`

---

## 7) Team Collaboration (GitHub)

Repo:
- `https://github.com/Yagbe/CarePilot-Urgent`

Typical teammate flow:

```bash
git clone https://github.com/Yagbe/CarePilot-Urgent.git
cd CarePilot-Urgent
git checkout -b feature/my-change
# make changes
git add .
git commit -m "Describe change"
git push -u origin feature/my-change
```

Then open a Pull Request into `main`.

---

## 8) Important Operational Note

This app currently uses in-memory storage for hackathon speed.
- Run a **single app instance** in production-like demos.
- For true multi-instance production, move state to shared storage (DB/cache).
