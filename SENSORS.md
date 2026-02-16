# Automatic vitals from sensors (e.g. Jetson Nano)

Vitals can be sent **automatically** from hardware (SpO2, HR, temp, BP) into CarePilot so staff and the kiosk see live readings without manual entry.

## 1. API for sensors

The app accepts vitals via **JSON** so a small script or daemon on the Nano can POST readings:

- **Endpoint:** `POST /api/vitals/submit/json`
- **Body:** `{ "token": "UC-1234", "device_id": "jetson-01", "spo2": 98, "hr": 72, "temp_c": 36.6, "bp_sys": 120, "bp_dia": 80, "confidence": 0.9, "simulated": 0 }`
- **Patient:** Use the patient’s **token** (e.g. from the kiosk after they check in). The API resolves the patient from token or pid.

## 2. Sensor bridge script (Nano)

A Python script reads from sensors (or simulated values) and POSTs to your CarePilot instance.

**On the Nano (or any machine with Python):**

```bash
pip install requests
export CAREPILOT_URL=https://carepilot-urgent.onrender.com
export CAREPILOT_TOKEN=UC-1234
python scripts/sensor_bridge.py
```

- **CAREPILOT_URL** – your CarePilot server (local or deployed).
- **CAREPILOT_TOKEN** – the patient’s token (from kiosk check-in). Optional: **CAREPILOT_PID** or **CAREPILOT_TOKEN_FILE=/path/to/token.txt** (one line = token).
- **CAREPILOT_INTERVAL=10** – seconds between submissions (default 10).
- **CAREPILOT_DEVICE_ID=jetson-nano-01** – label for this device in the API.

The script runs until you stop it (Ctrl+C). Vitals appear in the staff queue and on the kiosk for that patient.

## 3. Simulated vs real sensors

By default the bridge uses **simulated** vitals (random plausible values) so you can test without hardware.

To use **real sensors**, set **CAREPILOT_SENSOR_MODE** and implement the reader in `scripts/sensor_bridge.py`:

| Mode        | Typical hardware   | Notes |
|------------|--------------------|--------|
| `simulated` | none               | Default; random SpO2, HR, temp, BP. |
| `max30102`  | Max30102 (I2C)     | HR + SpO2 from finger. Implement `read_vitals_max30102()` using your I2C driver. |
| `ds18b20`   | DS18B20 (1-Wire)   | Temperature. Implement `read_vitals_ds18b20()` reading from `/sys/bus/w1/...`. |

Example for **Max30102** (Jetson Nano I2C):

- Wire SDA/SCL/VIN/GND; install a Max30102 library or use a small driver that returns HR and SpO2 from the PPG signal.
- In `sensor_bridge.py`, in `read_vitals_max30102()`, call your driver and return e.g. `{"spo2": 98, "hr": 72, "confidence": 0.85, "simulated": 0}`.
- Run with `CAREPILOT_SENSOR_MODE=max30102`.

For **temperature only** (e.g. DS18B20):

- Implement `read_vitals_ds18b20()` to read from the 1-Wire interface and return `{"temp_c": 36.6, "simulated": 0}`.
- You can combine with simulated HR/SpO2 or another sensor by merging dicts in a custom `read_vitals()`.

## 4. Flow for demo / testing

1. Patient checks in at the kiosk (scan QR or enter token) → they see their token, e.g. **UC-1234**.
2. On the Nano (or laptop):  
   `export CAREPILOT_TOKEN=UC-1234`  
   `python scripts/sensor_bridge.py`
3. Bridge sends vitals every 10 seconds to CarePilot. Staff and kiosk see live vitals for that patient.
4. To switch patients, stop the script (Ctrl+C), set **CAREPILOT_TOKEN** to the new token, and run the script again.

Optionally, another process can write the current kiosk token to a file and you set **CAREPILOT_TOKEN_FILE** so the bridge always sends vitals for the last checked-in patient.

---

## 5. Fully automatic flow (no patient entry)

The kiosk page **does not ask the patient to enter vitals**. When a patient checks in (QR or code), the system:

1. **Kiosk** sends the patient’s token to a small **token receiver** running on the same machine (e.g. Nano).
2. The **sensor bridge** reads that token from a file and POSTs vitals to the API for that patient.
3. The **kiosk** polls the API and shows “Collecting vitals from sensors…” then displays the values as they arrive.

**On the kiosk machine (e.g. Jetson Nano), run two processes:**

**Terminal 1 – token receiver** (so the kiosk can tell the bridge who the current patient is):

```bash
export TOKEN_FILE=/tmp/carepilot_current_token.txt
python scripts/token_receiver.py
```

Listens on port 9999. When the kiosk page has a check-in, it POSTs the token to `http://localhost:9999/current-token`; the receiver writes it to `TOKEN_FILE`.

**Terminal 2 – sensor bridge** (reads sensors and sends vitals for the current token):

```bash
export CAREPILOT_URL=https://carepilot-urgent.onrender.com
export CAREPILOT_TOKEN_FILE=/tmp/carepilot_current_token.txt
python scripts/sensor_bridge.py
```

The bridge re-reads the token file each time, so when a new patient checks in, the next submission uses their token. Vitals appear on the kiosk and in the staff queue automatically. The patient never types vitals; manual entry is only a fallback (“Enter manually if sensors didn’t work”).
