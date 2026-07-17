from __future__ import annotations

from pydantic import BaseModel


class PatientPrescreenResponse(BaseModel):
    present: bool
    checked: bool
