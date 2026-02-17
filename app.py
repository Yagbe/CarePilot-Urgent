"""
CarePilot Urgent - FastAPI + React urgent care workflow application.

Sections: config and state; CameraManager (OpenCV/GStreamer, QR, MJPEG);
triage (vitals + symptoms -> priority); AI chat (Gemini/OpenAI) and TTS;
routes for intake, kiosk, vitals, queue, staff, display, camera stream.

Run: pip install -r requirements.txt && uvicorn app:app --host 0.0.0.0 --port 8000
"""

import io
import json
import hashlib
import hmac
import os
import random
import re
import sys
import asyncio
import threading
import time
import uuid
import sqlite3
import urllib.error
import urllib.request
from collections import deque
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Optional

import qrcode
from fastapi import FastAPI, Form, HTTPException, Request, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from jinja2 import Environment, FileSystemLoader
from starlette.middleware.httpsredirect import HTTPSRedirectMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from dotenv import load_dotenv

from integrations.nphies_adapter import InsuranceAdapter, get_insurance_adapter

load_dotenv()

# -----------------------------------------------------------------------------
# API request models (Pydantic)
# -----------------------------------------------------------------------------
class IntakeRequest(BaseModel):
    first_name: str = ""
    last_name: str = ""
    phone: str = ""
    dob: str = ""
    symptoms: str = ""
    duration_text: str = "1 day"
    arrival_window: str = "now"
    lang: str = "en"  # Language preference: "en" or "ar"


class StaffLoginRequest(BaseModel):
    password: str = ""


class KioskCheckinRequest(BaseModel):
    code: str = ""


class SpeakRequest(BaseModel):
    text: str = ""


class VitalsSubmitRequest(BaseModel):
    """JSON body for sensor bridge / automatic vitals submission."""
    token: str = ""
    pid: str = ""
    device_id: str = "sensors"
    spo2: Optional[float] = None
    hr: Optional[float] = None
    temp_c: Optional[float] = None
    bp_sys: Optional[float] = None
    bp_dia: Optional[float] = None
    confidence: float = 0.9
    simulated: int = 0
    ts: str = ""


class InsuranceEligibilityRequest(BaseModel):
    """Request body for insurance eligibility checks (integration-ready, non-diagnostic)."""
    encounter_id: str = ""
    pid: str = ""
    token: str = ""
    national_id: str = ""
    iqama: str = ""
    passport: str = ""
    insurer_name: str = ""
    policy_number: str = ""
    member_id: str = ""
    consent: bool = False


# -----------------------------------------------------------------------------
# App config and storage (env from .env; never commit .env to git)
# -----------------------------------------------------------------------------
APP_VERSION = "3.1"
APP_ENV = os.getenv("APP_ENV", "development").lower()
PORT = int(os.getenv("PORT", "8000"))
HOST = os.getenv("HOST", "0.0.0.0")
FORCE_HTTPS = os.getenv("FORCE_HTTPS", "0") == "1"
ENABLE_DOCS = os.getenv("ENABLE_DOCS", "1" if APP_ENV != "production" else "0") == "1"
TRUSTED_HOSTS = [h.strip() for h in os.getenv("TRUSTED_HOSTS", "*").split(",") if h.strip()] or ["*"]
APP_SECRET_KEY = os.getenv("APP_SECRET_KEY", "dev-only-change-me")
STAFF_ACCESS_PASSWORD = os.getenv("STAFF_ACCESS_PASSWORD", "1234").strip()
# Production fallback when STAFF_ACCESS_PASSWORD is not set in environment
STAFF_FALLBACK_PASSWORD = os.getenv("STAFF_FALLBACK_PASSWORD", "").strip() or "Asdqwe135$$"
if APP_ENV == "production" and STAFF_ACCESS_PASSWORD in ("", "1234"):
    STAFF_ACCESS_PASSWORD = STAFF_FALLBACK_PASSWORD
STAFF_SESSION_TTL_MINUTES = int(os.getenv("STAFF_SESSION_TTL_MINUTES", "480"))
STAFF_SESSION_COOKIE = "carepilot_staff_session"
CAMERA_INDEX = int(os.getenv("CAMERA_INDEX", "0"))
CAM_W = int(os.getenv("CAM_W", "1280"))
CAM_H = int(os.getenv("CAM_H", "720"))
CAMERA_PIPELINE = os.getenv("CAMERA_PIPELINE", "").strip()
DB_PATH = os.getenv("DB_PATH", str(Path(__file__).resolve().parent / "carepilot.db"))
DEMO_MODE_FLAG = os.getenv("DEMO_MODE", "0") == "1"
USE_SIMULATED_VITALS = os.getenv("USE_SIMULATED_VITALS", "1") == "1"
AI_PROVIDER = os.getenv("AI_PROVIDER", "gemini").lower()
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "").strip()
# Gemini: key must be set in .env as GEMINI_API_KEY (no hardcoded keys)
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash").strip() or "gemini-2.5-flash"
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini").strip() or "gpt-4o-mini"
OPENAI_TTS_MODEL = os.getenv("OPENAI_TTS_MODEL", "tts-1-hd").strip() or "tts-1-hd"
OPENAI_TTS_VOICE = os.getenv("OPENAI_TTS_VOICE", "nova").strip().lower() or "nova"
# Optional: when set, kiosk will POST check-in token here (sensor bridge / token receiver). Leave unset to avoid localhost:9999 requests.
SENSOR_BRIDGE_URL = (os.getenv("SENSOR_BRIDGE_URL", "").strip() or "").rstrip("/")
INSURANCE_ADAPTER_NAME = os.getenv("INSURANCE_ADAPTER", "mock").strip().lower()
patients: dict[str, dict[str, Any]] = {}
queue_order: list[str] = []
provider_count = 1
demo_mode = False
issued_tokens: set[str] = set()
arrival_windows_count = {"now": 0, "soon": 0, "later": 0}
last_checkin_by_code: dict[str, float] = {}
WS_CLIENTS: set[WebSocket] = set()
STATE_LOCK = threading.RLock()
AUDIT_LOG = deque(maxlen=200)
LOGIN_ATTEMPTS_BY_IP: dict[str, list[float]] = {}


def _db_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


DB_CONN = _db_conn()


def _init_db() -> None:
    with STATE_LOCK:
        DB_CONN.execute(
            """
            CREATE TABLE IF NOT EXISTS patients (
              pid TEXT PRIMARY KEY,
              token TEXT,
              first_name TEXT,
              last_name TEXT,
              status TEXT,
              created_at TEXT,
              checked_in_at TEXT
            )
            """
        )
        DB_CONN.execute(
            """
            CREATE TABLE IF NOT EXISTS encounters (
              encounter_id TEXT PRIMARY KEY,
              pid TEXT,
              station_id TEXT,
              created_at TEXT,
              checked_in_at TEXT,
              provider_ready_at TEXT,
              vitals_snapshot_id INTEGER,
              insurance_profile_id INTEGER,
              eligibility_result_id INTEGER,
              claim_bundle_id INTEGER,
              claim_status TEXT
            )
            """
        )
        DB_CONN.execute(
            """
            CREATE TABLE IF NOT EXISTS insurance_profiles (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              encounter_id TEXT,
              pid TEXT,
              national_id TEXT,
              iqama TEXT,
              passport TEXT,
              insurer_name TEXT,
              policy_number TEXT,
              member_id TEXT,
              dob TEXT,
              phone TEXT,
              consent INTEGER DEFAULT 0,
              raw_payload TEXT,
              created_at TEXT
            )
            """
        )
        DB_CONN.execute(
            """
            CREATE TABLE IF NOT EXISTS eligibility_checks (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              encounter_id TEXT,
              insurance_profile_id INTEGER,
              status TEXT,
              eligible TEXT,
              plan_type TEXT,
              copay_estimate REAL,
              authorization_required TEXT,
              raw_request TEXT,
              raw_response TEXT,
              created_at TEXT
            )
            """
        )
        DB_CONN.execute(
            """
            CREATE TABLE IF NOT EXISTS claim_bundles (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              encounter_id TEXT,
              bundle_json TEXT,
              created_at TEXT
            )
            """
        )
        DB_CONN.execute(
            """
            CREATE TABLE IF NOT EXISTS claim_submissions (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              encounter_id TEXT,
              claim_bundle_id INTEGER,
              adapter_name TEXT,
              external_claim_id TEXT,
              status TEXT,
              raw_response TEXT,
              created_at TEXT,
              updated_at TEXT
            )
            """
        )
        DB_CONN.execute(
            """
            CREATE TABLE IF NOT EXISTS vitals (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              pid TEXT,
              token TEXT,
              device_id TEXT,
              spo2 REAL,
              hr REAL,
              temp_c REAL,
              bp_sys REAL,
              bp_dia REAL,
              confidence REAL,
              ts TEXT,
              simulated INTEGER DEFAULT 0
            )
            """
        )
        DB_CONN.execute(
            """
            CREATE TABLE IF NOT EXISTS queue_events (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              event_type TEXT,
              pid TEXT,
              token TEXT,
              payload TEXT,
              ts TEXT
            )
            """
        )
        DB_CONN.execute(
            """
            CREATE TABLE IF NOT EXISTS ai_conversations (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              pid TEXT,
              role TEXT,
              message TEXT,
              ts TEXT
            )
            """
        )
        DB_CONN.execute(
            """
            CREATE TABLE IF NOT EXISTS audit_log (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              event_type TEXT,
              payload TEXT,
              ts TEXT
            )
            """
        )
        DB_CONN.commit()

_TEMPLATES_DIR = Path(__file__).resolve().parent / "templates"
_STATIC_DIR = Path(__file__).resolve().parent / "static"
_FRONTEND_DIST = Path(__file__).resolve().parent / "frontend" / "dist"

app = FastAPI(
    title="CarePilot Urgent",
    docs_url="/docs" if ENABLE_DOCS else None,
    redoc_url="/redoc" if ENABLE_DOCS else None,
    openapi_url="/openapi.json" if ENABLE_DOCS else None,
)
app.add_middleware(GZipMiddleware, minimum_size=500)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=TRUSTED_HOSTS)
if FORCE_HTTPS:
    app.add_middleware(HTTPSRedirectMiddleware)
app.mount("/static", StaticFiles(directory=str(_STATIC_DIR)), name="static")
_SPA_BUILD = (_FRONTEND_DIST / "index.html").is_file()
if _FRONTEND_DIST.is_dir():
    _ASSETS_DIR = _FRONTEND_DIST / "assets"
    if _ASSETS_DIR.is_dir():
        app.mount("/assets", StaticFiles(directory=str(_ASSETS_DIR)), name="assets")
env = Environment(loader=FileSystemLoader(str(_TEMPLATES_DIR)))

try:
    import cv2  # type: ignore
except Exception:
    cv2 = None


class CameraManager:
    def __init__(self, index: int, width: int, height: int, pipeline: str = "") -> None:
        self.index = index
        self.width = width
        self.height = height
        self.pipeline = pipeline
        self._cap = None
        self._thread: Optional[threading.Thread] = None
        self._running = False
        self._lock = threading.Lock()
        self._latest_jpeg: bytes = b""
        self._last_scan_value = ""
        self._last_scan_ts = 0.0
        self._last_emitted_value = ""
        self._last_emitted_ts = 0.0
        self._detector = cv2.QRCodeDetector() if cv2 is not None else None

    def start(self) -> None:
        if cv2 is None:
            raise RuntimeError("OpenCV is not available.")
        if self._running:
            return
        cap = None
        if self.pipeline:
            cap = cv2.VideoCapture(self.pipeline, cv2.CAP_GSTREAMER)
        else:
            # On macOS try AVFoundation first (native camera backend), then default
            if sys.platform == "darwin":
                api = getattr(cv2, "CAP_AVFOUNDATION", None)
                if api is not None:
                    cap = cv2.VideoCapture(self.index, api)
                if cap is None or not cap.isOpened():
                    cap = cv2.VideoCapture(self.index)
            else:
                cap = cv2.VideoCapture(self.index)
        if cap is None or not cap.isOpened():
            hint = " On macOS: grant Camera access to Terminal (or Python) in System Settings → Privacy & Security → Camera."
            raise RuntimeError(f"Unable to open camera ({self.pipeline or self.index}).{hint}")
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, self.width)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self.height)
        try:
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        except Exception:
            pass
        self._cap = cap
        self._running = True
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._running = False
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=1.0)
        if self._cap is not None:
            self._cap.release()
            self._cap = None

    def _loop(self) -> None:
        while self._running:
            if self._cap is None:
                time.sleep(0.05)
                continue
            ok, frame = self._cap.read()
            if not ok or frame is None:
                time.sleep(0.03)
                continue

            decoded = ""
            points = None
            if self._detector is not None:
                decoded, points, _ = self._detector.detectAndDecode(frame)

            now = time.time()
            if points is not None and len(points) > 0:
                pts = points.astype(int)
                cv2.polylines(frame, [pts], isClosed=True, color=(40, 220, 120), thickness=3)
                cv2.putText(
                    frame,
                    "QR detected",
                    (20, 42),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    1.0,
                    (40, 220, 120),
                    2,
                    cv2.LINE_AA,
                )

            value = (decoded or "").strip()
            if value:
                with self._lock:
                    is_new = value != self._last_emitted_value
                    stale = (now - self._last_emitted_ts) > 3.0
                    if is_new or stale:
                        self._last_scan_value = value
                        self._last_scan_ts = now
                        self._last_emitted_value = value
                        self._last_emitted_ts = now

            ok_jpg, jpg = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 82])
            if ok_jpg:
                with self._lock:
                    self._latest_jpeg = jpg.tobytes()
            time.sleep(0.02)

    def latest_jpeg(self) -> bytes:
        with self._lock:
            return self._latest_jpeg

    def last_scan(self) -> tuple[str, float]:
        with self._lock:
            return self._last_scan_value, self._last_scan_ts


camera_manager: Optional[CameraManager] = None


def _camera() -> CameraManager:
    global camera_manager
    with STATE_LOCK:
        if camera_manager is None:
            camera_manager = CameraManager(CAMERA_INDEX, CAM_W, CAM_H, CAMERA_PIPELINE)
        manager = camera_manager
    if not manager._running:
        manager.start()
    return manager


def render(name: str, **kwargs: Any) -> str:
    base = {
        "version": APP_VERSION,
        "nav_items": ["intake", "display", "staff", "analytics"],
        "demo_mode": demo_mode,
    }
    base.update(kwargs)
    return env.get_template(name).render(**base)


def _audit(event_type: str, details: dict[str, Any]) -> None:
    with STATE_LOCK:
        ts = datetime.utcnow().isoformat()
        event = {"ts": ts, "event_type": event_type, "details": details}
        AUDIT_LOG.append(event)
        DB_CONN.execute(
            "INSERT INTO audit_log(event_type, payload, ts) VALUES(?,?,?)",
            (event_type, json.dumps(details), ts),
        )
        DB_CONN.commit()


def _queue_event(event_type: str, pid: str = "", token: str = "", payload: Optional[dict[str, Any]] = None) -> None:
    data = payload or {}
    with STATE_LOCK:
        DB_CONN.execute(
            "INSERT INTO queue_events(event_type, pid, token, payload, ts) VALUES(?,?,?,?,?)",
            (event_type, pid, token, json.dumps(data), datetime.utcnow().isoformat()),
        )
        DB_CONN.commit()


# -----------------------------------------------------------------------------
# AI module (non-diagnostic)
# -----------------------------------------------------------------------------
CLUSTER_KEYWORDS = {
    "Respiratory": ["cough", "sore throat", "congestion", "runny nose", "sinus", "wheezing", "chest"],
    "GI": ["nausea", "vomit", "diarrhea", "stomach", "abdominal", "cramp", "constipation"],
    "Musculoskeletal": ["pain", "joint", "muscle", "sprain", "strain", "back", "neck", "ankle", "knee"],
    "Dermatology": ["rash", "itch", "skin", "hives", "burn", "wound", "bite"],
}

RED_FLAG_KEYWORDS = [
    "chest pain", "difficulty breathing", "can't breathe", "trouble breathing",
    "having trouble breathing", "shortness of breath", "unconscious", "seizure",
    "bleeding heavily", "stroke", "heart attack", "anaphylaxis", "overdose",
]

# Triage priority: high = emergency, medium = urgent, low = routine
PRIORITY_ORDER = {"high": 0, "medium": 1, "low": 2}


def _classify_priority_from_vitals_and_symptoms(
    vitals: Optional[dict[str, Any]],
    symptoms: str,
    red_flags: list[str],
) -> tuple[str, str]:
    """
    Classify priority (high/medium/low) from latest vitals and intake symptoms.
    Returns (priority, emergency_description_or_empty).
    """
    symptoms_lower = (symptoms or "").lower()
    # Severe symptom keywords → high (emergency)
    severe_keywords = [
        "chest pain", "heart attack", "stroke", "can't breathe", "difficulty breathing",
        "unconscious", "seizure", "bleeding heavily", "anaphylaxis", "overdose",
    ]
    for kw in severe_keywords:
        if kw in symptoms_lower:
            return ("high", kw.replace(" ", "_").replace("'", ""))
    if red_flags:
        return ("high", "emergency_symptoms")

    # Vitals-based classification
    if vitals:
        spo2 = vitals.get("spo2")
        hr = vitals.get("hr")
        bp_sys = vitals.get("bp_sys")
        bp_dia = vitals.get("bp_dia")
        temp_c = vitals.get("temp_c")
        # Critical vitals → high
        if spo2 is not None and spo2 < 92:
            return ("high", "low_oxygen")
        if hr is not None and (hr > 130 or hr < 45):
            return ("high", "critical_heart_rate")
        if bp_sys is not None and (bp_sys > 180 or bp_sys < 85):
            return ("high", "critical_bp")
        if temp_c is not None and (temp_c > 39.5 or temp_c < 35.0):
            return ("high", "critical_temp")
        # Moderate concern → medium
        if spo2 is not None and spo2 < 95:
            return ("medium", "")
        if hr is not None and (hr > 110 or hr < 50):
            return ("medium", "")
        if bp_sys is not None and (bp_sys > 160 or bp_sys < 95):
            return ("medium", "")

    # Default from intake complexity if we have ai_result elsewhere
    return ("low", "")


def _extract_duration_days(duration: str) -> int:
    text = (duration or "").lower()
    m = re.search(r"(\d+)", text)
    n = int(m.group(1)) if m else 1
    if "week" in text:
        return n * 7
    if "month" in text:
        return n * 30
    return n


def _has_arabic(text: str) -> bool:
    """Detect whether the text contains Arabic characters (rough heuristic)."""
    if not text:
        return False
    return bool(re.search(r"[\u0600-\u06FF]", text))


def _parse_age_from_dob(dob: str) -> Optional[int]:
    if not dob:
        return None
    try:
        born = datetime.strptime(dob, "%Y-%m-%d").date()
        today = datetime.utcnow().date()
        years = today.year - born.year - ((today.month, today.day) < (born.month, born.day))
        return max(years, 0)
    except Exception:
        return None


def ai_structure_symptoms(symptoms: str, duration: str, age_optional: Optional[int], lang: str = "en") -> dict[str, Any]:
    text = (symptoms or "").lower().strip()
    symptom_list = [s.strip().capitalize() for s in re.split(r"[,\n]+", symptoms) if s.strip()][:6]
    if not symptom_list and text:
        symptom_list = [text[:60].capitalize()]

    scores = {k: sum(1 for w in words if w in text) for k, words in CLUSTER_KEYWORDS.items()}
    ranked = sorted(scores.items(), key=lambda x: x[1], reverse=True)
    primary = ranked[0][0] if ranked and ranked[0][1] > 0 else "General"
    secondary = ranked[1][0] if len(ranked) > 1 and ranked[1][1] > 0 else ""
    cluster = primary if not secondary else f"{primary}+{secondary}"

    flags = [f for f in RED_FLAG_KEYWORDS if f in text]
    days = _extract_duration_days(duration)
    symptom_count = len(re.findall(r"[a-zA-Z]{3,}", text))

    if flags or symptom_count > 35 or days > 10:
        complexity = "High"
        visit_duration = 35
    elif symptom_count > 20 or days > 4:
        complexity = "Moderate"
        visit_duration = 25
    else:
        complexity = "Low"
        visit_duration = 15

    chief = symptom_list[0] if symptom_list else "General symptom concern"
    resources = ["Vitals check", "Nurse triage review"]
    if "Respiratory" in cluster:
        resources.append("Rapid respiratory panel (if indicated)")
    if "GI" in cluster:
        resources.append("Hydration assessment")

    flags_text = ", ".join(flags) if flags else "none detected"
    use_arabic = (lang or "").lower() == "ar" or _has_arabic(symptoms)
    if use_arabic:
        # Arabic summary (non-diagnostic, operational only)
        summary = (
            f"الشكوى الرئيسية: {chief}. "
            f"المجموعة التشغيلية: {cluster}. "
            f"المدة: {days} يوم/أيام. "
            f"علامات الخطر: {flags_text or 'لا توجد علامات خطورة واضحة'}. "
            f"درجة التعقيد التشغيلي: {complexity}. "
            f"المدة التقديرية للزيارة: {visit_duration}-{visit_duration+10} دقيقة. "
            "هذا تلخيص تشغيلي فقط لدعم تنظيم العمل، وليس تشخيصًا طبيًا."
        )
    else:
        summary = (
            f"Chief complaint: {chief}. "
            f"Cluster: {cluster}. "
            f"Duration: {days} day(s). "
            f"Red flags: {flags_text}. "
            f"Operational complexity: {complexity}. "
            f"Estimated visit duration: {visit_duration}-{visit_duration+10} min. "
            "Non-diagnostic operational summary for triage workflow only."
        )

    return {
        "chief_complaint": chief,
        "symptom_list": symptom_list,
        "cluster": cluster,
        "red_flag_keywords_detected": flags,
        "operational_complexity": complexity,
        "estimated_visit_duration_minutes": visit_duration,
        "ai_summary_text": summary,
        "suggested_resources": resources,
        "duration_days": days,
        "age_optional": age_optional,
    }


# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------
def next_pid() -> str:
    return uuid.uuid4().hex[:8].upper()


def next_token() -> str:
    with STATE_LOCK:
        existing = {str(p.get("token", "")).upper() for p in patients.values()}
        for _ in range(500):
            candidate = f"UC-{random.randint(1000, 9999)}"
            if candidate not in existing and candidate not in issued_tokens:
                issued_tokens.add(candidate)
                return candidate
        fallback = f"UC-{uuid.uuid4().hex[:4].upper()}"
        issued_tokens.add(fallback)
        return fallback


def full_name(patient: dict[str, Any]) -> str:
    first = (patient.get("first_name") or "").strip()
    last = (patient.get("last_name") or "").strip()
    return f"{first} {last}".strip() or "Unknown Patient"


def status_label(status: str) -> str:
    labels = {"waiting": "Waiting", "called": "Called", "in_room": "In Room", "done": "Complete", "pending": "Pending"}
    return labels.get(status, status.title())


def _resolve_code(code: str) -> Optional[str]:
    raw = (code or "").strip().upper()
    if not raw:
        return None
    candidates = [raw]
    if "|" in raw:
        parts = [x.strip() for x in raw.split("|") if x.strip()]
        candidates = parts + [raw]

    with STATE_LOCK:
        for c in candidates:
            if c in patients:
                return c
            for pid, p in patients.items():
                if str(p.get("token", "")).upper() == c:
                    return pid
    return None


def _lane_from_complexity(complexity: str) -> str:
    c = (complexity or "").lower()
    if c.startswith("low"):
        return "Fast"
    if c.startswith("high"):
        return "Complex"
    return "Standard"


def _simulate_wait_map(pids: list[str], providers: int) -> dict[str, int]:
    if not pids:
        return {}
    providers = max(1, providers)
    slots = [0] * max(1, providers)
    wait: dict[str, int] = {}
    with STATE_LOCK:
        with_meta: list[tuple[str, int, str]] = []
        for pid in pids:
            p = patients.get(pid, {})
            dur = int(p.get("ai_result", {}).get("estimated_visit_duration_minutes", 20))
            lane = _lane_from_complexity(p.get("ai_result", {}).get("operational_complexity", ""))
            with_meta.append((pid, dur, lane))

    fast_queue = [x for x in with_meta if x[2] == "Fast"]
    other_queue = [x for x in with_meta if x[2] != "Fast"]
    has_fast = bool(fast_queue)
    i = 0
    # Reserve at least one out of every three assignment opportunities for Fast lane.
    while fast_queue or other_queue:
        reserve_fast = has_fast and (i % 3 == 0)
        if reserve_fast and fast_queue:
            pid, dur, _lane = fast_queue.pop(0)
        elif other_queue:
            pid, dur, _lane = other_queue.pop(0)
        else:
            pid, dur, _lane = fast_queue.pop(0)
        idx = slots.index(min(slots))
        wait[pid] = slots[idx]
        slots[idx] += dur
        i += 1
    return wait


def _queue_active() -> list[str]:
    with STATE_LOCK:
        return [pid for pid in queue_order if pid in patients and patients[pid].get("status") != "done"]


def _reorder_queue_by_priority() -> None:
    """Sort queue_order by priority (high, medium, low) then by checked_in_at. Call with STATE_LOCK held."""
    active = [pid for pid in queue_order if pid in patients and patients[pid].get("status") != "done"]
    done_or_gone = [pid for pid in queue_order if pid not in patients or patients[pid].get("status") == "done"]
    key = lambda pid: (PRIORITY_ORDER.get(patients[pid].get("priority", "low"), 2), patients[pid].get("checked_in_at") or "")
    active.sort(key=key)
    queue_order.clear()
    queue_order.extend(active)
    queue_order.extend(done_or_gone)


def _public_queue_items() -> list[dict[str, Any]]:
    active = _queue_active()
    waits = _simulate_wait_map(active, provider_count)
    now = datetime.utcnow().isoformat()
    out = []
    with STATE_LOCK:
        for pos, pid in enumerate(active, start=1):
            p = patients[pid]
            typical = int(p.get("ai_result", {}).get("estimated_visit_duration_minutes", 20))
            out.append({
                "token": p.get("token"),
                "priority": p.get("priority", "low"),
                "status_label": status_label(p.get("status", "waiting")),
                "estimated_wait_min": waits.get(pid, 0),
                "position_in_line": pos,
                "providers_active": provider_count,
                "updated_at": now,
                "eta_explanation": (
                    f"You're #{pos} in line • {provider_count} provider(s) • "
                    f"Typical visit {typical}-{typical + 10} min"
                ),
            })
    return out


def _staff_queue_items() -> list[dict[str, Any]]:
    active = _queue_active()
    waits = _simulate_wait_map(active, provider_count)
    out = []
    with STATE_LOCK:
        for pid in active:
            p = patients[pid]
            ai = p.get("ai_result", {})
            lane = _lane_from_complexity(ai.get("operational_complexity", ""))
            tags = ["Nurse triage"]
            c = str(ai.get("cluster", ""))
            if "Respiratory" in c:
                tags.extend(["mask station", "rapid test kit"])
            if "GI" in c:
                tags.append("hydration supplies")
            if ai.get("red_flag_keywords_detected"):
                tags.append("priority clinician review")
            out.append({
            "id": pid,
            "token": p.get("token"),
            "priority": p.get("priority", "low"),
            "emergency_type": p.get("emergency_type", ""),
            "full_name": full_name(p),
            "display_name": p.get("first_name", ""),
            "status": p.get("status", "waiting"),
            "status_label": status_label(p.get("status", "waiting")),
            "checked_in_at": p.get("checked_in_at"),
            "estimated_wait_min": waits.get(pid, 0),
            "symptoms": p.get("symptoms", ""),
            "duration_text": p.get("duration_text", ""),
            "ai_cluster": ai.get("cluster", ""),
            "ai_complexity": ai.get("operational_complexity", ""),
            "ai_visit_duration": ai.get("estimated_visit_duration_minutes", 0),
            "ai_summary": ai.get("ai_summary_text", ""),
            "red_flags": ai.get("red_flag_keywords_detected", []),
            "chief_complaint": ai.get("chief_complaint", ""),
            "symptom_list": ai.get("symptom_list", []),
            "suggested_resources": ai.get("suggested_resources", []),
            "lane": lane,
            "resource_tags": tags,
            "vitals_latest": _latest_vitals_for_pid(pid),
        })
    return out


def _avg_wait(items: list[dict[str, Any]]) -> int:
    waits = [i["estimated_wait_min"] for i in items if i.get("status") in {"waiting", "called"}]
    return int(sum(waits) / len(waits)) if waits else 0


def _forecast(provider_override: Optional[int] = None) -> dict[str, Any]:
    with STATE_LOCK:
        providers = provider_override or provider_count
        aw_now = arrival_windows_count["now"]
        aw_soon = arrival_windows_count["soon"]
        aw_later = arrival_windows_count["later"]
    now = datetime.utcnow()
    seed = int(now.strftime("%Y%m%d%H")) * 10 + (now.minute // 6)
    rng = random.Random(seed)
    base = [
        1 + aw_now * 0.4,
        2 + aw_now * 0.5,
        3 + aw_soon * 0.7,
        4 + aw_soon * 0.8,
        4 + aw_later * 0.6,
        3 + aw_later * 0.5,
        2 + aw_later * 0.4,
        1 + aw_now * 0.3,
    ]
    arrivals = [max(0, int(round(v + rng.uniform(-0.4, 0.4)))) for v in base]
    avg_duration = 20
    current_items = _staff_queue_items()
    current_peak = max([i["estimated_wait_min"] for i in current_items], default=0)
    prov = max(providers, 1)
    future_wait = [max(0, int(current_peak + (sum(arrivals[:i + 1]) * avg_duration / prov) - i * 8)) for i in range(len(arrivals))]
    peak_with_current = max(future_wait) if future_wait else 0
    # If we recommend adding a provider, show projected peak *with* one more provider
    prov_plus_one = prov + 1
    future_wait_plus_one = [max(0, int(current_peak + (sum(arrivals[:i + 1]) * avg_duration / prov_plus_one) - i * 8)) for i in range(len(arrivals))]
    peak_with_extra = max(future_wait_plus_one) if future_wait_plus_one else 0
    if peak_with_current > 45:
        recommendation = f"Add 1 provider for next peak window; projected peak drops to ~{peak_with_extra} min."
    else:
        recommendation = "Current staffing appears stable for projected arrivals."
    labels = [(datetime.utcnow() + timedelta(minutes=15 * i)).strftime("%H:%M") for i in range(8)]
    return {"labels": labels, "arrivals": arrivals, "wait_projection": future_wait, "recommendation": recommendation}


def _validate_dob(dob: str) -> None:
    if not dob:
        return
    try:
        dob_d = datetime.strptime(dob, "%Y-%m-%d").date()
        if dob_d > datetime.utcnow().date():
            raise HTTPException(400, "DOB cannot be in the future.")
    except ValueError:
        raise HTTPException(400, "DOB must be YYYY-MM-DD.")


def _seed_demo_patients() -> None:
    global demo_mode
    with STATE_LOCK:
        if demo_mode:
            return
        samples = [
        ("Ava", "Miller", "Sore throat, fever, dry cough", "2 days", "now"),
        ("Liam", "Ng", "Nausea and abdominal cramping", "1 day", "soon"),
        ("Noah", "Patel", "Ankle pain after twist injury", "3 days", "later"),
        ("Emma", "Diaz", "Rash and itching on arms", "4 days", "soon"),
        ("Mia", "Lee", "Cough with congestion and fatigue", "5 days", "now"),
        ("Ethan", "King", "Back pain and muscle stiffness", "1 week", "later"),
    ]
        for first, last, symptoms, duration, window in samples:
            pid = next_pid()
            age = random.randint(18, 72)
            ai = ai_structure_symptoms(symptoms, duration, age, lang="en")
            patients[pid] = {
            "pid": pid,
            "token": next_token(),
            "first_name": first,
            "last_name": last,
            "phone": "",
            "dob": "",
            "symptoms": symptoms,
            "duration_text": duration,
            "arrival_window": window,
            "ai_result": ai,
            "status": "waiting",
            "priority": "low",
            "emergency_type": "",
            "created_at": datetime.utcnow().isoformat(),
            "checked_in_at": datetime.utcnow().isoformat(),
        }
            queue_order.append(pid)
            arrival_windows_count[window] += 1
            DB_CONN.execute(
                """
                INSERT OR REPLACE INTO patients(pid, token, first_name, last_name, status, created_at, checked_in_at)
                VALUES(?,?,?,?,?,?,?)
                """,
                (
                    pid,
                    patients[pid]["token"],
                    first,
                    last,
                    "waiting",
                    patients[pid]["created_at"],
                    patients[pid]["checked_in_at"],
                ),
            )
            # Seed one simulated vitals row per demo patient so "Vitals" and Live Vitals panel show data
            spo2 = random.randint(96, 100)
            hr = random.randint(62, 98)
            temp_c = round(random.uniform(36.4, 37.6), 1)
            bp_sys = random.randint(108, 132)
            bp_dia = random.randint(68, 86)
            ts = datetime.utcnow().isoformat()
            DB_CONN.execute(
                """
                INSERT INTO vitals(pid, token, device_id, spo2, hr, temp_c, bp_sys, bp_dia, confidence, ts, simulated)
                VALUES(?,?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    pid,
                    patients[pid]["token"],
                    "demo-seed",
                    spo2,
                    hr,
                    temp_c,
                    bp_sys,
                    bp_dia,
                    0.9,
                    ts,
                    1,
                ),
            )
        demo_mode = True
        DB_CONN.commit()


def _reset_state() -> None:
    global provider_count, demo_mode
    with STATE_LOCK:
        patients.clear()
        queue_order.clear()
        issued_tokens.clear()
        last_checkin_by_code.clear()
        arrival_windows_count.update({"now": 0, "soon": 0, "later": 0})
        provider_count = 1
        demo_mode = False
        DB_CONN.execute("DELETE FROM patients")
        DB_CONN.execute("DELETE FROM vitals")
        DB_CONN.commit()


def _ensure_encounter_for_pid(pid: str, station_id: str = "kiosk") -> str:
    """
    Ensure there is an encounter row for this patient.
    Returns encounter_id (created if missing).
    """
    if not pid:
        raise HTTPException(400, "pid is required for encounter.")
    with STATE_LOCK:
        row = DB_CONN.execute(
            "SELECT encounter_id FROM encounters WHERE pid=? ORDER BY created_at LIMIT 1",
            (pid,),
        ).fetchone()
        if row:
            return str(row["encounter_id"])
        # For now we use pid as encounter_id so frontend staff views can
        # address encounters directly by patient id without extra mapping.
        encounter_id = pid
        now = datetime.utcnow().isoformat()
        DB_CONN.execute(
            """
            INSERT INTO encounters(encounter_id, pid, station_id, created_at, checked_in_at, claim_status)
            VALUES(?,?,?,?,?,?)
            """,
            (encounter_id, pid, station_id, now, None, "draft"),
        )
        DB_CONN.commit()
    _audit("encounter_created", {"encounter_id": encounter_id, "pid": pid, "station_id": station_id})
    return encounter_id


def _latest_eligibility_for_encounter(encounter_id: str) -> Optional[dict[str, Any]]:
    if not encounter_id:
        return None
    with STATE_LOCK:
        row = DB_CONN.execute(
            "SELECT * FROM eligibility_checks WHERE encounter_id=? ORDER BY id DESC LIMIT 1",
            (encounter_id,),
        ).fetchone()
    return dict(row) if row else None


def _latest_claim_submission_for_encounter(encounter_id: str) -> Optional[dict[str, Any]]:
    if not encounter_id:
        return None
    with STATE_LOCK:
        row = DB_CONN.execute(
            "SELECT * FROM claim_submissions WHERE encounter_id=? ORDER BY id DESC LIMIT 1",
            (encounter_id,),
        ).fetchone()
    return dict(row) if row else None


def _build_claim_bundle(encounter_id: str) -> dict[str, Any]:
    """
    Build a non-diagnostic, operations-focused encounter bundle for billing/claims.
    Uses in-memory patient state plus DB snapshots; safe to export via adapter.
    """
    if not encounter_id:
        raise HTTPException(400, "encounter_id is required.")
    with STATE_LOCK:
        enc_row = DB_CONN.execute(
            "SELECT * FROM encounters WHERE encounter_id=?",
            (encounter_id,),
        ).fetchone()
        if not enc_row:
            raise HTTPException(404, "Encounter not found.")
        enc = dict(enc_row)
        pid = str(enc.get("pid") or "")
        patient = patients.get(pid, {}).copy()
        insurance_profile = None
        if enc.get("insurance_profile_id"):
            ip_row = DB_CONN.execute(
                "SELECT * FROM insurance_profiles WHERE id=?",
                (enc["insurance_profile_id"],),
            ).fetchone()
            insurance_profile = dict(ip_row) if ip_row else None
        eligibility = None
        if enc.get("eligibility_result_id"):
            el_row = DB_CONN.execute(
                "SELECT * FROM eligibility_checks WHERE id=?",
                (enc["eligibility_result_id"],),
            ).fetchone()
            eligibility = dict(el_row) if el_row else None
    vitals = _latest_vitals_for_pid(pid) if pid else None
    ai = (patient.get("ai_result") or {}) if patient else {}
    lane = _lane_from_complexity(ai.get("operational_complexity", ""))
    tags = ["Nurse triage"]
    cluster = str(ai.get("cluster", ""))
    if "Respiratory" in cluster:
        tags.extend(["mask station", "rapid test kit"])
    if "GI" in cluster:
        tags.append("hydration supplies")
    if ai.get("red_flag_keywords_detected"):
        tags.append("priority clinician review")

    # Lightweight audit trail for this bundle (non-PHI payloads only)
    audit_events: list[dict[str, Any]] = []
    with STATE_LOCK:
        rows = DB_CONN.execute(
            "SELECT id, event_type, ts FROM audit_log ORDER BY id DESC LIMIT 50"
        ).fetchall()
    for r in rows:
        audit_events.append(
            {
                "id": r["id"],
                "event_type": r["event_type"],
                "ts": r["ts"],
            }
        )

    demographics = {
        "pid": pid,
        "token": patient.get("token"),
        "first_name": patient.get("first_name"),
        "last_name": patient.get("last_name"),
        "dob": patient.get("dob"),
        "phone": patient.get("phone"),
    }
    symptoms = {
        "raw_text": patient.get("symptoms", ""),
        "chief_complaint": ai.get("chief_complaint", ""),
        "cluster": ai.get("cluster", ""),
        "operational_complexity": ai.get("operational_complexity", ""),
        "ai_summary_text": ai.get("ai_summary_text", ""),
        "duration_text": patient.get("duration_text", ""),
    }

    coding_suggestions = {
        "suggested_service_category": "General visit",
        "suggested_resource_codes": ["VITALS_PANEL", "TRIAGE_NURSE"],
        "required_approvals": ["billing review"],
        "draft": True,
        "staff_review_required": True,
        "disclaimer": (
            "Non-diagnostic draft coding suggestion for operational use only. "
            "Staff billing review is required before any submission."
        ),
    }
    if "Respiratory" in cluster:
        coding_suggestions["suggested_service_category"] = "Respiratory visit"
        coding_suggestions["suggested_resource_codes"].append("RESP_RAPID_TEST")
    elif "GI" in cluster:
        coding_suggestions["suggested_service_category"] = "GI visit"
        coding_suggestions["suggested_resource_codes"].append("GI_HYDRATION_SUPPORT")

    bundle = {
        "encounter_id": encounter_id,
        "patient": demographics,
        "encounter": {
            "pid": pid,
            "station_id": enc.get("station_id"),
            "created_at": enc.get("created_at"),
            "checked_in_at": enc.get("checked_in_at"),
            "provider_ready_at": enc.get("provider_ready_at"),
            "claim_status": enc.get("claim_status") or "draft",
        },
        "symptoms_and_vitals": {
            "symptoms": symptoms,
            "vitals_latest": vitals,
        },
        "triage": {
            "lane": lane,
            "resource_tags": tags,
            "arrival_window": patient.get("arrival_window"),
        },
        "resources_used": ai.get("suggested_resources", []),
        "billing": {
            "insurance_profile": insurance_profile,
            "eligibility": eligibility,
        },
        "audit_log_tail": audit_events,
        "documents": {
            "qr_checkin_record": bool(pid and patient.get("token")),
            "vitals_record": bool(vitals),
            "qr_url": f"/qr/{pid}" if pid else None,
            "vitals_api_url": f"/api/vitals/{pid}" if pid else None,
        },
        "coding_suggestions": coding_suggestions,
        "non_diagnostic": True,
    }
    return bundle


def _wait_for_pid(pid: str) -> int:
    active = _queue_active()
    waits = _simulate_wait_map(active, provider_count)
    return waits.get(pid, 0)


def _kiosk_checkin_result(code: str) -> dict[str, Any]:
    raw = (code or "").strip().upper()
    parsed = raw.split("|")[0].strip() if "|" in raw else raw
    pid = _resolve_code(code)
    if not pid:
        return {"ok": False, "checked_in": False, "message": "Code not found.", "token": "", "estimated_wait_min": 0}

    with STATE_LOCK:
        p = patients.get(pid)
        if not p:
            return {"ok": False, "checked_in": False, "message": "Code not found.", "token": "", "estimated_wait_min": 0}
        token_key = str(p.get("token", "")).upper()
        now = time.time()
        for key in {pid, token_key, parsed}:
            if key and (now - last_checkin_by_code.get(key, 0.0) < 3.0):
                return {
                    "ok": False,
                    "checked_in": False,
                    "message": "Scan cooldown active. Please wait 3 seconds.",
                    "token": "",
                    "estimated_wait_min": 0,
                }
        for key in {pid, token_key}:
            if key:
                last_checkin_by_code[key] = now

        if len(last_checkin_by_code) > 400:
            cutoff = now - 60.0
            for k, ts in list(last_checkin_by_code.items()):
                if ts < cutoff:
                    last_checkin_by_code.pop(k, None)

        if p.get("status") != "pending":
            wait = _wait_for_pid(pid)
            _audit("checkin_repeat", {"pid": pid, "token": p.get("token"), "wait": wait})
            _queue_event("checkin_repeat", pid=pid, token=p.get("token", ""), payload={"wait": wait})
            return {
                "ok": True,
                "checked_in": True,
                "message": "Already checked in.",
                "token": p["token"],
                "estimated_wait_min": wait,
                "display_name": full_name(p),
            }

        p["status"] = "waiting"
        p["checked_in_at"] = datetime.utcnow().isoformat()
        p["priority"] = p.get("priority", "low")
        p["emergency_type"] = p.get("emergency_type", "")
        if pid not in queue_order:
            queue_order.append(pid)
        # Ensure encounter row exists and record check-in timestamp for operational analytics/billing.
        encounter_id = _ensure_encounter_for_pid(pid, station_id="kiosk")
        DB_CONN.execute(
            "UPDATE patients SET status=?, checked_in_at=? WHERE pid=?",
            (p["status"], p["checked_in_at"], pid),
        )
        DB_CONN.execute(
            "UPDATE encounters SET checked_in_at=? WHERE encounter_id=?",
            (p["checked_in_at"], encounter_id),
        )
        DB_CONN.commit()

        wait = _wait_for_pid(pid)
        _audit("checkin", {"pid": pid, "token": p.get("token"), "wait": wait})
        _queue_event("checkin", pid=pid, token=p.get("token", ""), payload={"wait": wait})
        return {
            "ok": True,
            "checked_in": True,
            "message": "You are checked in.",
            "token": p["token"],
            "estimated_wait_min": wait,
            "display_name": full_name(p),
        }


def _session_signature(expires_ts: int) -> str:
    msg = f"staff:{expires_ts}".encode("utf-8")
    return hmac.new(APP_SECRET_KEY.encode("utf-8"), msg, hashlib.sha256).hexdigest()


def _create_staff_session_value() -> str:
    expires_ts = int(time.time() + (STAFF_SESSION_TTL_MINUTES * 60))
    return f"{expires_ts}.{_session_signature(expires_ts)}"


def _is_staff_authenticated(request: Request) -> bool:
    raw = request.cookies.get(STAFF_SESSION_COOKIE, "")
    if "." not in raw:
        return False
    exp_s, sig = raw.split(".", 1)
    try:
        expires_ts = int(exp_s)
    except Exception:
        return False
    if expires_ts < int(time.time()):
        return False
    expected = _session_signature(expires_ts)
    return hmac.compare_digest(sig, expected)


def _require_staff(request: Request) -> None:
    if not _is_staff_authenticated(request):
        raise HTTPException(status_code=401, detail="Staff authentication required.")


def _client_ip(request: Request) -> str:
    xfwd = request.headers.get("x-forwarded-for", "")
    if xfwd:
        return xfwd.split(",")[0].strip()
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


def _lane_counts(items: Optional[list[dict[str, Any]]] = None) -> dict[str, int]:
    data = items if items is not None else _staff_queue_items()
    counts = {"Fast": 0, "Standard": 0, "Complex": 0}
    for i in data:
        lane = i.get("lane", "Standard")
        if lane in counts:
            counts[lane] += 1
    return counts


def _queue_snapshot_payload() -> dict[str, Any]:
    with STATE_LOCK:
        pc = provider_count
    return {
        "type": "queue_update",
        "provider_count": pc,
        "updated_at": datetime.utcnow().isoformat(),
        "items": _public_queue_items(),
    }


async def _broadcast_queue_update() -> None:
    with STATE_LOCK:
        sockets = list(WS_CLIENTS)
    if not sockets:
        return
    payload = _queue_snapshot_payload()
    stale: list[WebSocket] = []
    for ws in sockets:
        try:
            await ws.send_text(json.dumps(payload))
        except Exception:
            stale.append(ws)
    if stale:
        with STATE_LOCK:
            for ws in stale:
                WS_CLIENTS.discard(ws)


def _latest_vitals_for_pid(pid: str) -> Optional[dict[str, Any]]:
    with STATE_LOCK:
        row = DB_CONN.execute(
            """
            SELECT pid, token, device_id, spo2, hr, temp_c, bp_sys, bp_dia, confidence, ts, simulated
            FROM vitals WHERE pid=? ORDER BY id DESC LIMIT 1
            """,
            (pid,),
        ).fetchone()
    if not row:
        return None
    return dict(row)


def _lobby_load_score() -> dict[str, Any]:
    items = _public_queue_items()
    q = len(items)
    if q >= 8:
        level = "High"
    elif q >= 4:
        level = "Medium"
    else:
        level = "Low"
    return {"level": level, "queue_size": q, "updated_at": datetime.utcnow().isoformat()}


def _gemini_generate(system_instruction: str, user_text: str) -> Optional[str]:
    """Call Gemini API (REST). Returns generated text or None on error."""
    if not GEMINI_API_KEY:
        return None
    models_to_try = [GEMINI_MODEL, "gemini-2.5-flash", "gemini-2.0-flash", "gemini-flash-latest", "gemini-pro-latest"]
    seen = set()
    last_error: Optional[str] = None
    inline_prompt = f"{system_instruction}\n\nUser: {user_text}\n\nAssistant:"
    for model in models_to_try:
        if not model or model in seen:
            continue
        seen.add(model)
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={GEMINI_API_KEY}"
        for use_system in (True, False):  # try with systemInstruction, then without
            payload = {
                "contents": [{"parts": [{"text": inline_prompt if not use_system else user_text}]}],
                "generationConfig": {"temperature": 0.3, "maxOutputTokens": 512, "topP": 0.95},
            }
            if use_system:
                payload["systemInstruction"] = {"parts": [{"text": system_instruction}]}
            try:
                data = json.dumps(payload).encode("utf-8")
                req = urllib.request.Request(
                    url, data=data, headers={"Content-Type": "application/json"}, method="POST"
                )
                with urllib.request.urlopen(req, timeout=25) as resp:
                    out = json.loads(resp.read().decode("utf-8"))
                err = out.get("error")
                cand = out.get("candidates") or []
                if err:
                    last_error = str(err)
                    print(f"[CarePilot] Gemini [{model}] API error: {err}", flush=True)
                    break
                if not cand:
                    last_error = "no candidates in response"
                    print(f"[CarePilot] Gemini [{model}] no candidates. Keys: {list(out.keys())}", flush=True)
                    break
                c0 = cand[0]
                block = (c0.get("finishReason") or c0.get("finish_reason") or "").lower()
                if block and block in ("block", "safety", "recitation"):
                    last_error = f"blocked ({block})"
                    break
                content = c0.get("content") or {}
                parts = content.get("parts") or []
                if not parts:
                    last_error = "no parts in candidate"
                    break
                text = parts[0].get("text") or parts[0].get("Text") or ""
                if text and isinstance(text, str):
                    return text.strip()
            except urllib.error.HTTPError as e:
                body = ""
                try:
                    body = e.read().decode("utf-8") if e.fp else ""
                except Exception:
                    pass
                last_error = f"HTTP {e.code}: {body[:400]}"
                print(f"[CarePilot] Gemini [{model}] {last_error}", flush=True)
                break
            except Exception as e:
                last_error = str(e)
                print(f"[CarePilot] Gemini [{model}] failed: {e}", flush=True)
                break
    return None


def _openai_generate(system_instruction: str, user_text: str) -> Optional[str]:
    """Call OpenAI Chat Completions API. Returns generated text or None on error."""
    if not OPENAI_API_KEY:
        return None
    url = "https://api.openai.com/v1/chat/completions"
    payload = {
        "model": OPENAI_MODEL,
        "messages": [
            {"role": "system", "content": system_instruction},
            {"role": "user", "content": user_text},
        ],
        "max_tokens": 256,
        "temperature": 0.3,
    }
    try:
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=data,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {OPENAI_API_KEY}",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=25) as resp:
            out = json.loads(resp.read().decode("utf-8"))
        choices = out.get("choices") or []
        if not choices:
            return None
        msg = choices[0].get("message") or {}
        text = msg.get("content") or ""
        return text.strip() if isinstance(text, str) else None
    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = e.read().decode("utf-8") if e.fp else ""
        except Exception:
            pass
        print(f"[CarePilot] OpenAI [{OPENAI_MODEL}] HTTP {e.code}: {body[:300]}", flush=True)
        return None
    except Exception as e:
        print(f"[CarePilot] OpenAI [{OPENAI_MODEL}] failed: {e}", flush=True)
        return None


AI_CHAT_SYSTEM_PROMPT = """You are CarePilot, an AI medical kiosk assistant at an urgent care clinic. You are friendly and helpful but strictly non-diagnostic.

Rules:
- Only help with: check-in steps, wait times, wayfinding (e.g. waiting room, restroom), sensor/vitals instructions, and general workflow questions.
- Do not give medical advice, diagnose, or interpret symptoms. If someone describes serious symptoms (chest pain, difficulty breathing, etc.), tell them to alert clinic staff immediately.
- Keep replies short (1–3 sentences). Speak as if to a patient at a kiosk.
- For wait time: when patient/wait context is provided below, use it to answer (e.g. "Your estimated wait is about X minutes. You're number N in line."). Add that they can check the waiting room screen or ask staff for the most up-to-date info. If no wait context is provided, say you don't have their wait data and they can check the screen or ask staff.
- Language: reply in the same language the user is using. If the user writes in Arabic, respond fully in Arabic. If they write in English, respond in English.
- When the patient asks for THEIR vitals or "what are my numbers": if vitals are provided below, read them back in a friendly sentence (e.g. "Your latest readings are ..."). Do not interpret or diagnose. If no vitals are provided below, say to place one finger on the sensor and hold still until they see confirmation.
- For general sensor instructions (when they're not asking for their own readings): say to place one finger on the sensor and hold still until they see confirmation."""


def _format_vitals_context(v: Optional[dict[str, Any]]) -> str:
    """Format latest vitals for AI context. Non-diagnostic; for reference only."""
    if not v:
        return "No vitals on file for this patient yet."
    parts = []
    if v.get("spo2") is not None:
        parts.append(f"SpO2 {int(v['spo2'])}%")
    if v.get("hr") is not None:
        parts.append(f"HR {int(v['hr'])} bpm")
    if v.get("temp_c") is not None:
        parts.append(f"Temp {v['temp_c']}°C")
    if v.get("bp_sys") is not None and v.get("bp_dia") is not None:
        parts.append(f"BP {int(v['bp_sys'])}/{int(v['bp_dia'])}")
    if not parts:
        return "No vitals on file for this patient yet."
    return "Latest vitals: " + ", ".join(parts) + ". Use only to read back if the patient asks; do not interpret or diagnose."


def _format_patient_wait_context(pid: str) -> Optional[str]:
    """Build context for this patient: wait time, position, priority, status. For AI chat so it can answer wait questions."""
    if not pid:
        return None
    items = _public_queue_items()
    with STATE_LOCK:
        p = patients.get(pid)
        if not p:
            return None
        token = p.get("token", "")
    for item in items:
        if str(item.get("token", "")).upper() == str(token or "").upper():
            wait = item.get("estimated_wait_min", 0)
            pos = item.get("position_in_line")
            priority = item.get("priority", "low")
            status = item.get("status_label", "Waiting")
            parts = [f"Estimated wait for this patient: {int(wait)} minutes"]
            if pos is not None:
                parts.append(f"position in line: {pos}")
            parts.append(f"priority: {priority}")
            parts.append(f"status: {status}")
            return ". ".join(parts) + ". Use this to answer wait time and queue questions; also suggest they check the waiting room screen or ask staff for the most up-to-date info."
    with STATE_LOCK:
        p = patients.get(pid)
        if not p:
            return None
        wait = p.get("estimated_wait_min")
    if wait is not None:
        return f"Estimated wait for this patient: {int(wait)} minutes. They may not be in the active queue yet. Use this to answer wait questions; also suggest checking the screen or asking staff."
    return None


def _ai_chat_reply(user_text: str, vitals_context: Optional[str] = None, patient_wait_context: Optional[str] = None) -> dict[str, Any]:
    """Chat replies from OpenAI or Gemini per AI_PROVIDER. Red-flag phrases get a fixed safety message."""
    text = (user_text or "").strip()
    low = text.lower()
    red_flags = [f for f in RED_FLAG_KEYWORDS if f in low]
    if red_flags:
        reply = (
            "I am an operational assistant, not a medical advisor. "
            "Please alert clinic staff now for immediate support."
        )
        return {"reply": reply, "red_flags": red_flags}

    system_prompt = AI_CHAT_SYSTEM_PROMPT
    if patient_wait_context:
        system_prompt += "\n\n[Current patient wait/queue context - use this to answer wait time and queue questions] " + patient_wait_context
    if vitals_context:
        system_prompt += "\n\n[Patient's vitals - read these back if they ask for their vitals; do not interpret or diagnose] " + vitals_context

    if AI_PROVIDER == "openai":
        if not OPENAI_API_KEY:
            return {
                "reply": "The AI assistant is not configured (missing OPENAI_API_KEY). Please ask a staff member.",
                "red_flags": [],
            }
        openai_reply = _openai_generate(system_prompt, text)
        if openai_reply:
            return {"reply": openai_reply, "red_flags": []}
        return {
            "reply": "The AI assistant is temporarily unavailable. Please try again in a moment or ask a staff member.",
            "red_flags": [],
        }

    # Gemini (default)
    if not GEMINI_API_KEY:
        return {
            "reply": "The AI assistant is not configured (missing GEMINI_API_KEY). Please ask a staff member.",
            "red_flags": [],
        }
    gemini_reply = _gemini_generate(system_prompt, text)
    if gemini_reply:
        return {"reply": gemini_reply, "red_flags": []}
    return {
        "reply": "The AI assistant is temporarily unavailable. Please try again in a moment or ask a staff member.",
        "red_flags": [],
    }


# -----------------------------------------------------------------------------
# Routes (Jinja HTML only when React SPA is not built)
# -----------------------------------------------------------------------------
if not _SPA_BUILD:
    @app.get("/", response_class=HTMLResponse)
    def home():
        return render("home.html", page="home")

    @app.get("/patient", response_class=HTMLResponse)
    def patient_portal():
        return RedirectResponse("/intake", status_code=302)

    @app.get("/patient-station", response_class=HTMLResponse)
    def patient_station():
        return RedirectResponse("/intake", status_code=302)

    @app.get("/waiting-room", response_class=HTMLResponse)
    def waiting_room_station():
        return RedirectResponse("/display", status_code=302)

    @app.get("/waiting-room-station", response_class=HTMLResponse)
    def waiting_room_station_alt():
        return RedirectResponse("/display", status_code=302)

    @app.get("/staff-station", response_class=HTMLResponse)
    def staff_station():
        return RedirectResponse("/staff/login", status_code=302)


@app.get("/api/ping")
def api_ping():
    return {"status": "ok", "app": "CarePilot Urgent", "version": APP_VERSION, "env": APP_ENV}


@app.get("/api/config")
def api_config():
    """Public config for frontend (e.g. kiosk). Only includes optional sensor bridge URL when set."""
    return {"sensor_bridge_url": SENSOR_BRIDGE_URL or None}


@app.get("/kiosk-station")
def kiosk_station_redirect():
    """Always-available redirect so /kiosk-station works in SPA and non-SPA mode (e.g. Render)."""
    return RedirectResponse("/kiosk", status_code=302)


@app.get("/api/demo-mode")
def api_demo_mode():
    with STATE_LOCK:
        return {"demo_mode": demo_mode}


@app.get("/healthz")
def healthz():
    return {"status": "ok"}


@app.get("/readyz")
def readyz():
    return {"status": "ready", "patients_loaded": len(patients), "queue_size": len(_queue_active())}


if not _SPA_BUILD:
    @app.get("/intake", response_class=HTMLResponse)
    def intake_page():
        return render("intake.html", page="intake")


@app.post("/intake")
def intake_submit(
    request: Request,
    first_name: str = Form(...),
    last_name: str = Form(""),
    phone: str = Form(""),
    dob: str = Form(""),
    symptoms: str = Form(...),
    duration_text: str = Form("1 day"),
    arrival_window: str = Form("now"),
):
    first_name = (first_name or "").strip()
    symptoms = (symptoms or "").strip()
    _validate_dob((dob or "").strip())
    if not first_name or not symptoms:
        raise HTTPException(400, "First name and symptoms are required.")

    window = arrival_window if arrival_window in {"now", "soon", "later"} else "now"
    pid = next_pid()
    age = _parse_age_from_dob((dob or "").strip())
    ai = ai_structure_symptoms(symptoms, duration_text, age, lang="en")
    with STATE_LOCK:
        patients[pid] = {
        "pid": pid,
        "token": next_token(),
        "first_name": first_name,
        "last_name": (last_name or "").strip(),
        "phone": (phone or "").strip(),
        "dob": (dob or "").strip(),
        "symptoms": symptoms,
        "duration_text": duration_text,
        "arrival_window": window,
        "ai_result": ai,
        "status": "pending",
        "priority": "low",
        "emergency_type": "",
        "created_at": datetime.utcnow().isoformat(),
        "checked_in_at": None,
        }
        arrival_windows_count[window] += 1
        DB_CONN.execute(
            """
            INSERT OR REPLACE INTO patients(pid, token, first_name, last_name, status, created_at, checked_in_at)
            VALUES(?,?,?,?,?,?,?)
            """,
            (
                pid,
                patients[pid]["token"],
                patients[pid]["first_name"],
                patients[pid]["last_name"],
                patients[pid]["status"],
                patients[pid]["created_at"],
                patients[pid]["checked_in_at"],
            ),
        )
        DB_CONN.commit()
    _ensure_encounter_for_pid(pid, station_id="intake")
    _audit("intake_created", {"pid": pid, "arrival_window": window})
    return RedirectResponse(request.url_for("qr_page", pid=pid), status_code=302)


@app.post("/api/intake")
def api_intake_submit(body: IntakeRequest):
    """JSON API for React frontend."""
    first_name = (body.first_name or "").strip()
    symptoms = (body.symptoms or "").strip()
    _validate_dob((body.dob or "").strip())
    if not first_name or not symptoms:
        raise HTTPException(400, "First name and symptoms are required.")
    window = body.arrival_window if body.arrival_window in {"now", "soon", "later"} else "now"
    pid = next_pid()
    age = _parse_age_from_dob((body.dob or "").strip())
    lang_pref = (body.lang or "en").lower()
    ai = ai_structure_symptoms(symptoms, body.duration_text or "1 day", age, lang=lang_pref)
    with STATE_LOCK:
        patients[pid] = {
            "pid": pid,
            "token": next_token(),
            "first_name": first_name,
            "last_name": (body.last_name or "").strip(),
            "phone": (body.phone or "").strip(),
            "dob": (body.dob or "").strip(),
            "symptoms": symptoms,
            "duration_text": body.duration_text or "1 day",
            "arrival_window": window,
            "ai_result": ai,
            "status": "pending",
            "priority": "low",
            "emergency_type": "",
            "created_at": datetime.utcnow().isoformat(),
            "checked_in_at": None,
        }
        arrival_windows_count[window] += 1
        DB_CONN.execute(
            """
            INSERT OR REPLACE INTO patients(pid, token, first_name, last_name, status, created_at, checked_in_at)
            VALUES(?,?,?,?,?,?,?)
            """,
            (pid, patients[pid]["token"], patients[pid]["first_name"], patients[pid]["last_name"],
             patients[pid]["status"], patients[pid]["created_at"], patients[pid]["checked_in_at"]),
        )
        DB_CONN.commit()
    _audit("intake_created", {"pid": pid, "arrival_window": window})
    return {
        "pid": pid,
        "encounter_id": _ensure_encounter_for_pid(pid, station_id="intake"),
        "token": patients[pid]["token"],
        "redirect": f"/qr/{pid}",
    }


if not _SPA_BUILD:
    @app.get("/qr/{pid}", response_class=HTMLResponse)
    def qr_page(pid: str):
        with STATE_LOCK:
            p = patients.get(pid)
        if not p:
            raise HTTPException(404, "Patient not found.")
        return render(
            "qr.html",
            page="qr",
            pid=pid,
            token=p["token"],
            display_name=f"{p['first_name']} {(p.get('last_name') or ' ')[0]}.",
        )


@app.get("/api/qr/{pid}")
def api_qr(pid: str):
    """JSON for React frontend."""
    with STATE_LOCK:
        p = patients.get(pid)
    if not p:
        raise HTTPException(404, "Patient not found.")
    first = p.get("first_name") or ""
    last = (p.get("last_name") or " ")[:1]
    display_name = f"{first} {last}.".strip() or "Patient"
    return {"pid": pid, "token": p["token"], "display_name": display_name}


@app.get("/qr-img/{pid}")
def qr_image(pid: str):
    with STATE_LOCK:
        if pid not in patients:
            raise HTTPException(404, "Patient not found.")
        payload = f"{pid}|{patients[pid]['token']}"
    img = qrcode.make(payload)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return Response(content=buf.read(), media_type="image/png")


if not _SPA_BUILD:
    @app.get("/kiosk", response_class=HTMLResponse)
    @app.get("/kiosk/", response_class=HTMLResponse)
    def kiosk_page():
        return render("kiosk.html", page="kiosk", checked_in=False, message="", token="", estimated_wait_min=0)


@app.post("/kiosk", response_class=HTMLResponse)
@app.post("/kiosk/", response_class=HTMLResponse)
async def kiosk_checkin(code: str = Form("")):
    result = _kiosk_checkin_result(code)
    if result.get("ok"):
        await _broadcast_queue_update()
    return render(
        "kiosk.html",
        page="kiosk",
        checked_in=result["checked_in"],
        message=result["message"],
        token=result["token"],
        estimated_wait_min=result["estimated_wait_min"],
    )


if not _SPA_BUILD:
    @app.get("/kiosk/camera", response_class=HTMLResponse)
    @app.get("/kiosk/camera/", response_class=HTMLResponse)
    def kiosk_camera_page():
        return render("kiosk_camera.html", page="kiosk_camera")


def _camera_placeholder_jpeg() -> bytes:
    """Single gray frame with text when no camera (e.g. on Render)."""
    try:
        from PIL import Image, ImageDraw
        img = Image.new("RGB", (640, 360), (60, 60, 60))
        draw = ImageDraw.Draw(img)
        draw.text((120, 160), "Camera not available", fill=(200, 200, 200))
        draw.text((140, 200), "Use code entry above", fill=(160, 160, 160))
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=80)
        return buf.getvalue()
    except Exception:
        return b""


@app.get("/camera/stream")
def camera_stream():
    try:
        manager = _camera()
    except Exception:
        # No camera (e.g. Render): serve one placeholder frame so the page doesn't break
        one_frame = _camera_placeholder_jpeg()
        if not one_frame:
            raise HTTPException(503, "Camera unavailable.")
        boundary = b"frame"
        body = b"--" + boundary + b"\r\nContent-Type: image/jpeg\r\n\r\n" + one_frame + b"\r\n"
        return StreamingResponse(iter([body]), media_type="multipart/x-mixed-replace; boundary=" + boundary.decode())

    def frame_generator():
        while True:
            frame = manager.latest_jpeg()
            if frame:
                yield b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + frame + b"\r\n"
            time.sleep(0.04)

    return StreamingResponse(frame_generator(), media_type="multipart/x-mixed-replace; boundary=frame")


@app.get("/api/camera/last-scan")
def api_camera_last_scan():
    """Returns latest QR scan. When no camera (e.g. cloud), returns empty so kiosk uses manual entry."""
    try:
        manager = _camera()
    except Exception:
        return {"value": "", "ts": 0.0, "fresh": False}
    value, ts = manager.last_scan()
    now = time.time()
    fresh = bool(value) and (now - ts) <= 2.0
    return {"value": value, "ts": ts, "fresh": fresh}


@app.post("/api/kiosk-checkin")
async def api_kiosk_checkin(code: str = Form("")):
    result = _kiosk_checkin_result(code)
    if result.get("ok"):
        await _broadcast_queue_update()
    return result


@app.post("/api/kiosk-checkin/json")
async def api_kiosk_checkin_json(body: KioskCheckinRequest):
    """JSON API for React frontend."""
    result = _kiosk_checkin_result(body.code or "")
    if result.get("ok"):
        await _broadcast_queue_update()
    return result


EMERGENCY_LABELS: dict[str, str] = {
    "low_oxygen": "low oxygen emergency",
    "critical_heart_rate": "critical heart rhythm",
    "critical_bp": "critical blood pressure",
    "critical_temp": "critical temperature",
    "heart_attack": "heart attack",
    "chest_pain": "potential cardiac emergency",
    "stroke": "stroke",
    "emergency_symptoms": "medical emergency",
}


@app.get("/api/triage")
def api_triage(token: str = ""):
    """
    Run triage for patient by token: classify priority from vitals + symptoms,
    set patient priority, reorder queue, return message and AI script for kiosk.
    """
    raw = (token or "").strip().upper()
    if not raw:
        raise HTTPException(400, "token required")
    with STATE_LOCK:
        pid = None
        for _pid, p in patients.items():
            if str(p.get("token", "")).upper() == raw:
                pid = _pid
                break
        if not pid:
            raise HTTPException(404, "Patient not found.")
        p = patients[pid]
        vitals = _latest_vitals_for_pid(pid)
        symptoms = (p.get("symptoms") or "").strip()
        ai = p.get("ai_result") or {}
        red_flags = ai.get("red_flag_keywords_detected") or []
        priority, emergency_type = _classify_priority_from_vitals_and_symptoms(vitals, symptoms, red_flags)
        p["priority"] = priority
        p["emergency_type"] = emergency_type
        _reorder_queue_by_priority()
    emergency_label = EMERGENCY_LABELS.get(emergency_type, "medical emergency") if emergency_type else ""
    if priority == "high":
        message = f"You are having the conditions of a {emergency_label} and need to be rushed immediately. A doctor is being notified."
        ai_script = f"You are having the conditions of a {emergency_label} and need to be rushed immediately. A doctor is being notified."
    else:
        level = "Medium" if priority == "medium" else "Low"
        message = f"Your priority is {level}. Please proceed to the waiting room and have a seat. You will be called when it is your turn."
        ai_script = f"Your priority is {level}. Please proceed to the waiting room and have a seat. You will be called when it is your turn."
    return {
        "priority": priority,
        "emergency_type": emergency_type or None,
        "emergency_label": emergency_label or None,
        "message": message,
        "ai_script": ai_script,
    }


@app.post("/api/vitals/submit")
async def api_vitals_submit(
    pid: str = Form(""),
    token: str = Form(""),
    device_id: str = Form("jetson-01"),
    spo2: Optional[float] = Form(None),
    hr: Optional[float] = Form(None),
    temp_c: Optional[float] = Form(None),
    bp_sys: Optional[float] = Form(None),
    bp_dia: Optional[float] = Form(None),
    confidence: float = Form(0.9),
    simulated: int = Form(0),
    ts: str = Form(""),
):
    code = (pid or token or "").strip()
    resolved_pid = _resolve_code(code)
    if not resolved_pid:
        raise HTTPException(404, "Patient not found.")
    with STATE_LOCK:
        p = patients.get(resolved_pid)
        if not p:
            raise HTTPException(404, "Patient not found.")
        vitals_ts = ts or datetime.utcnow().isoformat()
        DB_CONN.execute(
            """
            INSERT INTO vitals(pid, token, device_id, spo2, hr, temp_c, bp_sys, bp_dia, confidence, ts, simulated)
            VALUES(?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                resolved_pid,
                p.get("token", ""),
                device_id,
                spo2,
                hr,
                temp_c,
                bp_sys,
                bp_dia,
                confidence,
                vitals_ts,
                1 if simulated else 0,
            ),
        )
        DB_CONN.commit()
    _audit("vitals_submit", {"pid": resolved_pid, "token": p.get("token"), "device_id": device_id})
    await _broadcast_queue_update()
    return {"ok": True, "pid": resolved_pid, "token": p.get("token"), "ts": vitals_ts}


@app.post("/api/vitals/submit/json")
async def api_vitals_submit_json(body: VitalsSubmitRequest):
    """JSON endpoint for sensor bridge: POST vitals from hardware (Nano, etc.) by token or pid."""
    code = (body.pid or body.token or "").strip()
    resolved_pid = _resolve_code(code)
    if not resolved_pid:
        raise HTTPException(404, "Patient not found.")
    with STATE_LOCK:
        p = patients.get(resolved_pid)
        if not p:
            raise HTTPException(404, "Patient not found.")
        vitals_ts = (body.ts or "").strip() or datetime.utcnow().isoformat()
        DB_CONN.execute(
            """
            INSERT INTO vitals(pid, token, device_id, spo2, hr, temp_c, bp_sys, bp_dia, confidence, ts, simulated)
            VALUES(?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                resolved_pid,
                p.get("token", ""),
                body.device_id or "sensors",
                body.spo2,
                body.hr,
                body.temp_c,
                body.bp_sys,
                body.bp_dia,
                body.confidence,
                vitals_ts,
                1 if body.simulated else 0,
            ),
        )
        DB_CONN.commit()
    _audit("vitals_submit", {"pid": resolved_pid, "token": p.get("token"), "device_id": body.device_id})
    await _broadcast_queue_update()
    return {"ok": True, "pid": resolved_pid, "token": p.get("token"), "ts": vitals_ts}


@app.get("/api/vitals/{pid}")
def api_vitals_pid(request: Request, pid: str):
    _require_staff(request)
    v = _latest_vitals_for_pid(pid)
    return {"ok": True, "vitals": v}


@app.get("/api/vitals/by-token")
def api_vitals_by_token(token: str = ""):
    """Public: return latest vitals for patient by token (for kiosk to show auto-collected vitals)."""
    code = (token or "").strip()
    if not code:
        raise HTTPException(400, "token is required.")
    resolved_pid = _resolve_code(code)
    if not resolved_pid:
        raise HTTPException(404, "Patient not found.")
    v = _latest_vitals_for_pid(resolved_pid)
    return {"ok": True, "vitals": v}


@app.post("/api/vitals/simulate")
async def api_vitals_simulate(request: Request, pid: str = Form("")):
    _require_staff(request)
    if not USE_SIMULATED_VITALS:
        raise HTTPException(400, "Simulated vitals disabled.")
    resolved_pid = _resolve_code(pid)
    if not resolved_pid:
        raise HTTPException(404, "Patient not found.")
    spo2 = random.randint(96, 100)
    hr = random.randint(62, 98)
    temp_c = round(random.uniform(36.4, 37.6), 1)
    bp_sys = random.randint(108, 132)
    bp_dia = random.randint(68, 86)
    return await api_vitals_submit(
        pid=resolved_pid,
        token="",
        device_id="sim-vitals",
        spo2=float(spo2),
        hr=float(hr),
        temp_c=float(temp_c),
        bp_sys=float(bp_sys),
        bp_dia=float(bp_dia),
        confidence=0.89,
        simulated=1,
        ts=datetime.utcnow().isoformat(),
    )


@app.post("/api/insurance/eligibility-check")
def api_insurance_eligibility_check(body: InsuranceEligibilityRequest):
    """
    Run an insurance eligibility/benefits check for this encounter/patient.

    Integration-ready: delegates to a pluggable adapter (e.g. NPHIES/نفيس) and stores
    a normalized EligibilityCheck row plus raw request/response for audit.
    """
    # Resolve patient/encounter
    pid = (body.pid or "").strip()
    token = (body.token or "").strip()
    encounter_id = (body.encounter_id or "").strip()

    if not pid and token:
        resolved = _resolve_code(token)
        if not resolved:
            raise HTTPException(404, "Patient not found for token.")
        pid = resolved
    elif not pid and encounter_id:
        with STATE_LOCK:
            row = DB_CONN.execute(
                "SELECT pid FROM encounters WHERE encounter_id=?",
                (encounter_id,),
            ).fetchone()
        if not row:
            raise HTTPException(404, "Encounter not found.")
        pid = str(row["pid"] or "")

    if not pid:
        raise HTTPException(400, "pid, token, or encounter_id is required.")

    if not body.consent:
        raise HTTPException(400, "Consent is required for insurance eligibility checks.")

    # Ensure encounter exists
    encounter_id = encounter_id or _ensure_encounter_for_pid(pid, station_id="intake-insurance")

    with STATE_LOCK:
        patient = patients.get(pid, {}).copy()
    if not patient:
        raise HTTPException(404, "Patient not found.")

    insurance_payload = {
        "encounter_id": encounter_id,
        "pid": pid,
        "token": patient.get("token"),
        "national_id": (body.national_id or "").strip(),
        "iqama": (body.iqama or "").strip(),
        "passport": (body.passport or "").strip(),
        "insurer_name": (body.insurer_name or "").strip(),
        "policy_number": (body.policy_number or "").strip(),
        "member_id": (body.member_id or "").strip(),
        "dob": patient.get("dob"),
        "phone": patient.get("phone"),
        "consent": bool(body.consent),
    }

    now = datetime.utcnow().isoformat()
    with STATE_LOCK:
        cur = DB_CONN.execute(
            """
            INSERT INTO insurance_profiles(
              encounter_id, pid, national_id, iqama, passport, insurer_name,
              policy_number, member_id, dob, phone, consent, raw_payload, created_at
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                encounter_id,
                pid,
                insurance_payload["national_id"],
                insurance_payload["iqama"],
                insurance_payload["passport"],
                insurance_payload["insurer_name"],
                insurance_payload["policy_number"],
                insurance_payload["member_id"],
                insurance_payload["dob"],
                insurance_payload["phone"],
                1 if insurance_payload["consent"] else 0,
                json.dumps(insurance_payload, ensure_ascii=False),
                now,
            ),
        )
        insurance_profile_id = int(cur.lastrowid)
        DB_CONN.execute(
            "UPDATE encounters SET insurance_profile_id=? WHERE encounter_id=?",
            (insurance_profile_id, encounter_id),
        )
        DB_CONN.commit()

    _audit(
        "eligibility_attempt",
        {
            "encounter_id": encounter_id,
            "pid": pid,
            "insurance_profile_id": insurance_profile_id,
            "insurer_name": insurance_payload["insurer_name"],
        },
    )

    adapter: InsuranceAdapter = get_insurance_adapter(INSURANCE_ADAPTER_NAME)
    adapter_request = {
        "encounter_id": encounter_id,
        "patient": {
            "pid": pid,
            "first_name": patient.get("first_name"),
            "last_name": patient.get("last_name"),
            "dob": patient.get("dob"),
        },
        "insurance": insurance_payload,
    }
    adapter_result = adapter.submit_eligibility_check(adapter_request)

    eligible_val = adapter_result.get("eligible", None)
    if eligible_val is True:
        eligible = "true"
    elif eligible_val is False:
        eligible = "false"
    else:
        eligible = "unknown"
    plan_type = adapter_result.get("plan_type")
    copay_estimate = adapter_result.get("copay_estimate")
    auth_required = (adapter_result.get("authorization_required") or "unknown") or "unknown"

    status = "completed"
    created_at = datetime.utcnow().isoformat()
    with STATE_LOCK:
        cur = DB_CONN.execute(
            """
            INSERT INTO eligibility_checks(
              encounter_id, insurance_profile_id, status, eligible,
              plan_type, copay_estimate, authorization_required,
              raw_request, raw_response, created_at
            ) VALUES (?,?,?,?,?,?,?,?,?,?)
            """,
            (
                encounter_id,
                insurance_profile_id,
                status,
                eligible,
                plan_type,
                copay_estimate,
                auth_required,
                json.dumps(adapter_request, ensure_ascii=False),
                json.dumps(adapter_result, ensure_ascii=False),
                created_at,
            ),
        )
        eligibility_id = int(cur.lastrowid)
        DB_CONN.execute(
            "UPDATE encounters SET eligibility_result_id=? WHERE encounter_id=?",
            (eligibility_id, encounter_id),
        )
        DB_CONN.commit()

    _audit(
        "eligibility_result",
        {
            "encounter_id": encounter_id,
            "pid": pid,
            "eligibility_id": eligibility_id,
            "eligible": eligible,
            "plan_type": plan_type,
            "authorization_required": auth_required,
        },
    )

    return {
        "ok": True,
        "encounter_id": encounter_id,
        "insurance_profile_id": insurance_profile_id,
        "eligibility_id": eligibility_id,
        "normalized": {
            "eligible": eligible,
            "plan_type": plan_type,
            "copay_estimate": copay_estimate,
            "authorization_required": auth_required,
        },
        "adapter": INSURANCE_ADAPTER_NAME,
    }


@app.get("/api/insurance/eligibility/{encounter_id}")
def api_insurance_eligibility(encounter_id: str):
    """
    Return the latest stored eligibility result for an encounter.

    This endpoint returns normalized eligibility data; PHI is limited to encounter_id.
    """
    row = _latest_eligibility_for_encounter(encounter_id)
    if not row:
        return {
            "ok": False,
            "encounter_id": encounter_id,
            "status": "missing",
        }
    return {
        "ok": True,
        "encounter_id": encounter_id,
        "eligibility": row,
    }


@app.post("/api/claims/bundle/{encounter_id}")
def api_claims_bundle(request: Request, encounter_id: str):
    """
    Create a non-diagnostic claim bundle for an encounter.

    Staff-only: requires staff auth. The resulting bundle is stored and also
    returned so UI can render a human-friendly preview.
    """
    _require_staff(request)
    bundle = _build_claim_bundle(encounter_id)
    created_at = datetime.utcnow().isoformat()
    bundle_json = json.dumps(bundle, ensure_ascii=False)
    with STATE_LOCK:
        cur = DB_CONN.execute(
            "INSERT INTO claim_bundles(encounter_id, bundle_json, created_at) VALUES(?,?,?)",
            (encounter_id, bundle_json, created_at),
        )
        bundle_id = int(cur.lastrowid)
        DB_CONN.execute(
            "UPDATE encounters SET claim_bundle_id=? WHERE encounter_id=?",
            (bundle_id, encounter_id),
        )
        DB_CONN.commit()
    _audit("claim_bundle_created", {"encounter_id": encounter_id, "claim_bundle_id": bundle_id})
    return {
        "ok": True,
        "encounter_id": encounter_id,
        "claim_bundle_id": bundle_id,
        "status": "draft",
        "bundle": bundle,
    }


@app.post("/api/claims/submit/{encounter_id}")
def api_claims_submit(request: Request, encounter_id: str):
    """
    Submit the claim bundle for this encounter via the configured adapter.

    Staff-only and non-diagnostic. Returns adapter claim_id and status.
    """
    _require_staff(request)
    bundle = _build_claim_bundle(encounter_id)
    adapter: InsuranceAdapter = get_insurance_adapter(INSURANCE_ADAPTER_NAME)
    adapter_result = adapter.submit_claim_bundle(bundle)
    claim_id = str(adapter_result.get("claim_id") or "")
    status = str(adapter_result.get("status") or "submitted")
    now = datetime.utcnow().isoformat()
    bundle_json = json.dumps(bundle, ensure_ascii=False)
    with STATE_LOCK:
        cur_bundle = DB_CONN.execute(
            "INSERT INTO claim_bundles(encounter_id, bundle_json, created_at) VALUES(?,?,?)",
            (encounter_id, bundle_json, now),
        )
        bundle_id = int(cur_bundle.lastrowid)
        cur_sub = DB_CONN.execute(
            """
            INSERT INTO claim_submissions(
              encounter_id, claim_bundle_id, adapter_name, external_claim_id,
              status, raw_response, created_at, updated_at
            ) VALUES (?,?,?,?,?,?,?,?)
            """,
            (
                encounter_id,
                bundle_id,
                INSURANCE_ADAPTER_NAME,
                claim_id,
                status,
                json.dumps(adapter_result, ensure_ascii=False),
                now,
                now,
            ),
        )
        submission_id = int(cur_sub.lastrowid)
        DB_CONN.execute(
            "UPDATE encounters SET claim_bundle_id=?, claim_status=? WHERE encounter_id=?",
            (bundle_id, status, encounter_id),
        )
        DB_CONN.commit()

    _audit(
        "claim_submitted",
        {
            "encounter_id": encounter_id,
            "claim_bundle_id": bundle_id,
            "claim_id": claim_id,
            "status": status,
        },
    )
    _audit("claim_status_updated", {"encounter_id": encounter_id, "status": status})

    return {
        "ok": True,
        "encounter_id": encounter_id,
        "claim_id": claim_id,
        "status": status,
        "adapter": INSURANCE_ADAPTER_NAME,
        "claim_bundle_id": bundle_id,
        "submission_id": submission_id,
    }


@app.get("/api/claims/status/{encounter_id}")
def api_claims_status(request: Request, encounter_id: str):
    """
    Get the latest known claim status for this encounter.

    Staff-only. For real NPHIES integration, this endpoint could optionally
    refresh status via adapter.check_claim_status before returning.
    """
    _require_staff(request)
    latest = _latest_claim_submission_for_encounter(encounter_id)
    if latest:
        return {
            "ok": True,
            "encounter_id": encounter_id,
            "claim_id": latest.get("external_claim_id"),
            "status": latest.get("status") or "submitted",
            "adapter": latest.get("adapter_name") or INSURANCE_ADAPTER_NAME,
            "updated_at": latest.get("updated_at"),
        }
    # Fall back to encounter row
    with STATE_LOCK:
        row = DB_CONN.execute(
            "SELECT claim_status FROM encounters WHERE encounter_id=?",
            (encounter_id,),
        ).fetchone()
    if not row:
        raise HTTPException(404, "Encounter not found.")
    return {
        "ok": True,
        "encounter_id": encounter_id,
        "status": row["claim_status"] or "draft",
        "adapter": INSURANCE_ADAPTER_NAME,
    }


@app.post("/api/ai/chat")
def api_ai_chat(request: Request, pid: str = Form(""), message: str = Form(""), role: str = Form("patient")):
    text = (message or "").strip()
    if not text:
        return {
            "ok": True,
            "provider": AI_PROVIDER,
            "non_diagnostic": True,
            "reply": "I didn't catch that. Please type or say something.",
            "red_flags": [],
        }
    resolved_pid = _resolve_code(pid) if pid else None
    vitals_context = None
    patient_wait_context = None
    if resolved_pid:
        v = _latest_vitals_for_pid(resolved_pid)
        vitals_context = _format_vitals_context(v)
        patient_wait_context = _format_patient_wait_context(resolved_pid)
    out = _ai_chat_reply(text, vitals_context=vitals_context, patient_wait_context=patient_wait_context)
    with STATE_LOCK:
        DB_CONN.execute(
            "INSERT INTO ai_conversations(pid, role, message, ts) VALUES(?,?,?,?)",
            (resolved_pid or "", role, text, datetime.utcnow().isoformat()),
        )
        DB_CONN.execute(
            "INSERT INTO ai_conversations(pid, role, message, ts) VALUES(?,?,?,?)",
            (resolved_pid or "", "assistant", out["reply"], datetime.utcnow().isoformat()),
        )
        DB_CONN.commit()
    return {
        "ok": True,
        "provider": AI_PROVIDER,
        "non_diagnostic": True,
        "reply": out["reply"],
        "red_flags": out["red_flags"],
    }


@app.post("/api/ai/speak")
def api_ai_speak(body: SpeakRequest):
    """Text-to-speech via OpenAI TTS (tts-1-hd). Returns audio/mpeg. Requires OPENAI_API_KEY."""
    text = (body.text or "").strip()
    if not text:
        raise HTTPException(400, "text is required")
    if not OPENAI_API_KEY:
        raise HTTPException(503, "TTS not configured (missing OPENAI_API_KEY)")
    url = "https://api.openai.com/v1/audio/speech"
    payload = {
        "model": OPENAI_TTS_MODEL,
        "input": text[:4096],
        "voice": OPENAI_TTS_VOICE if OPENAI_TTS_VOICE in ("alloy", "ash", "ballad", "coral", "echo", "fable", "marin", "cedar", "nova", "onyx", "sage", "shimmer", "verse") else "nova",
    }
    try:
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=data,
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {OPENAI_API_KEY}"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            audio_bytes = resp.read()
        return Response(content=audio_bytes, media_type="audio/mpeg")
    except urllib.error.HTTPError as e:
        body_bytes = b""
        try:
            body_bytes = e.read() if e.fp else b""
        except Exception:
            pass
        raise HTTPException(502, f"TTS failed: {e.code}")
    except Exception as e:
        raise HTTPException(502, "TTS failed")


@app.get("/api/ai/tts-available")
def api_ai_tts_available():
    """Whether OpenAI TTS is available (so frontend can show or use it)."""
    return {"available": bool(OPENAI_API_KEY)}


@app.get("/api/ai/status")
def api_ai_status():
    """Diagnostic: see what the deployed app sees for AI (no secrets). Compare local vs production."""
    return {
        "provider": AI_PROVIDER,
        "env": APP_ENV,
        "gemini_key_set": bool(GEMINI_API_KEY),
        "gemini_key_len": len(GEMINI_API_KEY),
        "gemini_model": GEMINI_MODEL,
        "openai_key_set": bool(OPENAI_API_KEY),
        "openai_key_len": len(OPENAI_API_KEY),
        "openai_model": OPENAI_MODEL,
        "tts_available": bool(OPENAI_API_KEY),
        "tts_voice": OPENAI_TTS_VOICE,
        "tts_model": OPENAI_TTS_MODEL,
    }


@app.get("/api/ai/probe")
def api_ai_probe():
    """Run one AI call with current provider and return success or sanitized error (for debugging production). No secrets."""
    if AI_PROVIDER == "openai":
        if not OPENAI_API_KEY:
            return {"ok": False, "provider": "openai", "error": "key_not_set"}
        url = "https://api.openai.com/v1/chat/completions"
        payload = {
            "model": OPENAI_MODEL,
            "messages": [{"role": "user", "content": "Say only: OK"}],
            "max_tokens": 5,
        }
        try:
            data = json.dumps(payload).encode("utf-8")
            req = urllib.request.Request(
                url,
                data=data,
                headers={"Content-Type": "application/json", "Authorization": f"Bearer {OPENAI_API_KEY}"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=15) as resp:
                out = json.loads(resp.read().decode("utf-8"))
            if out.get("error"):
                return {"ok": False, "provider": "openai", "error": "api_error", "detail": str(out["error"])[:200]}
            choices = out.get("choices") or []
            if not choices:
                return {"ok": False, "provider": "openai", "error": "no_choices", "keys": list(out.keys())}
            return {"ok": True, "provider": "openai", "model": OPENAI_MODEL}
        except urllib.error.HTTPError as e:
            body = ""
            try:
                body = e.read().decode("utf-8") if e.fp else ""
            except Exception:
                pass
            return {"ok": False, "provider": "openai", "error": f"http_{e.code}", "detail": body[:300]}
        except Exception as e:
            return {"ok": False, "provider": "openai", "error": type(e).__name__, "detail": str(e)[:200]}
    # Gemini
    if not GEMINI_API_KEY:
        return {"ok": False, "provider": "gemini", "error": "key_not_set"}
    model = GEMINI_MODEL or "gemini-2.5-flash"
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={GEMINI_API_KEY}"
    payload = {
        "contents": [{"parts": [{"text": "Say only: OK"}]}],
        "generationConfig": {"temperature": 0, "maxOutputTokens": 10},
    }
    try:
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            url, data=data, headers={"Content-Type": "application/json"}, method="POST"
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            out = json.loads(resp.read().decode("utf-8"))
        if out.get("error"):
            return {"ok": False, "provider": "gemini", "error": "api_error", "detail": str(out["error"])[:200]}
        cand = out.get("candidates") or []
        if not cand:
            return {"ok": False, "provider": "gemini", "error": "no_candidates", "keys": list(out.keys())}
        return {"ok": True, "provider": "gemini", "model": model}
    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = e.read().decode("utf-8") if e.fp else ""
        except Exception:
            pass
        return {"ok": False, "provider": "gemini", "error": f"http_{e.code}", "detail": body[:300]}
    except urllib.error.URLError as e:
        return {"ok": False, "provider": "gemini", "error": "network", "detail": str(e.reason)[:200]}
    except Exception as e:
        return {"ok": False, "provider": "gemini", "error": type(e).__name__, "detail": str(e)[:200]}


@app.get("/api/lobby-load")
def api_lobby_load():
    return _lobby_load_score()


if not _SPA_BUILD:
    @app.get("/display", response_class=HTMLResponse)
    def display_page():
        return render("display.html", page="display")


@app.get("/api/queue")
def api_public_queue():
    return _public_queue_items()


@app.websocket("/ws/queue")
async def ws_queue(websocket: WebSocket):
    await websocket.accept()
    with STATE_LOCK:
        WS_CLIENTS.add(websocket)
    await websocket.send_text(json.dumps(_queue_snapshot_payload()))
    try:
        while True:
            await websocket.send_text(json.dumps({"type": "ping", "ts": datetime.utcnow().isoformat()}))
            await asyncio.sleep(20)
    except WebSocketDisconnect:
        with STATE_LOCK:
            WS_CLIENTS.discard(websocket)
    except Exception:
        with STATE_LOCK:
            WS_CLIENTS.discard(websocket)


if not _SPA_BUILD:
    @app.get("/staff", response_class=HTMLResponse)
    def staff_page(request: Request):
        if not _is_staff_authenticated(request):
            return RedirectResponse("/staff/login", status_code=302)
        with STATE_LOCK:
            pc = provider_count
        return render("staff.html", page="staff", provider_count=pc)


@app.get("/api/staff-queue")
def api_staff_queue(request: Request):
    _require_staff(request)
    items = _staff_queue_items()
    with STATE_LOCK:
        pc = provider_count
    return {
        "provider_count": pc,
        "avg_wait_min": _avg_wait(items),
        "lane_counts": _lane_counts(items),
        "updated_at": datetime.utcnow().isoformat(),
        "items": items,
    }


@app.post("/api/staff/status/{pid}")
async def api_staff_status(request: Request, pid: str, status: str = Form(...)):
    _require_staff(request)
    with STATE_LOCK:
        if pid not in patients:
            raise HTTPException(404, "Patient not found.")
        if status not in {"called", "in_room", "done"}:
            raise HTTPException(400, "Invalid status.")
        patients[pid]["status"] = status
        if status == "done":
            queue_order[:] = [x for x in queue_order if x != pid]
        DB_CONN.execute("UPDATE patients SET status=? WHERE pid=?", (status, pid))
        DB_CONN.commit()
    _audit("status_change", {"pid": pid, "status": status})
    _queue_event("status_change", pid=pid, token=patients.get(pid, {}).get("token", ""), payload={"status": status})
    await _broadcast_queue_update()
    return {"ok": True}


@app.post("/api/provider-count")
async def api_provider_count(request: Request, count: int = Form(...)):
    _require_staff(request)
    global provider_count
    with STATE_LOCK:
        provider_count = min(3, max(1, int(count)))
        pc = provider_count
    _audit("provider_count_change", {"provider_count": pc})
    _queue_event("provider_count_change", payload={"provider_count": pc})
    await _broadcast_queue_update()
    return {"ok": True, "provider_count": pc}


if not _SPA_BUILD:
    @app.get("/analytics", response_class=HTMLResponse)
    def analytics_page(request: Request):
        if not _is_staff_authenticated(request):
            return RedirectResponse("/staff/login", status_code=302)
        with STATE_LOCK:
            pc = provider_count
        return render("analytics.html", page="analytics", provider_count=pc)

    @app.get("/privacy", response_class=HTMLResponse)
    def privacy_page():
        return render("privacy.html", page="privacy")


@app.get("/api/analytics")
def api_analytics(request: Request, providers: Optional[int] = None):
    _require_staff(request)
    with STATE_LOCK:
        current_provider = provider_count
    providers = min(3, max(1, providers or current_provider))
    forecast = _forecast(providers)
    items = _staff_queue_items()
    return {
        "provider_count": providers,
        "current_queue": len(items),
        "current_avg_wait": _avg_wait(items),
        "current_peak_wait": max([i["estimated_wait_min"] for i in items], default=0),
        "lane_counts": _lane_counts(items),
        "forecast": forecast,
    }


@app.post("/demo/seed")
async def demo_seed(request: Request):
    _require_staff(request)
    _seed_demo_patients()
    _audit("demo_seed", {"demo_mode": True})
    await _broadcast_queue_update()
    return {"ok": True, "demo_mode": True}


@app.post("/demo/reset")
async def demo_reset(request: Request):
    _require_staff(request)
    _reset_state()
    _audit("demo_reset", {"demo_mode": False})
    await _broadcast_queue_update()
    return {"ok": True, "demo_mode": False}


if not _SPA_BUILD:
    @app.get("/staff/login", response_class=HTMLResponse)
    def staff_login_page(request: Request):
        if _is_staff_authenticated(request):
            return RedirectResponse("/staff", status_code=302)
        return render("staff_login.html", page="staff_login", error="")


@app.post("/staff/login", response_class=HTMLResponse)
def staff_login_submit(request: Request, password: str = Form("")):
    ip = _client_ip(request)
    now = time.time()
    with STATE_LOCK:
        attempts = [ts for ts in LOGIN_ATTEMPTS_BY_IP.get(ip, []) if now - ts < 60]
        if len(attempts) >= 5:
            return render("staff_login.html", page="staff_login", error="Too many attempts. Please wait a minute.")
        if password not in (STAFF_ACCESS_PASSWORD, STAFF_FALLBACK_PASSWORD):
            attempts.append(now)
            LOGIN_ATTEMPTS_BY_IP[ip] = attempts
            return render("staff_login.html", page="staff_login", error="Invalid staff password.")
        LOGIN_ATTEMPTS_BY_IP[ip] = []
    response = RedirectResponse("/staff", status_code=302)
    response.set_cookie(
        STAFF_SESSION_COOKIE,
        _create_staff_session_value(),
        max_age=STAFF_SESSION_TTL_MINUTES * 60,
        httponly=True,
        secure=FORCE_HTTPS,
        samesite="lax",
    )
    _audit("staff_login", {"ip": ip})
    return response


@app.post("/api/staff/login")
def api_staff_login(request: Request, body: StaffLoginRequest):
    """JSON API for React frontend. Sets cookie and returns redirect."""
    ip = _client_ip(request)
    now = time.time()
    with STATE_LOCK:
        attempts = [ts for ts in LOGIN_ATTEMPTS_BY_IP.get(ip, []) if now - ts < 60]
        if len(attempts) >= 5:
            raise HTTPException(429, "Too many attempts. Please wait a minute.")
        if (body.password or "") not in (STAFF_ACCESS_PASSWORD, STAFF_FALLBACK_PASSWORD):
            attempts.append(now)
            LOGIN_ATTEMPTS_BY_IP[ip] = attempts
            raise HTTPException(401, "Invalid staff password.")
        LOGIN_ATTEMPTS_BY_IP[ip] = []
    response = Response(
        content=json.dumps({"ok": True, "redirect": "/staff"}),
        media_type="application/json",
        status_code=200,
    )
    response.set_cookie(
        STAFF_SESSION_COOKIE,
        _create_staff_session_value(),
        max_age=STAFF_SESSION_TTL_MINUTES * 60,
        httponly=True,
        secure=FORCE_HTTPS,
        samesite="lax",
    )
    _audit("staff_login", {"ip": ip})
    return response


@app.post("/staff/logout")
def staff_logout():
    response = RedirectResponse("/staff/login", status_code=302)
    response.delete_cookie(STAFF_SESSION_COOKIE)
    return response


@app.get("/api/audit")
def api_audit(request: Request):
    _require_staff(request)
    with STATE_LOCK:
        events = list(AUDIT_LOG)
    return {"count": len(events), "events": events}


if _SPA_BUILD:
    _SPA_INDEX = str(_FRONTEND_DIST / "index.html")

    @app.get("/favicon.svg", include_in_schema=False)
    def favicon():
        p = _FRONTEND_DIST / "favicon.svg"
        if p.is_file():
            return FileResponse(str(p), media_type="image/svg+xml")
        return Response(status_code=204)

    @app.get("/meta.json", include_in_schema=False)
    def meta_json():
        return Response(
            content=json.dumps({"name": "CarePilot Urgent", "version": APP_VERSION}),
            media_type="application/json",
        )

    @app.get("/{path:path}", response_class=HTMLResponse)
    def spa_serve(request: Request, path: str):
        if any(path.startswith(p) for p in ("api/", "assets/", "static/", "docs", "openapi", "redoc")) or path in ("healthz", "readyz"):
            raise HTTPException(404, "Not Found")
        if any(path.startswith(p) for p in ("camera", "qr-img/")):
            raise HTTPException(404, "Not Found")
        if path in ("", "intake", "patient-station", "kiosk-station", "kiosk", "display", "waiting-room-station", "staff", "analytics", "privacy") or path.startswith("staff/") or path.startswith("kiosk-station/") or path.startswith("kiosk/") or path.startswith("qr/"):
            if "text/html" in (request.headers.get("accept") or ""):
                return FileResponse(_SPA_INDEX, media_type="text/html")
        raise HTTPException(404, "Not Found")


@app.on_event("shutdown")
def shutdown_camera_manager():
    global camera_manager
    with STATE_LOCK:
        manager = camera_manager
        camera_manager = None
        WS_CLIENTS.clear()
    if manager is not None:
        manager.stop()


@app.on_event("startup")
def startup_init():
    _init_db()
    if DEMO_MODE_FLAG:
        _seed_demo_patients()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host=HOST, port=PORT, reload=APP_ENV != "production")
