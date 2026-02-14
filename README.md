# CarePilot Urgent v3.1

CarePilot Urgent is a FastAPI + React urgent care workflow app:

- **Patient portal** – intake, QR/token for check-in (no kiosk link; kiosk is hospital-only)
- **Kiosk** – QR scan + manual code entry, voice assistant, vitals (hospital-only, e.g. Jetson Nano)
- **Waiting room display** – token-only queue (privacy-safe)
- **Staff** – queue, status updates, analytics (password-protected)

---

## 1) Quick Start (Local)

```bash
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
# Edit .env: STAFF_ACCESS_PASSWORD, GEMINI_API_KEY (optional)
uvicorn app:app --reload --host 0.0.0.0 --port 8000
```

Open **http://localhost:8000/**

### React frontend (recommended)

```bash
cd frontend
npm install
npm run build
cd ..
uvicorn app:app --reload --host 0.0.0.0 --port 8000
```

When `frontend/dist` exists, the server serves the React SPA (Tailwind, shadcn/ui, Framer Motion). Same URLs; APIs unchanged.

---

## 2) Environment Variables

Copy `.env.example` to `.env` and set as needed:

```bash
cp .env.example .env
```

| Variable | Description | Example |
|----------|-------------|--------|
| `APP_ENV` | `development` or `production` | `production` |
| `HOST` | Bind address | `0.0.0.0` |
| `PORT` | Server port | `8000` |
| `APP_SECRET_KEY` | Session/signing secret | long random string |
| `STAFF_ACCESS_PASSWORD` | Staff login password | set in production |
| `STAFF_SESSION_TTL_MINUTES` | Staff session length | `480` |
| `DB_PATH` | SQLite database path | `carepilot.db` or `/data/carepilot.db` |
| `CAMERA_INDEX` | Webcam device index for kiosk | `0` |
| `CAM_W`, `CAM_H` | Camera resolution | `1280`, `720` |
| `CAMERA_PIPELINE` | Optional GStreamer pipeline (Jetson) | see Jetson section |
| `GEMINI_API_KEY` or `GOOGLE_API_KEY` | Gemini API key (optional) | from Google AI Studio |
| `DEMO_MODE` | Show demo badge | `0` or `1` |
| `USE_SIMULATED_VITALS` | Allow simulated vitals | `1` |

In **production**, if `STAFF_ACCESS_PASSWORD` is not set (or left default), the app uses a built-in demo password so login works for judging; set `STAFF_ACCESS_PASSWORD` in your platform’s env to use your own.

---

## 3) Staff Login

- **Local (development):** use the password in `.env` (e.g. `STAFF_ACCESS_PASSWORD=1234` or your choice).
- **Production (e.g. Render):** if you have not set `STAFF_ACCESS_PASSWORD` in the dashboard, use the built-in demo password so the app still starts. Set `STAFF_ACCESS_PASSWORD` in the host’s environment to override.

Staff URL: **`/staff/login`** → after login you get **`/staff`** (queue) and **`/analytics`**.

---

## 4) URLs and Stations

| URL | Use |
|-----|-----|
| `/` | Patient portal (home) |
| `/patient-station` | Redirects to intake flow |
| `/intake` | Patient intake form |
| `/qr/{pid}` | Patient QR + token (show at kiosk when they arrive) |
| `/kiosk-station` | **Kiosk** – QR camera + code entry + voice (hospital-only) |
| `/display` or `/waiting-room-station` | Waiting room display (token-only queue) |
| `/staff-station` | Redirects to staff login |
| `/staff/login` | Staff sign-in |
| `/staff` | Staff queue (protected) |
| `/analytics` | Staff analytics (protected) |
| `/privacy` | Privacy & safety |

**Kiosk** is not linked from the patient portal. Patients are told to bring their token/QR to the check-in kiosk at the hospital. Open `/kiosk-station` only on the kiosk device (e.g. Jetson Nano).

---

## 5) Judging / 4-Device Setup

Use one base URL (e.g. **https://carepilot-urgent.onrender.com** or **http://localhost:8000**):

| Device | Open | Purpose |
|--------|------|---------|
| **Computer 1** | `{BASE}/staff/login` → then `/staff` | Staff: queue, status, analytics. Log in with staff password. |
| **Computer 2** | `{BASE}/kiosk-station` | Kiosk: scan QR or enter token, then voice + vitals. |
| **Phone (e.g. iPhone)** | `{BASE}/` or `/intake` | Patient: complete intake, get QR/token. |
| **Screen / Computer 3** | `{BASE}/display` | Waiting room: token-only queue. |

Flow: Patient does intake on phone → gets token/QR → at kiosk (Computer 2) scans or enters token → staff sees them on Computer 1 → waiting room screen shows queue.

---

## 6) Docker

**Build:**

```bash
docker build -t carepilot-urgent:latest .
```

**Run (interactive):**

```bash
docker run -p 8000:8000 --env-file .env carepilot-urgent:latest
```

**Run with persistent database:**

```bash
docker run -p 8000:8000 --env-file .env -v carepilot-data:/data carepilot-urgent:latest
```

**Run in background:**

```bash
docker run -d -p 8000:8000 --env-file .env --name carepilot carepilot-urgent:latest
# Stop: docker stop carepilot
```

**Using Docker Compose:**

```bash
docker compose up --build -d
```

Then open **http://localhost:8000**. The image builds the React frontend and runs FastAPI; it expects `PORT=8000` (or set `PORT` in env).

---

## 7) Deploy (Render / Railway)

See **[DEPLOY.md](DEPLOY.md)** for:

- Railway: connect repo, set `STAFF_ACCESS_PASSWORD`, `APP_SECRET_KEY`, optional volume for `DB_PATH=/data/carepilot.db`
- Render: Docker runtime, env vars, optional disk at `/data` for SQLite

After deploy, use the same paths: `/`, `/intake`, `/kiosk-station`, `/display`, `/staff/login`, etc.

---

## 8) Automatic Vitals from Sensors (Jetson Nano)

To send vitals **from hardware** (SpO2, HR, temp, BP) into the app:

- **API:** `POST /api/vitals/submit/json` with JSON body: `token`, `device_id`, `spo2`, `hr`, `temp_c`, `bp_sys`, `bp_dia`, etc.
- **Script:** Run the sensor bridge on the Nano (or any machine with sensors). See **[SENSORS.md](SENSORS.md)** for:
  - `CAREPILOT_URL`, `CAREPILOT_TOKEN`, `CAREPILOT_INTERVAL`, `CAREPILOT_DEVICE_ID`
  - Simulated vs real sensors (Max30102, DS18B20, etc.)
  - Example: `export CAREPILOT_TOKEN=UC-1234 && python scripts/sensor_bridge.py`

---

## 9) API and Health

| Endpoint | Description |
|----------|-------------|
| `GET /healthz` | Liveness |
| `GET /readyz` | Readiness |
| `GET /api/ping` | App version/env |
| `GET /api/queue` | Public queue (token-only) |
| `GET /api/staff-queue` | Staff queue (auth) |
| `POST /api/kiosk-checkin`, `POST /api/kiosk-checkin/json` | Kiosk check-in |
| `POST /api/vitals/submit` | Vitals (form) |
| `POST /api/vitals/submit/json` | Vitals (JSON, for sensor bridge) |
| `GET /api/vitals/{pid}` | Latest vitals for patient (staff) |
| `POST /api/vitals/simulate` | Demo vitals (staff) |
| `POST /api/ai/chat` | Voice assistant / non-diagnostic chat |
| `GET /api/lobby-load` | Lobby occupancy |
| `GET /camera/stream` | MJPEG camera (kiosk) |
| `GET /api/camera/last-scan` | Latest QR scan value |
| `WS /ws/queue` | Real-time queue updates |

---

## 10) Camera (MacBook for local dev, Jetson for kiosk)

**Using your MacBook camera (local development):**

- Defaults are already set: `CAMERA_INDEX=0`, `CAMERA_PIPELINE` empty. The app uses the built-in webcam and, on macOS, tries the AVFoundation backend for better compatibility.
- **macOS:** Grant **Camera** access to **Terminal** (or **Python**) in **System Settings → Privacy & Security → Camera**. If the camera fails to open, the error message will remind you.
- Open **http://localhost:8000/kiosk-station** — the live view and QR scan use your MacBook camera.
- If the camera still doesn’t open (e.g. with `opencv-python-headless`), install the full OpenCV for local dev: `pip install opencv-python` (then run the app again). The Docker/deploy build can keep using headless.

**Jetson Nano (production kiosk):**

- **Camera:** `ls /dev/video*` and `v4l2-ctl --list-devices`. Optional `CAMERA_PIPELINE` for GStreamer (see DEPLOY/README for a low-latency example).
- **OpenCV on Nano:** `sudo apt-get install python3-opencv` if needed.
- **Kiosk:** Open `http://<nano-ip>:8000/kiosk-station` (or your deployed URL). Camera + code entry + voice run in the browser.
- **Sensors:** Use **scripts/sensor_bridge.py** and **[SENSORS.md](SENSORS.md)** to send vitals by token.

---

## 11) Operational Notes

- Data is stored in SQLite (`DB_PATH`). Use a **single app instance** for in-memory websocket and camera coordination.
- For production at scale, use a managed database and shared pub/sub instead of in-memory state.

---

## 12) Repo and Contributing

- Repo: `https://github.com/Yagbe/CarePilot-Urgent` (or your fork)
- Clone → create branch → make changes → push → open a Pull Request to `main`.
