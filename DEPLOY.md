# Deploy CarePilot

Deploy the app (FastAPI + React SPA + SQLite) to **Railway** or **Render** in a few steps.

---

## Option A: Railway

1. **Sign up** at [railway.app](https://railway.app) and install the GitHub app.

2. **New project** → **Deploy from GitHub repo** → select your CarePilot repo.

3. **Configure:**
   - Railway will detect the Dockerfile and build the image (Python + Node build of frontend).
   - Set **Root Directory** to the repo root (default).
   - Add **Variables** (Settings → Variables):
     - `STAFF_ACCESS_PASSWORD` = a strong password (not `1234` in production).
     - `APP_SECRET_KEY` = a long random string (e.g. from `openssl rand -hex 32`).
     - `GEMINI_API_KEY` = your Google Gemini API key (from [Google AI Studio](https://aistudio.google.com/apikey)) so the kiosk chat uses Gemini AI.
     - `PORT` is set by Railway; no need to add it.
     - Optional: `DB_PATH=/data/carepilot.db` and add a **Volume** mounted at `/data` (Settings → Volumes) so SQLite persists across deploys.

4. **Deploy:** Railway builds and deploys. Open the generated URL (e.g. `https://your-app.up.railway.app`).

5. **Custom domain:** Settings → Domains → add your domain.

---

## Option B: Render

1. **Sign up** at [render.com](https://render.com).

2. **New** → **Web Service** → connect your GitHub repo.

3. **Configure:**
   - **Runtime:** Docker.
   - **Dockerfile path:** `./Dockerfile` (or leave default if it finds it).
   - **Instance type:** Free or paid.

4. **Environment:** In Render dashboard → Environment, add:
   - `APP_ENV` = `production`
   - `STAFF_ACCESS_PASSWORD` = your staff password
   - `APP_SECRET_KEY` = long random string
   - `GEMINI_API_KEY` = your Gemini API key (from [Google AI Studio](https://aistudio.google.com/apikey)) so the kiosk AI chat works.
   - `DB_PATH` = `/data/carepilot.db`  
     For persistent SQLite, add a **Disk** in the Render dashboard, mount path `/data`, then redeploy.

5. **Deploy:** Save; Render builds the Docker image and runs the app. Use the URL (e.g. `https://carepilot.onrender.com`).

---

## After deploy

- **Portal:** `https://your-app-url/`
- **Staff login:** `https://your-app-url/staff/login` (use `STAFF_ACCESS_PASSWORD`).
- **Station URLs:** same as local (e.g. `/patient-station`, `/waiting-room-station`, `/staff-station`).

**Kiosk (hospital-only):** The patient portal does not expose the kiosk. The kiosk is a separate, hospital-only system. Run it on a **Jetson Nano** (or similar) at the facility: open `/kiosk-station` on that device. The nano can run sensors for vitals, a USB mic, and a USB camera (or mic module) for on-site check-in and capture.

Change `STAFF_ACCESS_PASSWORD` and `APP_SECRET_KEY` in the platform’s env vars; avoid committing secrets.

---

## Build without Docker (e.g. Render “Native” or Railway Nixpacks)

If you prefer not to use Docker:

1. **Build command:**
   ```bash
   pip install -r requirements.txt && cd frontend && npm install && npm run build && cd ..
   ```
2. **Start command:**
   ```bash
   uvicorn app:app --host 0.0.0.0 --port $PORT
   ```
3. Set `DB_PATH` to a path that persists (e.g. Render disk mount or Railway volume). The app expects `frontend/dist` to exist after the build so it can serve the React SPA.
