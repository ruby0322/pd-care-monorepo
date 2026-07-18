from __future__ import annotations

import asyncio
from collections.abc import Callable
from typing import Any, TypeVar


T = TypeVar("T")


class PrescreenInferenceBusyError(RuntimeError):
    """Raised when the inference semaphore cannot be acquired before the wait timeout."""


class PrescreenInferenceGate:
    """Process-local concurrency cap for CLIP prescreen inference."""

    def __init__(self, *, max_concurrent: int = 4, wait_timeout_seconds: float = 1.5) -> None:
        if max_concurrent < 1:
            raise ValueError("max_concurrent must be >= 1")
        if wait_timeout_seconds < 0:
            raise ValueError("wait_timeout_seconds must be >= 0")
        self._max_concurrent = max_concurrent
        self._wait_timeout_seconds = wait_timeout_seconds
        self._sem = asyncio.Semaphore(max_concurrent)

    @property
    def max_concurrent(self) -> int:
        return self._max_concurrent

    @property
    def wait_timeout_seconds(self) -> float:
        return self._wait_timeout_seconds

    async def run(self, fn: Callable[..., T], /, *args: Any, **kwargs: Any) -> T:
        try:
            await asyncio.wait_for(self._sem.acquire(), timeout=self._wait_timeout_seconds)
        except asyncio.TimeoutError as exc:
            raise PrescreenInferenceBusyError(
                f"Prescreen inference busy (max_concurrent={self._max_concurrent})"
            ) from exc
        try:
            return await asyncio.to_thread(fn, *args, **kwargs)
        finally:
            self._sem.release()


_gate: PrescreenInferenceGate | None = None
_gate_config: tuple[int, float] | None = None


def get_prescreen_inference_gate(
    *,
    max_concurrent: int = 4,
    wait_timeout_seconds: float = 1.5,
) -> PrescreenInferenceGate:
    global _gate, _gate_config
    config = (max_concurrent, wait_timeout_seconds)
    if _gate is None or _gate_config != config:
        _gate = PrescreenInferenceGate(
            max_concurrent=max_concurrent,
            wait_timeout_seconds=wait_timeout_seconds,
        )
        _gate_config = config
    return _gate


def reset_prescreen_inference_gate() -> None:
    global _gate, _gate_config
    _gate = None
    _gate_config = None
