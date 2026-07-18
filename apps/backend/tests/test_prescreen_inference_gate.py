from __future__ import annotations

import asyncio
import threading
import time

import pytest

from app.services.prescreen_inference_gate import (
    PrescreenInferenceBusyError,
    PrescreenInferenceGate,
    get_prescreen_inference_gate,
    reset_prescreen_inference_gate,
)


@pytest.fixture(autouse=True)
def _reset_gate() -> None:
    reset_prescreen_inference_gate()


def test_rejects_invalid_max_concurrent() -> None:
    with pytest.raises(ValueError, match="max_concurrent"):
        PrescreenInferenceGate(max_concurrent=0)


def test_rejects_negative_wait_timeout() -> None:
    with pytest.raises(ValueError, match="wait_timeout"):
        PrescreenInferenceGate(wait_timeout_seconds=-0.1)


def test_run_executes_callable_and_returns_result() -> None:
    gate = PrescreenInferenceGate(max_concurrent=1, wait_timeout_seconds=1.0)

    def _fn(x: int, *, y: int) -> int:
        return x + y

    assert asyncio.run(gate.run(_fn, 2, y=3)) == 5


def test_busy_raises_when_wait_timeout_elapses() -> None:
    async def _scenario() -> None:
        gate = PrescreenInferenceGate(max_concurrent=1, wait_timeout_seconds=0.05)
        started = threading.Event()
        release = threading.Event()

        def _hold() -> str:
            started.set()
            while not release.is_set():
                time.sleep(0.01)
            return "held"

        holder_task = asyncio.create_task(gate.run(_hold))
        deadline = time.monotonic() + 1.0
        while not started.is_set():
            if time.monotonic() > deadline:
                raise AssertionError("holder never started")
            await asyncio.sleep(0.01)

        with pytest.raises(PrescreenInferenceBusyError):
            await gate.run(lambda: "never")

        release.set()
        assert await holder_task == "held"

    asyncio.run(_scenario())


def test_releases_slot_after_callable_raises() -> None:
    async def _scenario() -> None:
        gate = PrescreenInferenceGate(max_concurrent=1, wait_timeout_seconds=0.5)

        def _boom() -> None:
            raise RuntimeError("infer failed")

        with pytest.raises(RuntimeError, match="infer failed"):
            await gate.run(_boom)

        assert await gate.run(lambda: "ok") == "ok"

    asyncio.run(_scenario())


def test_get_prescreen_inference_gate_reuses_same_config() -> None:
    first = get_prescreen_inference_gate(max_concurrent=2, wait_timeout_seconds=1.5)
    second = get_prescreen_inference_gate(max_concurrent=2, wait_timeout_seconds=1.5)
    assert first is second


def test_get_prescreen_inference_gate_rebuilds_on_config_change() -> None:
    first = get_prescreen_inference_gate(max_concurrent=2, wait_timeout_seconds=1.5)
    second = get_prescreen_inference_gate(max_concurrent=1, wait_timeout_seconds=0.5)
    assert first is not second
    assert second.max_concurrent == 1
    assert second.wait_timeout_seconds == 0.5
