# About CarePilot Urgent

## What inspired us

Urgent care and same-day clinics often run on paper, whiteboards, and staff constantly answering the same questions: *Where do I check in? How long is the wait? Where’s the restroom?* We wanted a single system that could:

- **Guide patients** from intake to check-in to vitals without crowding the front desk.
- **Give staff** one place to see the queue, priorities, and basic analytics.
- **Keep privacy** by showing only tokens on the waiting room display, not names or details.
- **Use AI** for friendly, non-diagnostic help (wait times, wayfinding, reading back vitals) so staff can focus on clinical work.

CarePilot Urgent is that system: a **patient portal** (intake + QR/token), a **kiosk** (camera QR scan, manual code, vitals, voice assistant), a **waiting room display**, and a **staff station**—all talking to one backend with real-time queue updates.

---

## What we learned

- **Triage from vitals:** We learned how to turn raw vitals (BP, pulse, temp, optional SpO₂) into a simple priority (low/medium/high) using rule-based thresholds—e.g. critical BP or heart rate → high priority—while keeping the AI assistant strictly non-diagnostic and only reading back numbers when asked.
- **Voice at the kiosk:** We integrated text-to-speech (OpenAI TTS) with a **single-utterance queue** so the kiosk never talks over itself, and we added a **browser fallback** when the API is unavailable or autoplay is blocked.
- **Linear kiosk flow:** We moved from a tabbed kiosk to a **guided flow**: Scan → Vitals (with “use the provided sensors”) → Chat with CarePilot → Session done. That keeps the experience clear for patients and staff.
- **Context for the AI:** So the assistant can answer “How long is the wait?” we pass **wait/queue context** (estimated wait, position in line, priority) into the chat backend and updated the system prompt so the model uses that data instead of saying it has no information.

---

## How we built it

**Stack:** Python (FastAPI), React (TypeScript, Vite), Tailwind CSS, shadcn/ui, SQLite, WebSockets.

- **Backend:** One FastAPI app handles intake, kiosk check-in, vitals submission, triage (vitals + symptoms → priority), queue ordering, staff auth, and AI chat/TTS. The camera stream is an MJPEG feed from OpenCV (or a GStreamer pipeline on Jetson); QR detection runs in a background thread and the latest scan is exposed via API for the kiosk.
- **Frontend:** React SPA with routes for home, intake, kiosk, display, staff, and analytics. The kiosk page uses the camera stream, a vitals form (BP, pulse, temp, optional SpO₂), and a chat UI that sends the patient token so the AI has vitals and wait context.
- **Queue and wait:** Active patients are ordered by priority (high → medium → low). We compute a simple **estimated wait** from the number of people ahead and typical visit duration (from intake complexity). In math terms, if there are \( n \) patients ahead and average visit time is \( \bar{t} \) minutes with \( p \) providers, a rough estimate is \( \frac{n \cdot \bar{t}}{p} \) minutes; we use a simulated wait map in code for the same idea.
- **AI:** Chat can use Gemini or OpenAI; we added **patient vitals** and **wait/queue context** to the system prompt so the assistant can say things like “Your estimated wait is about 12 minutes; you’re number 3 in line” and “Your latest readings are …” when the patient asks. TTS is OpenAI (tts-1-hd) with a browser fallback.

We also documented **Jetson (Orin Nano)** deployment: run the app on the Jetson, attach the camera (USB or CSI via GStreamer), and anyone on the network can open the kiosk URL and see the same camera feed.

---

## Challenges we faced

1. **Voice overlap and autoplay:** The kiosk was sometimes playing multiple TTS lines at once or no audio at all when `audio.play()` was blocked by the browser. We fixed it by (a) using a single queue and only starting the next utterance when the current one ends, and (b) falling back to `speechSynthesis` whenever the TTS API fails or `play()` rejects (e.g. autoplay policy).
2. **“I don’t have wait data”:** The AI was trained to say it had no real-time wait info. We added a **patient wait context** (from the queue and check-in) and updated the prompt so the model uses it; now it can give concrete wait and position answers and still suggest checking the screen or staff.
3. **Triage only after vitals:** We wanted the bot to greet once, then speak the **condition level** (from vitals) only after the patient had entered vitals. That required gating the greeting to the vitals step, running triage when vitals are submitted, and resetting the “spoken” flag when the form succeeds so the condition-level message always plays.
4. **Vitals submit 404:** In dev, the frontend was hitting the Vite dev server instead of the backend for `/api/vitals/submit`. We added a **Vite proxy** so `/api` (and `/camera`) forward to the FastAPI server when using `npm run dev`.
5. **Jetson camera for “anyone”:** To let anyone opening the kiosk see the Jetson camera, we documented that the app should run **on** the Jetson and the kiosk URL should be the Jetson’s IP (or a tunnel/port-forward). That way the camera stream and the app are on the same host and no extra proxy is required.

---

## Technology notes

Notes on the main technologies used in CarePilot.

**Google Gemini** — We used Gemini for the kiosk AI chat (with OpenAI as an alternative when region or config required it). The API was straightforward: system prompt + user message, and we got consistent, short replies. We did run into “User location is not supported” when the app was deployed to a cloud region where Gemini wasn’t enabled; switching to OpenAI for that environment was easy. **Tip:** Keep a fallback provider and check model IDs (e.g. `gemini-2.5-flash`) against the latest docs so you don’t hit 404s.

**OpenAI (Chat + TTS)** — We used the OpenAI API for chat (e.g. `gpt-4o-mini`) and for text-to-speech (`tts-1-hd`, voice `nova`). TTS quality was great for the kiosk; the main gotcha was browser autoplay blocking `audio.play()`, so we added a fallback to the browser’s `speechSynthesis` when the request failed or playback was denied. **Tip:** Always handle TTS failures and `play()` rejections so the kiosk still speaks.

**FastAPI** — FastAPI was our backend. We used it for REST endpoints, Form/JSON bodies, background camera thread, and WebSockets for the queue. Startup/shutdown hooks and dependency injection made it easy to manage the camera and DB. **Tip:** Use `STATE_LOCK` (or similar) when both HTTP handlers and background threads touch shared state (e.g. queue, camera).

**React + Vite + TypeScript** — The kiosk and the rest of the UI are a React SPA built with Vite and TypeScript. Vite’s dev server and proxy were a big help; we had to add a proxy for `/api` and `/camera` so the frontend talked to the FastAPI backend instead of 404ing. **Tip:** Add `server.proxy` in `vite.config.ts` for `/api` (and `/camera` if you use it) so local dev matches production.

**GitHub** — Used for version control and collaboration. A clear README and docs (e.g. Jetson camera guide) make the project easy to onboard and deploy.

**Render (or similar PaaS)** — If you deploy the backend to Render (or another PaaS), remember that the camera and any local hardware won’t be there. We served a placeholder for `/camera/stream` when the camera wasn’t available and made sure the kiosk still worked with manual code entry. **Tip:** Use env like `AI_PROVIDER` and optional keys (e.g. `OPENAI_API_KEY`) so the same code runs in restricted or regional environments.

---

## Summary

CarePilot Urgent is a full-stack urgent care workflow: patient intake and tokens, a kiosk with camera + vitals + voice assistant, a token-only waiting room display, and a staff queue with analytics. We focused on **context-aware AI** (vitals + wait data), **reliable kiosk voice** (queue + fallback), and **clear deployment options** (including Jetson) so it can run in a clinic or kiosk deployment.
