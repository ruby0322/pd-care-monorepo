from __future__ import annotations

import asyncio
from typing import Any

from app.services.copilot.titles import MAX_TITLE_LENGTH, generate_session_title, sanitize_title


class _Response:
    def __init__(self, text: str) -> None:
        self.output_text = text


class _Responses:
    def __init__(self, result: Any) -> None:
        self._result = result
        self.calls: list[dict[str, Any]] = []

    async def create(self, **kwargs: Any) -> Any:
        self.calls.append(kwargs)
        if isinstance(self._result, Exception):
            raise self._result
        return self._result


class _Client:
    def __init__(self, result: Any) -> None:
        self.responses = _Responses(result)


def test_sanitize_strips_the_decoration_models_add() -> None:
    assert sanitize_title('  "出口感染趨勢分析"  ') == "出口感染趨勢分析"
    assert sanitize_title("標題：上傳頻率追蹤") == "上傳頻率追蹤"
    assert sanitize_title("「單一病患歷程」") == "單一病患歷程"


def test_sanitize_keeps_only_the_first_line_of_an_explaining_model() -> None:
    assert sanitize_title("出口感染趨勢分析\n\n這個標題概括了使用者的問題。") == "出口感染趨勢分析"


def test_sanitize_caps_length_so_a_sidebar_row_still_fits() -> None:
    title = sanitize_title("分析" * 100)
    assert title is not None
    assert len(title) == MAX_TITLE_LENGTH


def test_sanitize_reports_nothing_usable_rather_than_an_empty_title() -> None:
    assert sanitize_title("   ") is None
    assert sanitize_title('""') is None


def test_generates_a_title_from_the_question() -> None:
    client = _Client(_Response("出口感染趨勢分析"))
    title = asyncio.run(generate_session_title(client=client, model="gpt-6-luna", question="最近出口感染有變多嗎？"))

    assert title == "出口感染趨勢分析"
    call = client.responses.calls[0]
    assert call["model"] == "gpt-6-luna"
    # Only the nurse's own question is sent -- no transcript, no tool results.
    assert "最近出口感染有變多嗎？" in str(call["input"])


def test_a_failing_title_model_is_not_an_error_the_caller_has_to_handle() -> None:
    client = _Client(RuntimeError("502 upstream"))
    assert asyncio.run(generate_session_title(client=client, model="gpt-6-luna", question="問題")) is None


def test_an_empty_question_is_not_sent_to_the_model_at_all() -> None:
    client = _Client(_Response("不該被呼叫"))
    assert asyncio.run(generate_session_title(client=client, model="gpt-6-luna", question="   ")) is None
    assert client.responses.calls == []
