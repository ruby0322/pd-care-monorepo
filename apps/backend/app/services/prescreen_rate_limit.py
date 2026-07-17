from __future__ import annotations

import threading
import time


class PrescreenRateLimiter:
    """Process-local min-interval gate keyed by patient id."""

    def __init__(self, *, min_interval_seconds: float = 1.0) -> None:
        self._min_interval_seconds = min_interval_seconds
        self._lock = threading.Lock()
        self._last_accepted_at: dict[int, float] = {}

    def allow(self, patient_id: int) -> bool:
        now = time.monotonic()
        with self._lock:
            last = self._last_accepted_at.get(patient_id)
            if last is not None and (now - last) < self._min_interval_seconds:
                return False
            self._last_accepted_at[patient_id] = now
            return True

    def reset(self) -> None:
        with self._lock:
            self._last_accepted_at.clear()


prescreen_rate_limiter = PrescreenRateLimiter(min_interval_seconds=1.0)
