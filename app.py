"""
CarePilot Urgent - Hackathon Winner Edition.

Run:
  pip install -r requirements.txt
  uvicorn app:app --reload --host 0.0.0.0 --port 8000
"""

import io
import os
import random
import re
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Optional

import qrcode
from fastapi import FastAPI, Form, HTTPException, Request
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import HTMLResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from jinja2 import Environment, FileSystemLoader
from starlette.middleware.httpsredirect import HTTPSRedirectMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware

# -----------------------------------------------------------------------------
# App + storage
# -----------------------------------------------------------------------------
APP_VERSION = "3.1"
APP_ENV = os.getenv("APP_ENV", "development").lower()
PORT = int(os.getenv("PORT", "8000"))
HOST = os.getenv("HOST", "0.0.0.0")
FORCE_HTTPS = os.getenv("FORCE_HTTPS", "0") == "1"
ENABLE_DOCS = os.getenv("ENABLE_DOCS", "1" if APP_ENV != "production" else "0") == "1"
TRUSTED_HOSTS = [h.strip() for h in os.getenv("TRUSTED_HOSTS", "*").split(",") if h.strip()] or ["*"]
patients: dict[str, dict[str, Any]] = {}
queue_order: list[str] = []
provider_count = 1
demo_mode = False
issued_tokens: set[str] = set()
arrival_windows_count = {"now": 0, "soon": 0, "later": 0}

_TEMPLATES_DIR = Path(__file__).resolve().parent / "templates"
_STATIC_DIR = Path(__file__).resolve().parent / "static"

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
env = Environment(loader=FileSystemLoader(str(_TEMPLATES_DIR)))


def render(name: str, **kwargs: Any) -> str:
    base = {
        "version": APP_VERSION,
        "nav_items": ["intake", "kiosk", "display", "staff", "analytics"],
        "demo_mode": demo_mode,
    }
    base.update(kwargs)
    return env.get_template(name).render(**base)


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
    "chest pain", "difficulty breathing", "can't breathe", "unconscious", "seizure",
    "bleeding heavily", "stroke", "heart attack", "anaphylaxis", "overdose",
]


def _extract_duration_days(duration: str) -> int:
    text = (duration or "").lower()
    m = re.search(r"(\d+)", text)
    n = int(m.group(1)) if m else 1
    if "week" in text:
        return n * 7
    if "month" in text:
        return n * 30
    return n


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


def ai_structure_symptoms(symptoms: str, duration: str, age_optional: Optional[int]) -> dict[str, Any]:
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

    for c in candidates:
        if c in patients:
            return c
        for pid, p in patients.items():
            if str(p.get("token", "")).upper() == c:
                return pid
    return None


def _simulate_wait_map(pids: list[str], providers: int) -> dict[str, int]:
    slots = [0] * max(1, providers)
    wait: dict[str, int] = {}
    for pid in pids:
        p = patients.get(pid)
        if not p:
            continue
        dur = int(p.get("ai_result", {}).get("estimated_visit_duration_minutes", 20))
        idx = slots.index(min(slots))
        wait[pid] = slots[idx]
        slots[idx] += dur
    return wait


def _queue_active() -> list[str]:
    return [pid for pid in queue_order if pid in patients and patients[pid].get("status") != "done"]


def _public_queue_items() -> list[dict[str, Any]]:
    active = _queue_active()
    waits = _simulate_wait_map(active, provider_count)
    out = []
    for pid in active:
        p = patients[pid]
        out.append({
            "token": p.get("token"),
            "status_label": status_label(p.get("status", "waiting")),
            "estimated_wait_min": waits.get(pid, 0),
        })
    return out


def _staff_queue_items() -> list[dict[str, Any]]:
    active = _queue_active()
    waits = _simulate_wait_map(active, provider_count)
    out = []
    for pid in active:
        p = patients[pid]
        ai = p.get("ai_result", {})
        out.append({
            "id": pid,
            "token": p.get("token"),
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
        })
    return out


def _avg_wait(items: list[dict[str, Any]]) -> int:
    waits = [i["estimated_wait_min"] for i in items if i.get("status") in {"waiting", "called"}]
    return int(sum(waits) / len(waits)) if waits else 0


def _forecast(provider_override: Optional[int] = None) -> dict[str, Any]:
    providers = provider_override or provider_count
    now = datetime.utcnow()
    seed = int(now.strftime("%Y%m%d%H")) * 10 + (now.minute // 6)
    rng = random.Random(seed)
    base = [
        1 + arrival_windows_count["now"] * 0.4,
        2 + arrival_windows_count["now"] * 0.5,
        3 + arrival_windows_count["soon"] * 0.7,
        4 + arrival_windows_count["soon"] * 0.8,
        4 + arrival_windows_count["later"] * 0.6,
        3 + arrival_windows_count["later"] * 0.5,
        2 + arrival_windows_count["later"] * 0.4,
        1 + arrival_windows_count["now"] * 0.3,
    ]
    arrivals = [max(0, int(round(v + rng.uniform(-0.4, 0.4)))) for v in base]
    avg_duration = 20
    current_items = _staff_queue_items()
    current_peak = max([i["estimated_wait_min"] for i in current_items], default=0)
    future_wait = [max(0, int(current_peak + (sum(arrivals[:i + 1]) * avg_duration / max(providers, 1)) - i * 8)) for i in range(len(arrivals))]
    drop_to = max(0, int(max(future_wait) * max(provider_count, 1) / max(providers, 1)))
    if max(future_wait) > 45:
        recommendation = f"Add 1 provider for next peak window; projected peak drops to ~{drop_to} min."
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
        ai = ai_structure_symptoms(symptoms, duration, age)
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
            "created_at": datetime.utcnow().isoformat(),
            "checked_in_at": datetime.utcnow().isoformat(),
        }
        queue_order.append(pid)
        arrival_windows_count[window] += 1
    demo_mode = True


def _reset_state() -> None:
    global provider_count, demo_mode
    patients.clear()
    queue_order.clear()
    issued_tokens.clear()
    arrival_windows_count.update({"now": 0, "soon": 0, "later": 0})
    provider_count = 1
    demo_mode = False


def _wait_for_pid(pid: str) -> int:
    active = _queue_active()
    waits = _simulate_wait_map(active, provider_count)
    return waits.get(pid, 0)


# -----------------------------------------------------------------------------
# Routes
# -----------------------------------------------------------------------------
@app.get("/", response_class=HTMLResponse)
def home():
    return RedirectResponse("/intake", status_code=302)


@app.get("/api/ping")
def api_ping():
    return {"status": "ok", "app": "CarePilot Urgent", "version": APP_VERSION, "env": APP_ENV}


@app.get("/healthz")
def healthz():
    return {"status": "ok"}


@app.get("/readyz")
def readyz():
    return {"status": "ready", "patients_loaded": len(patients), "queue_size": len(_queue_active())}


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
    ai = ai_structure_symptoms(symptoms, duration_text, age)
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
        "created_at": datetime.utcnow().isoformat(),
        "checked_in_at": None,
    }
    arrival_windows_count[window] += 1
    return RedirectResponse(request.url_for("qr_page", pid=pid), status_code=302)


@app.get("/qr/{pid}", response_class=HTMLResponse)
def qr_page(pid: str):
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


@app.get("/qr-img/{pid}")
def qr_image(pid: str):
    if pid not in patients:
        raise HTTPException(404, "Patient not found.")
    payload = f"{pid}|{patients[pid]['token']}"
    img = qrcode.make(payload)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return Response(content=buf.read(), media_type="image/png")


@app.get("/kiosk", response_class=HTMLResponse)
@app.get("/kiosk/", response_class=HTMLResponse)
def kiosk_page():
    return render("kiosk.html", page="kiosk", checked_in=False, message="", token="", estimated_wait_min=0)


@app.post("/kiosk", response_class=HTMLResponse)
@app.post("/kiosk/", response_class=HTMLResponse)
def kiosk_checkin(code: str = Form("")):
    pid = _resolve_code(code)
    if not pid:
        return render("kiosk.html", page="kiosk", checked_in=False, message="Code not found.", token="", estimated_wait_min=0)

    p = patients[pid]
    if p.get("status") != "pending":
        wait = _wait_for_pid(pid)
        return render(
            "kiosk.html",
            page="kiosk",
            checked_in=True,
            message="Already checked in.",
            token=p["token"],
            estimated_wait_min=wait,
        )

    p["status"] = "waiting"
    p["checked_in_at"] = datetime.utcnow().isoformat()
    if pid not in queue_order:
        queue_order.append(pid)

    wait = _wait_for_pid(pid)
    return render(
        "kiosk.html",
        page="kiosk",
        checked_in=True,
        message="You are checked in.",
        token=p["token"],
        estimated_wait_min=wait,
    )


@app.get("/display", response_class=HTMLResponse)
def display_page():
    return render("display.html", page="display")


@app.get("/api/queue")
def api_public_queue():
    return _public_queue_items()


@app.get("/staff", response_class=HTMLResponse)
def staff_page():
    return render("staff.html", page="staff", provider_count=provider_count)


@app.get("/api/staff-queue")
def api_staff_queue():
    items = _staff_queue_items()
    return {"provider_count": provider_count, "avg_wait_min": _avg_wait(items), "items": items}


@app.post("/api/staff/status/{pid}")
def api_staff_status(pid: str, status: str = Form(...)):
    if pid not in patients:
        raise HTTPException(404, "Patient not found.")
    if status not in {"called", "in_room", "done"}:
        raise HTTPException(400, "Invalid status.")
    patients[pid]["status"] = status
    if status == "done":
        queue_order[:] = [x for x in queue_order if x != pid]
    return {"ok": True}


@app.post("/api/provider-count")
def api_provider_count(count: int = Form(...)):
    global provider_count
    provider_count = min(3, max(1, int(count)))
    return {"ok": True, "provider_count": provider_count}


@app.get("/analytics", response_class=HTMLResponse)
def analytics_page():
    return render("analytics.html", page="analytics", provider_count=provider_count)


@app.get("/api/analytics")
def api_analytics(providers: Optional[int] = None):
    providers = min(3, max(1, providers or provider_count))
    forecast = _forecast(providers)
    items = _staff_queue_items()
    return {
        "provider_count": providers,
        "current_queue": len(items),
        "current_avg_wait": _avg_wait(items),
        "current_peak_wait": max([i["estimated_wait_min"] for i in items], default=0),
        "forecast": forecast,
    }


@app.post("/demo/seed")
def demo_seed():
    _seed_demo_patients()
    return RedirectResponse("/staff", status_code=302)


@app.post("/demo/reset")
def demo_reset():
    _reset_state()
    return RedirectResponse("/staff", status_code=302)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host=HOST, port=PORT, reload=APP_ENV != "production")
