"""Symptom high-risk rules shared by upload persistence and API responses.

High-risk self-report symptoms (not discharge) elevate clinical priority for
patient/staff messaging and notifications without mutating screening_result.
"""

from __future__ import annotations

from typing import Literal

SymptomAwarePriority = Literal["normal", "suspected"]


def has_high_risk_symptoms(
    *,
    symptom_pain: bool,
    symptom_pus: bool,
    symptom_cloudy_dialysate: bool,
) -> bool:
    return bool(symptom_pain or symptom_pus or symptom_cloudy_dialysate)


def symptom_aware_priority(
    screening_result: str,
    *,
    symptom_pain: bool,
    symptom_pus: bool,
    symptom_cloudy_dialysate: bool,
) -> SymptomAwarePriority:
    if screening_result == "suspected" or has_high_risk_symptoms(
        symptom_pain=symptom_pain,
        symptom_pus=symptom_pus,
        symptom_cloudy_dialysate=symptom_cloudy_dialysate,
    ):
        return "suspected"
    return "normal"


def high_risk_symptom_flags(
    *,
    symptom_pain: bool,
    symptom_pus: bool,
    symptom_cloudy_dialysate: bool,
) -> list[str]:
    flags: list[str] = []
    if symptom_pain:
        flags.append("pain")
    if symptom_pus:
        flags.append("pus")
    if symptom_cloudy_dialysate:
        flags.append("cloudy_dialysate")
    return flags


def derived_symptom_fields(
    *,
    screening_result: str,
    symptom_pain: bool,
    symptom_discharge: bool,
    symptom_pus: bool,
    symptom_cloudy_dialysate: bool,
) -> dict[str, bool | SymptomAwarePriority]:
    high_risk = has_high_risk_symptoms(
        symptom_pain=symptom_pain,
        symptom_pus=symptom_pus,
        symptom_cloudy_dialysate=symptom_cloudy_dialysate,
    )
    return {
        "symptom_pain": symptom_pain,
        "symptom_discharge": symptom_discharge,
        "symptom_pus": symptom_pus,
        "symptom_cloudy_dialysate": symptom_cloudy_dialysate,
        "has_high_risk_symptoms": high_risk,
        "symptom_aware_priority": symptom_aware_priority(
            screening_result,
            symptom_pain=symptom_pain,
            symptom_pus=symptom_pus,
            symptom_cloudy_dialysate=symptom_cloudy_dialysate,
        ),
    }
