"""Naming a session from the question that started it.

A nurse opens a thread by asking something, not by naming it, so the title is written
afterwards from that first question. `derive_title` already produces a serviceable one by
truncating -- this module asks a small model for a better one, and falls back to the
truncation whenever that does not work out.

The call deliberately sees only the nurse's own question, which the main turn is sending to
the same provider anyway, so naming crosses no boundary the conversation had not already
crossed. The prompt still forbids identifiers in the output: a title is read in a list,
often over someone's shoulder, long after the question itself has scrolled away.
"""

from __future__ import annotations

import logging
import re
from typing import Any

LOGGER = logging.getLogger(__name__)

MAX_TITLE_LENGTH = 40

_TITLE_PROMPT = """把使用者的問題濃縮成一個簡短的對話標題。

規則：
- 6 到 12 個中文字（或等長的英文），只輸出標題本身，不要引號、不要句號、不要「標題：」這類前綴。
- 用描述分析主題的名詞片語，例如「出口感染趨勢分析」、「上傳頻率異常追蹤」。
- 絕對不要放入任何可識別個人的資訊：姓名、病歷號、LINE id、代稱（P#1）、生日。
  需要指涉個別病患時寫「單一病患」。
- 不要回答問題本身。"""


def sanitize_title(raw: str) -> str | None:
    """Reduce a model's answer to something that fits in a sidebar row.

    Returns None when nothing usable is left, which is the caller's signal to keep the
    title it already has rather than show an empty row.
    """
    text = raw.strip().replace("　", " ")
    # Models like to answer with a quoted phrase, or to prefix the thing they were asked for.
    text = re.sub(r"^(標題|title)\s*[:：]\s*", "", text, flags=re.IGNORECASE)
    text = text.strip().strip("\"'`「」『』【】()（）")
    # Any answer that arrives as several lines is a model explaining itself; keep the first.
    text = text.splitlines()[0].strip() if text.strip() else ""
    text = re.sub(r"\s+", " ", text)
    if not text:
        return None
    return text[:MAX_TITLE_LENGTH]


def _output_text(response: Any) -> str:
    text = getattr(response, "output_text", None)
    if isinstance(text, str) and text.strip():
        return text
    # Older/edge shapes: walk the output items for the first text part.
    for item in getattr(response, "output", None) or []:
        for part in getattr(item, "content", None) or []:
            value = getattr(part, "text", None)
            if isinstance(value, str) and value.strip():
                return value
    return ""


async def generate_session_title(*, client: Any, model: str, question: str) -> str | None:
    """Ask the small model for a title. None whenever that cannot be delivered.

    Every failure is swallowed on purpose: naming is a cosmetic improvement on a title the
    caller already holds, and must never be the reason an answer does not arrive.
    """
    if not question.strip():
        return None
    try:
        response = await client.responses.create(
            model=model,
            instructions=_TITLE_PROMPT,
            input=[{"role": "user", "content": [{"type": "input_text", "text": question[:2000]}]}],
            max_output_tokens=600,
        )
    except Exception:  # noqa: BLE001 - a cosmetic call; log and let the caller keep its title
        LOGGER.info("Copilot title model '%s' did not answer; keeping the derived title", model, exc_info=True)
        return None
    return sanitize_title(_output_text(response))
