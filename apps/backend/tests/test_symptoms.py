from app.services.symptoms import (
    derived_symptom_fields,
    has_high_risk_symptoms,
    symptom_aware_priority,
)


def test_discharge_alone_is_not_high_risk() -> None:
    assert (
        has_high_risk_symptoms(
            symptom_pain=False,
            symptom_pus=False,
            symptom_cloudy_dialysate=False,
        )
        is False
    )
    assert (
        symptom_aware_priority(
            "normal",
            symptom_pain=False,
            symptom_pus=False,
            symptom_cloudy_dialysate=False,
        )
        == "normal"
    )


def test_pain_pus_or_cloudy_are_high_risk() -> None:
    assert has_high_risk_symptoms(symptom_pain=True, symptom_pus=False, symptom_cloudy_dialysate=False)
    assert has_high_risk_symptoms(symptom_pain=False, symptom_pus=True, symptom_cloudy_dialysate=False)
    assert has_high_risk_symptoms(symptom_pain=False, symptom_pus=False, symptom_cloudy_dialysate=True)


def test_symptom_aware_priority_keeps_image_suspected() -> None:
    assert (
        symptom_aware_priority(
            "suspected",
            symptom_pain=False,
            symptom_pus=False,
            symptom_cloudy_dialysate=False,
        )
        == "suspected"
    )


def test_derived_symptom_fields_payload() -> None:
    fields = derived_symptom_fields(
        screening_result="normal",
        symptom_pain=True,
        symptom_discharge=True,
        symptom_pus=False,
        symptom_cloudy_dialysate=False,
    )
    assert fields["has_high_risk_symptoms"] is True
    assert fields["symptom_aware_priority"] == "suspected"
    assert fields["symptom_cloudy_dialysate"] is False
