from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.db.models import AIResult, LiffIdentity, Notification, Upload
from app.schemas.prediction import PredictionResponse
from app.services.model_loader import LoadedModel, predict_bytes
from app.services.storage import StorageService

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
    prediction: PredictionResponse
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
    storage_service: StorageService,
    patient_id: int,
    content_type: str,
    filename: str | None,
    image_bytes: bytes,
) -> PersistedUploadResult:
    prediction = predict_bytes(loaded_model, image_bytes, settings)
    screening_result = "suspected" if prediction.screening.is_infection_positive else "normal"
    model_version = settings.model_path.name if settings.model_path else None
    extension = resolve_file_extension(content_type, filename)

    try:
        upload = Upload(
            patient_id=patient_id,
            object_key="",
            content_type=content_type,
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
            predicted_class=prediction.predicted_class_name,
            probability=prediction.predicted_probability,
            threshold=prediction.screening.threshold,
            screening_result=screening_result,
            model_version=model_version,
            error_reason=None,
        )
        session.add(ai_result)
        session.flush()

        notification: Notification | None = None
        if screening_result == "suspected":
            notification = Notification(
                patient_id=patient_id,
                upload_id=upload.id,
                ai_result_id=ai_result.id,
                status="new",
                summary=(
                    "Suspected infection risk detected "
                    f"(probability={prediction.screening.infection_probability:.4f})"
                ),
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
