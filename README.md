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

### Best UI/UX track (React + Tailwind + shadcn/ui)

The app includes an optional React frontend that satisfies the **Best UI/UX** stack:

- **Tailwind CSS** – utility-first styling
- **shadcn/ui** (Radix primitives) – Button, Card, Input, Label
- **lucide-react** – icons (Stethoscope, User, Monitor, etc.)
- **Inter** font (with system fallback)
- **framer-motion** – subtle page/block animations

To use the React UI:

```bash
cd frontend
npm install
npm run build
cd ..
uvicorn app:app --reload --host 0.0.0.0 --port 8000
```

When `frontend/dist/index.html` exists, the server serves the SPA for portal, intake, kiosk, display, staff, analytics, and privacy. The same station URLs apply; APIs are unchanged.

### Deploy to Railway or Render

See **[DEPLOY.md](DEPLOY.md)** for one-click Docker deploy to Railway or Render (builds React frontend, runs FastAPI, optional persistent SQLite volume).

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
- `GET /privacy` -> Privacy + safety statement

Dedicated station URLs for multi-computer tests:
- `GET /patient-station` -> Patient computer
- `GET /kiosk-station` -> Kiosk computer
- `GET /waiting-room-station` -> Waiting room display computer/TV
- `GET /staff-station` -> Staff computer (redirects to staff login)
- `GET /kiosk/camera` -> Jetson USB-camera QR kiosk mode

### 4-computer live test setup

Use the same base host/IP and open one path per device:
- Patient machine: `http://<HOST-IP>:8000/patient-station`
- Kiosk machine: `http://<HOST-IP>:8000/kiosk-station`
- Waiting room machine: `http://<HOST-IP>:8000/waiting-room-station`
- Staff machine: `http://<HOST-IP>:8000/staff-station`

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
- `CAMERA_INDEX=0`
- `CAM_W=1280`
- `CAM_H=720`
- `CAMERA_PIPELINE=` (optional GStreamer pipeline for Jetson)
- `DB_PATH=carepilot.db`
- `DEMO_MODE=0`
- `USE_SIMULATED_VITALS=1`
- `AI_PROVIDER=openai`
- `OPENAI_API_KEY=...` (optional)

---

## 5) API and Health Endpoints

- `GET /healthz` -> liveness
- `GET /readyz` -> readiness
- `GET /api/ping` -> app status/version/env
- `GET /api/queue` -> public queue (privacy-safe)
- `GET /api/staff-queue` -> staff queue (protected)
- `GET /camera/stream` -> MJPEG camera stream for camera kiosk
- `GET /api/camera/last-scan` -> latest QR text + freshness
- `POST /api/kiosk-checkin` -> shared kiosk check-in API
- `POST /api/vitals/submit` -> Jetson/device vitals submission
- `POST /api/vitals/simulate` -> generate demo vitals (staff auth)
- `GET /api/vitals/{pid}` -> latest vitals for a visit (staff auth)
- `POST /api/ai/chat` -> non-diagnostic operational assistant reply
- `GET /api/lobby-load` -> occupancy score (Low/Medium/High)
- `GET /api/audit` -> in-memory + DB-backed audit events (staff auth)
- `WS /ws/queue` -> real-time queue updates for display/staff

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

This app now writes core operational data to SQLite (`DB_PATH`) for persistence in demo environments.
- Keep a **single app instance** for consistent in-memory websocket + camera coordination.
- For full scale multi-instance deployments, move to managed Postgres + shared pub/sub.

### Jetson Nano camera notes

- Verify camera:
  - `ls /dev/video*`
  - `v4l2-ctl --list-devices`
- Recommended low-latency pipeline (`CAMERA_PIPELINE`):
  - `v4l2src device=/dev/video0 ! video/x-raw,width=1280,height=720,framerate=30/1 ! videoconvert ! appsink drop=1 max-buffers=1 sync=false`
- Quick OpenCV test:
  - `python3 -c "import cv2; c=cv2.VideoCapture(0); ok,f=c.read(); print(ok, None if f is None else f.shape); c.release()"`
- If pip OpenCV is difficult on Jetson, install OS package:
  - `sudo apt-get install python3-opencv`
