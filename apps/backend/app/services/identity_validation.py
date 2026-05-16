from __future__ import annotations

import re

LINE_USER_ID_PATTERN = re.compile(r"^U[A-Za-z0-9_-]{5,127}$")


def assert_valid_line_user_id(line_user_id: str) -> str:
    candidate = line_user_id.strip()
    if not LINE_USER_ID_PATTERN.fullmatch(candidate):
        raise ValueError("Invalid LINE user id format")
    return candidate
