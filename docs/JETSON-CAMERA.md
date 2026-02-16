# Connecting a Jetson Orin Nano camera to the kiosk

You have a Jetson Orin Nano with a camera. Here are ways to let anyone who opens the kiosk see that camera.

---

## Option 1: Run CarePilot on the Jetson (recommended)

**Idea:** Run the full app on the Jetson. The camera is attached to the Jetson, so the app reads it directly. Anyone who opens the kiosk URL (pointing to the Jetson) sees the stream.

**Steps:**

1. **On the Jetson Orin Nano**
   - Clone/copy the CarePilot app onto the device.
   - Install dependencies (Python 3, `pip install -r requirements.txt`, OpenCV with GStreamer if using CSI).
   - Connect the camera (USB webcam or CSI).

2. **Configure the camera**
   - **USB webcam:** Use default or set in `.env`:
     ```bash
     CAMERA_INDEX=0
     CAM_W=1280
     CAM_H=720
     ```
   - **CSI camera (e.g. Raspberry Pi Camera Module v2 on Jetson):** Use a GStreamer pipeline in `.env`:
     ```bash
     CAMERA_PIPELINE="nvarguscamerasrc ! video/x-raw(memory:NVMM),width=1280,height=720,framerate=30/1 ! nvvidconv ! video/x-raw,format=BGRx ! videoconvert ! video/x-raw,format=BGR ! appsink"
     ```
     (If you use a different CSI sensor, adjust the pipeline; `nvarguscamerasrc` is common on Jetson.)

3. **Run the app on the Jetson**
   ```bash
   cd /path/to/CarePilot
   # Build frontend once (or copy a pre-built frontend/dist)
   cd frontend && npm run build && cd ..
   uvicorn app:app --host 0.0.0.0 --port 8000
   ```

4. **Open the kiosk from any device**
   - From another computer/phone on the **same network:**  
     `http://<jetson-ip>:8000/kiosk-station`  
     (Replace `<jetson-ip>` with the Jetson’s IP, e.g. `192.168.1.50`.)
   - The kiosk page loads from the Jetson; the `<img src="/camera/stream">` fetches the live camera from the same server, so everyone sees the Jetson camera.

**Pros:** No extra services, no proxy. Camera and app on one machine.  
**Cons:** The Jetson must be on and running the app; clients must reach the Jetson’s IP (or a URL that points to it).

---

## Option 2: Jetson only serves the camera; CarePilot runs elsewhere

**Idea:** Run a small HTTP server on the Jetson that serves an MJPEG stream from the camera. Run CarePilot on another machine (e.g. your PC or a cloud server) and have it proxy that stream so `/camera/stream` on the CarePilot server shows the Jetson camera.

**Steps (high level):**

1. **On the Jetson:** Run a stream server that exposes the camera, e.g.:
   - **mjpeg-server or similar:** Capture from the camera (OpenCV or GStreamer) and serve MJPEG at e.g. `http://<jetson-ip>:9000/stream`.
   - Or use a small Flask/FastAPI script that reads from the camera and streams JPEG frames with `multipart/x-mixed-replace; boundary=frame` (same format as CarePilot’s `/camera/stream`).

2. **In CarePilot (code change):** Add support for a “remote” camera URL, e.g. env `REMOTE_CAMERA_URL=http://<jetson-ip>:9000/stream`. The backend would:
   - If `REMOTE_CAMERA_URL` is set, periodically fetch from that URL (or stream proxy) and re-serve it at `GET /camera/stream`.
   - Otherwise, keep using the local CameraManager (current behavior).

**Pros:** CarePilot and frontend can run on a central server; only the video comes from the Jetson.  
**Cons:** Requires implementing the proxy in the app and running a stream server on the Jetson.

---

## Option 3: Same as Option 1, but reachable from the internet

**Idea:** Same as Option 1 (app on Jetson, camera on Jetson), but expose the Jetson so “anyone” can open the kiosk (e.g. from home or another site).

**Steps:**

1. Do **Option 1** so the kiosk works at `http://<jetson-ip>:8000/kiosk-station` on your LAN.

2. **Expose the Jetson** (pick one):
   - **Port forwarding:** On your router, forward external port 8000 (or 80) to the Jetson’s IP and port 8000. Then use `http://<your-public-ip>:8000/kiosk-station`. Prefer HTTPS in production (e.g. reverse proxy with Let’s Encrypt).
   - **Tunnel (e.g. ngrok):** On the Jetson run `ngrok http 8000` and use the generated URL, e.g. `https://abc123.ngrok.io/kiosk-station`. No router changes; good for quick testing.

**Pros:** Same simple setup as Option 1; only add network access.  
**Cons:** You must secure and maintain exposure (firewall, HTTPS, strong staff password).

---

## Quick reference: env on the Jetson

| Variable           | Use |
|--------------------|-----|
| `CAMERA_INDEX`     | USB camera device index (e.g. `0`). |
| `CAM_W`, `CAM_H`   | Resolution (e.g. `1280`, `720`). |
| `CAMERA_PIPELINE`  | GStreamer pipeline for CSI/low-level capture (overrides index). |

**Find USB camera device:**  
`ls /dev/video*` and optionally `v4l2-ctl --list-devices`.

**Test GStreamer (CSI) on Jetson:**  
`gst-launch-1.0 nvarguscamerasrc ! 'video/x-raw(memory:NVMM),width=1280,height=720' ! nvoverlaysink -e`

Use Option 1 if you’re fine running the app on the Jetson; then anyone opening `http://<jetson-ip>:8000/kiosk-station` will see the camera.
