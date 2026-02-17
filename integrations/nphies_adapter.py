"""
Insurance / NPHIES (نفيس) integration adapters.

Design goals:
- Pluggable: adapters selected via INSURANCE_ADAPTER env var (e.g. "mock", "nphies").
- Integration-ready: this file defines clear call shapes for eligibility and claims
  without hard-coding any proprietary URLs or credentials.
- Safe for demo: MockNphiesAdapter simulates responses for hackathon/demo flows.
"""

from __future__ import annotations

import random
import time
from typing import Any, Dict, Protocol


class InsuranceAdapter(Protocol):
    """Protocol for insurance / NPHIES adapters."""

    def submit_eligibility_check(self, payload: dict[str, Any]) -> dict[str, Any]:
        """
        Submit an eligibility/benefits check.

        Expected normalized response keys (adapter may include more):
        - eligible: True/False/None (None = unknown)
        - plan_type: Optional[str]
        - copay_estimate: Optional[float]
        - authorization_required: "yes" | "no" | "unknown"
        """

    def submit_claim_bundle(self, bundle: dict[str, Any]) -> dict[str, Any]:
        """
        Submit a non-diagnostic encounter bundle as a claim.

        Expected normalized response keys:
        - claim_id: str
        - status: str (e.g. "submitted", "accepted", "rejected", "pending")
        """

    def check_claim_status(self, claim_id: str) -> dict[str, Any]:
        """
        Check claim status by claim identifier.

        Expected normalized response keys:
        - claim_id: str
        - status: str
        """


class MockNphiesAdapter:
    """
    Mock adapter used for demos and tests.

    It simulates latency and returns deterministic but fake responses so
    the rest of the system can be exercised without live NPHIES access.
    """

    def __init__(self, latency_ms: int = 400) -> None:
        self.latency_ms = latency_ms

    def _sleep(self) -> None:
        if self.latency_ms <= 0:
            return
        time.sleep(self.latency_ms / 1000.0)

    def submit_eligibility_check(self, payload: dict[str, Any]) -> dict[str, Any]:
        self._sleep()
        seed = hash(repr(payload)) & 0xFFFF
        rng = random.Random(seed)
        eligible_flag = rng.choice([True, True, True, False])  # skew towards eligible
        plan_type = rng.choice(["Basic", "Standard", "Premium"])
        copay = rng.choice([0.0, 10.0, 20.0, 50.0])
        auth_required = rng.choice(["no", "no", "unknown", "yes"])
        return {
            "adapter": "mock",
            "eligible": eligible_flag,
            "plan_type": plan_type,
            "copay_estimate": copay,
            "authorization_required": auth_required,
            "raw": {
                "echo_payload": payload,
            },
        }

    def submit_claim_bundle(self, bundle: dict[str, Any]) -> dict[str, Any]:
        self._sleep()
        enc_id = str(bundle.get("encounter_id") or "")
        suffix = hex(abs(hash(enc_id)) & 0xFFFF)[2:].upper() or "MOCK"
        claim_id = f"MOCK-{suffix}"
        status = "submitted"
        return {
            "adapter": "mock",
            "claim_id": claim_id,
            "status": status,
            "raw": {"echo_bundle_meta": {"encounter_id": enc_id}},
        }

    def check_claim_status(self, claim_id: str) -> dict[str, Any]:
        self._sleep()
        # Simple deterministic status progression based on hash
        h = abs(hash(claim_id)) % 100
        if h < 10:
            status = "rejected"
        elif h < 40:
            status = "pending"
        else:
            status = "accepted"
        return {
            "adapter": "mock",
            "claim_id": claim_id,
            "status": status,
        }


def get_insurance_adapter(adapter_name: str) -> InsuranceAdapter:
    """
    Factory to obtain an InsuranceAdapter implementation.

    For production NPHIES integration, add a concrete adapter here that
    reads base URLs and credentials from environment variables, for example:

    - NPHIES_BASE_URL
    - NPHIES_CLIENT_ID / NPHIES_CLIENT_SECRET
    - NPHIES_TENANT or similar identifiers
    """
    name = (adapter_name or "").strip().lower()
    if not name or name == "mock":
        return MockNphiesAdapter()

    # Placeholder: real NPHIES adapter would go here.
    # For now, fall back to the mock so the rest of the app works.
    return MockNphiesAdapter()

