from __future__ import annotations

from pydantic import BaseModel, Field


class StaffLineLoginRequest(BaseModel):
    line_id_token: str = Field(min_length=1, max_length=4096)


class AuthTokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    role: str
    line_user_id: str
