#!/usr/bin/env python3
"""
CarePilot sensor bridge: read vitals from hardware (or simulated) and POST to the API.

Run on the Jetson Nano (or any machine with sensors). Sends vitals for the patient
identified by token/pid so staff and kiosk see live readings.

Usage:
  export CAREPILOT_URL=https://carepilot-urgent.onrender.com
  export CAREPILOT_TOKEN=UC-1234    # or CAREPILOT_PID=ABC12DEF
  python scripts/sensor_bridge.py

Optional: CAREPILOT_TOKEN_FILE=/path/to/token.txt  (read token from file, one line)
          CAREPILOT_INTERVAL=10  (seconds between submissions, default 10)
          CAREPILOT_DEVICE_ID=jetson-nano-01
"""

import json
import os
import random
import sys
import time
from pathlib import Path

try:
    import requests
except ImportError:
    print("Install requests: pip install requests", file=sys.stderr)
    sys.exit(1)

# -----------------------------------------------------------------------------
# Configuration
# -----------------------------------------------------------------------------
BASE_URL = os.getenv("CAREPILOT_URL", "http://localhost:8000").rstrip("/")
INTERVAL = int(os.getenv("CAREPILOT_INTERVAL", "10"))
DEVICE_ID = os.getenv("CAREPILOT_DEVICE_ID", "jetson-01")


def get_token_or_pid() -> str:
    token_file = os.getenv("CAREPILOT_TOKEN_FILE")
    if token_file and Path(token_file).exists():
        with open(token_file) as f:
            return (f.read() or "").strip()
    return (os.getenv("CAREPILOT_TOKEN") or os.getenv("CAREPILOT_PID") or "").strip()


# -----------------------------------------------------------------------------
# Vitals readers (plug in real hardware here)
# -----------------------------------------------------------------------------

def read_vitals_simulated() -> dict:
    """Plausible random vitals for testing without hardware."""
    return {
        "spo2": round(random.uniform(96, 100), 1),
        "hr": random.randint(62, 88),
        "temp_c": round(random.uniform(36.2, 37.2), 1),
        "bp_sys": random.randint(112, 128),
        "bp_dia": random.randint(70, 82),
        "confidence": 0.9,
        "simulated": 1,
    }


def read_vitals_max30102() -> dict:
    """Example: Max30102 (I2C) for HR and SpO2. Uncomment and install max30102 lib."""
    # import max30102  # pip install max30102  or use your driver
    # m = max30102.MAX30102()
    # red, ir = m.read_fifo()  # then compute HR and SpO2 from PPG
    # return {"spo2": spo2, "hr": hr, "confidence": 0.85, "simulated": 0}
    return read_vitals_simulated()


def read_vitals_ds18b20() -> dict:
    """Example: DS18B20 (1-Wire) temperature. Uncomment and wire to GPIO."""
    # with open("/sys/bus/w1/devices/28-.../temperature") as f:
    #     temp_c = int(f.read().strip()) / 1000.0
    # return {"temp_c": temp_c, "simulated": 0}
    return read_vitals_simulated()


def read_vitals() -> dict:
    """Read from sensors. Change to read_vitals_max30102() etc. when hardware is wired."""
    mode = os.getenv("CAREPILOT_SENSOR_MODE", "simulated").lower()
    if mode == "max30102":
        return read_vitals_max30102()
    if mode == "ds18b20":
        return read_vitals_ds18b20()
    return read_vitals_simulated()


# -----------------------------------------------------------------------------
# Submit to CarePilot
# -----------------------------------------------------------------------------

def submit_vitals(token_or_pid: str, vitals: dict) -> bool:
    url = f"{BASE_URL}/api/vitals/submit/json"
    # API accepts either token (e.g. UC-1234) or pid (8-char); it resolves the patient
    payload = {
        "token": token_or_pid,
        "pid": "",
        "device_id": DEVICE_ID,
        "confidence": vitals.get("confidence", 0.9),
        "simulated": vitals.get("simulated", 0),
    }
    if vitals.get("spo2") is not None:
        payload["spo2"] = vitals["spo2"]
    if vitals.get("hr") is not None:
        payload["hr"] = vitals["hr"]
    if vitals.get("temp_c") is not None:
        payload["temp_c"] = vitals["temp_c"]
    if vitals.get("bp_sys") is not None:
        payload["bp_sys"] = vitals["bp_sys"]
    if vitals.get("bp_dia") is not None:
        payload["bp_dia"] = vitals["bp_dia"]
    try:
        r = requests.post(url, json=payload, timeout=10)
        if r.status_code == 200:
            return True
        print(f"API {r.status_code}: {r.text[:200]}", file=sys.stderr)
    except Exception as e:
        print(f"Request error: {e}", file=sys.stderr)
    return False


def main():
    token_or_pid = get_token_or_pid()
    if not token_or_pid:
        print("Set CAREPILOT_TOKEN or CAREPILOT_PID (or CAREPILOT_TOKEN_FILE).", file=sys.stderr)
        sys.exit(1)
    print(f"Sensor bridge → {BASE_URL}  token/pid={token_or_pid}  every {INTERVAL}s  device={DEVICE_ID}")
    print("Press Ctrl+C to stop.")
    while True:
        vitals = read_vitals()
        ok = submit_vitals(token_or_pid, vitals)
        status = "OK" if ok else "FAIL"
        parts = [f"{k}={v}" for k, v in vitals.items() if v is not None and k not in ("confidence", "simulated")]
        print(f"[{status}] {', '.join(parts)}")
        time.sleep(INTERVAL)


if __name__ == "__main__":
    main()
