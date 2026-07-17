from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.logging import get_logger
from app.db.models import AIResult, LiffIdentity, Notification, Upload
from app.schemas.prediction import PredictionResponse
from app.services.model_loader import LoadedModel, predict_bytes
from app.services.prescreen import LoadedPrescreenModel, PrescreenInferenceError, is_exit_site_present
from app.services.storage import StorageService
from app.services.symptoms import has_high_risk_symptoms, high_risk_symptom_flags

LOGGER = get_logger(__name__)

CONTENT_TYPE_TO_EXTENSION = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/bmp": "bmp",
    "image/tiff": "tiff",
}


@dataclass
class PersistedUploadResult:
    upload: Upload
    ai_result: AIResult
    prediction: PredictionResponse | None
    notification: Notification | None


@dataclass
class PersistedPatientResult:
    upload: Upload
    ai_result: AIResult


def resolve_file_extension(content_type: str, filename: str | None) -> str:
    normalized = content_type.lower()
    if normalized in CONTENT_TYPE_TO_EXTENSION:
        return CONTENT_TYPE_TO_EXTENSION[normalized]

    if filename and "." in filename:
        suffix = filename.rsplit(".", 1)[1].strip().lower()
        if suffix:
            return suffix
    return "jpg"


def persist_patient_upload(
    session: Session,
    *,
    settings: Settings,
    loaded_model: LoadedModel,
    loaded_prescreen_model: LoadedPrescreenModel | None,
    storage_service: StorageService,
    patient_id: int,
    content_type: str,
    filename: str | None,
    image_bytes: bytes,
    symptom_pain: bool = False,
    symptom_discharge: bool = False,
    symptom_pus: bool = False,
    symptom_cloudy_dialysate: bool = False,
) -> PersistedUploadResult:
    prediction: PredictionResponse | None = None
    error_reason: str | None = None
    screening_result = "technical_error"

    should_run_infection_inference = True
    if settings.prescreen_enabled and loaded_prescreen_model is not None:
        try:
            should_run_infection_inference = is_exit_site_present(loaded_prescreen_model, image_bytes)
        except PrescreenInferenceError:
            LOGGER.exception("Pre-screen inference failed; continuing with fail-open policy")
            should_run_infection_inference = True

    if should_run_infection_inference:
        prediction = predict_bytes(loaded_model, image_bytes, settings)
        screening_result = "suspected" if prediction.screening.is_infection_positive else "normal"
    elif settings.prescreen_enabled:
        screening_result = "rejected"
        error_reason = settings.prescreen_reject_reason

    model_version = settings.model_path.name if settings.model_path else None
    extension = resolve_file_extension(content_type, filename)
    high_risk = has_high_risk_symptoms(
        symptom_pain=symptom_pain,
        symptom_pus=symptom_pus,
        symptom_cloudy_dialysate=symptom_cloudy_dialysate,
    )

    try:
        upload = Upload(
            patient_id=patient_id,
            object_key="",
            content_type=content_type,
            symptom_pain=symptom_pain,
            symptom_discharge=symptom_discharge,
            symptom_pus=symptom_pus,
            symptom_cloudy_dialysate=symptom_cloudy_dialysate,
        )
        session.add(upload)
        session.flush()

        object_key = storage_service.generate_object_key(
            patient_id=patient_id,
            upload_id=upload.id,
            file_extension=extension,
        )
        storage_service.store_image(object_key=object_key, content=image_bytes, content_type=content_type)
        upload.object_key = object_key

        ai_result = AIResult(
            upload_id=upload.id,
            predicted_class=prediction.predicted_class_name if prediction else None,
            probability=prediction.predicted_probability if prediction else None,
            threshold=prediction.screening.threshold if prediction else None,
            screening_result=screening_result,
            model_version=model_version,
            error_reason=error_reason,
        )
        session.add(ai_result)
        session.flush()

        notification: Notification | None = None
        ai_suspected = screening_result == "suspected" and prediction is not None
        if ai_suspected or high_risk:
            summary_parts: list[str] = []
            if ai_suspected and prediction is not None:
                summary_parts.append(
                    "Suspected infection risk detected "
                    f"(probability={prediction.screening.infection_probability:.4f})"
                )
            if high_risk:
                flags = high_risk_symptom_flags(
                    symptom_pain=symptom_pain,
                    symptom_pus=symptom_pus,
                    symptom_cloudy_dialysate=symptom_cloudy_dialysate,
                )
                summary_parts.append(f"High-risk symptoms reported ({', '.join(flags)})")
            notification = Notification(
                patient_id=patient_id,
                upload_id=upload.id,
                ai_result_id=ai_result.id,
                status="new",
                summary="; ".join(summary_parts),
            )
            session.add(notification)
            session.flush()

        session.commit()
    except Exception:
        session.rollback()
        raise

    return PersistedUploadResult(
        upload=upload,
        ai_result=ai_result,
        prediction=prediction,
        notification=notification,
    )


def get_patient_result_for_line_user(
    session: Session,
    *,
    line_user_id: str,
    upload_id: int | None = None,
    ai_result_id: int | None = None,
) -> PersistedPatientResult:
    if upload_id is None and ai_result_id is None:
        raise ValueError("Either upload_id or ai_result_id is required")

    identity = session.scalar(
        select(LiffIdentity).where(LiffIdentity.line_user_id == line_user_id).limit(1)
    )
    if identity is None or identity.patient_id is None:
        raise PermissionError("Patient identity is not bound or pending approval")

    if ai_result_id is not None:
        statement = (
            select(Upload, AIResult)
            .join(AIResult, AIResult.upload_id == Upload.id)
            .where(AIResult.id == ai_result_id)
            .limit(1)
        )
        if upload_id is not None:
            statement = statement.where(Upload.id == upload_id)
    else:
        statement = (
            select(Upload, AIResult)
            .join(AIResult, AIResult.upload_id == Upload.id)
            .where(Upload.id == upload_id)
            .limit(1)
        )

    row = session.execute(statement).first()
    if row is None:
        raise LookupError("Patient upload result was not found")

    upload, ai_result = row
    if upload.patient_id != identity.patient_id:
        raise PermissionError("You are not allowed to access this patient upload result")

    return PersistedPatientResult(upload=upload, ai_result=ai_result)
