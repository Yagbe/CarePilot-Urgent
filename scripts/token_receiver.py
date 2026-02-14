#!/usr/bin/env python3
"""
CarePilot token receiver: runs on the kiosk machine (e.g. Jetson Nano).
The kiosk browser POSTs the current patient token here when someone checks in;
the sensor bridge reads that token and sends vitals for that patient.

Usage on the Nano:
  1. Start the token receiver (writes token to file):
       export TOKEN_FILE=/tmp/carepilot_current_token.txt
       python scripts/token_receiver.py
  2. Start the sensor bridge with the same file:
       export CAREPILOT_TOKEN_FILE=/tmp/carepilot_current_token.txt
       export CAREPILOT_URL=https://your-app.onrender.com
       python scripts/sensor_bridge.py

When a patient checks in at the kiosk, the page POSTs to http://localhost:9999/current-token
and this script writes the token to TOKEN_FILE. The bridge then uses it on its next run.
"""

import json
import os
import sys
from http.server import HTTPServer, BaseHTTPRequestHandler

PORT = int(os.getenv("TOKEN_RECEIVER_PORT", "9999"))
TOKEN_FILE = os.getenv("TOKEN_FILE", "/tmp/carepilot_current_token.txt")


class TokenHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != "/current-token" and self.path != "/current-token/":
            self.send_response(404)
            self.end_headers()
            return
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length) if content_length else b""
        try:
            data = json.loads(body.decode("utf-8"))
            token = (data.get("token") or "").strip()
            if token:
                with open(TOKEN_FILE, "w") as f:
                    f.write(token + "\n")
                sys.stderr.write(f"Token written: {token}\n")
        except Exception as e:
            sys.stderr.write(f"Error: {e}\n")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"ok":true}')

    def log_message(self, format, *args):
        sys.stderr.write("%s - %s\n" % (self.log_date_time_string(), format % args))


def main():
    server = HTTPServer(("0.0.0.0", PORT), TokenHandler)
    print(f"Token receiver listening on port {PORT}. Writing to {TOKEN_FILE}")
    print("When kiosk checks in a patient, token is saved so sensor_bridge can send vitals.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == "__main__":
    main()
