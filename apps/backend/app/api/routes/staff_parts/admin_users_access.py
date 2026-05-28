from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from app.api.deps.auth import bearer_scheme, get_current_principal, require_admin
from app.db.models import LiffIdentity
from app.schemas.admin_user_management import (
    AdminApproveHealthcarePermissionRequest,
    AdminHealthcarePermissionRequestItem,
    AdminHealthcarePermissionRequestListResponse,
    AdminIdentityBulkDeletePreviewResponse,
    AdminIdentityBulkDeleteRequest,
    AdminIdentityBulkDeleteResultResponse,
    AdminIdentityItem,
    AdminIdentityListResponse,
    AdminRejectHealthcarePermissionRequest,
    AdminUpdateIdentityRealNameRequest,
    AdminUpdateIdentityRoleRequest,
    AdminUpdateIdentityStatusRequest,
)
from app.services.admin_user_management import (
    approve_healthcare_permission_request,
    delete_inactive_identities,
    list_healthcare_permission_requests,
    list_identities,
    preview_delete_inactive_identities,
    reject_healthcare_permission_request,
    update_identity_real_name,
    update_identity_role,
    update_identity_status,
)

from .shared import get_staff_session

router = APIRouter(tags=["Staff"])


def _to_admin_identity_item(identity: LiffIdentity) -> AdminIdentityItem:
    return AdminIdentityItem(
        id=identity.id,
        line_user_id=identity.line_user_id,
        display_name=identity.display_name,
        real_name=identity.real_name,
        role=identity.role,  # type: ignore[arg-type]
        is_active=identity.is_active,
        patient_id=identity.patient_id,
        created_at=identity.created_at,
    )


@router.get("/v1/staff/admin/probe")
async def admin_probe(
    request: Request,
    credentials=Depends(bearer_scheme),
) -> dict[str, str]:
    principal = require_admin(get_current_principal(request, credentials))
    return {"status": "ok", "role": principal.role}


@router.get("/v1/staff/admin/users", response_model=AdminIdentityListResponse)
async def list_admin_users(
    request: Request,
    query: str | None = Query(default=None, min_length=1, max_length=128),
    role: str | None = Query(default=None, pattern="^(patient|staff|admin)$"),
    exclude_patient: bool = Query(default=False),
    is_active: bool | None = Query(default=None),
    created_from: date | None = Query(default=None),
    created_to: date | None = Query(default=None),
    limit: int = Query(default=10, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    credentials=Depends(bearer_scheme),
    session: Session = Depends(get_staff_session),
) -> AdminIdentityListResponse:
    require_admin(get_current_principal(request, credentials))
    rows, total = list_identities(
        session,
        query=query,
        role=role,
        exclude_patient=exclude_patient,
        is_active=is_active,
        created_from=created_from,
        created_to=created_to,
        limit=limit,
        offset=offset,
    )
    return AdminIdentityListResponse(
        items=[_to_admin_identity_item(row) for row in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post("/v1/staff/admin/users/delete/preview", response_model=AdminIdentityBulkDeletePreviewResponse)
async def preview_delete_admin_users(
    request: Request,
    payload: AdminIdentityBulkDeleteRequest,
    credentials=Depends(bearer_scheme),
    session: Session = Depends(get_staff_session),
) -> AdminIdentityBulkDeletePreviewResponse:
    require_admin(get_current_principal(request, credentials))
    result = preview_delete_inactive_identities(session, identity_ids=payload.identity_ids)
    return AdminIdentityBulkDeletePreviewResponse(
        requested_count=result["requested_count"],
        deletable_count=result["deletable_count"],
        skipped_active_count=result["skipped_active_count"],
        skipped_missing_count=result["skipped_missing_count"],
    )


@router.post("/v1/staff/admin/users/delete", response_model=AdminIdentityBulkDeleteResultResponse)
async def delete_admin_users(
    request: Request,
    payload: AdminIdentityBulkDeleteRequest,
    credentials=Depends(bearer_scheme),
    session: Session = Depends(get_staff_session),
) -> AdminIdentityBulkDeleteResultResponse:
    require_admin(get_current_principal(request, credentials))
    result = delete_inactive_identities(session, identity_ids=payload.identity_ids)
    return AdminIdentityBulkDeleteResultResponse(
        requested_count=result["requested_count"],
        deleted_count=result["deleted_count"],
        skipped_active_count=result["skipped_active_count"],
        skipped_missing_count=result["skipped_missing_count"],
    )


@router.post("/v1/staff/admin/users/{identity_id}/role", response_model=AdminIdentityItem)
async def update_admin_user_role(
    request: Request,
    identity_id: int,
    payload: AdminUpdateIdentityRoleRequest,
    credentials=Depends(bearer_scheme),
    session: Session = Depends(get_staff_session),
) -> AdminIdentityItem:
    principal = require_admin(get_current_principal(request, credentials))
    try:
        identity = update_identity_role(
            session,
            actor_identity_id=principal.identity_id,
            actor_role=principal.role,
            target_identity_id=identity_id,
            role=payload.role,
            reason=payload.reason,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    return _to_admin_identity_item(identity)


@router.post("/v1/staff/admin/users/{identity_id}/status", response_model=AdminIdentityItem)
async def update_admin_user_status(
    request: Request,
    identity_id: int,
    payload: AdminUpdateIdentityStatusRequest,
    credentials=Depends(bearer_scheme),
    session: Session = Depends(get_staff_session),
) -> AdminIdentityItem:
    principal = require_admin(get_current_principal(request, credentials))
    try:
        identity = update_identity_status(
            session,
            actor_identity_id=principal.identity_id,
            actor_role=principal.role,
            target_identity_id=identity_id,
            is_active=payload.is_active,
            reason=payload.reason,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    return _to_admin_identity_item(identity)


@router.post("/v1/staff/admin/users/{identity_id}/real-name", response_model=AdminIdentityItem)
async def update_admin_user_real_name(
    request: Request,
    identity_id: int,
    payload: AdminUpdateIdentityRealNameRequest,
    credentials=Depends(bearer_scheme),
    session: Session = Depends(get_staff_session),
) -> AdminIdentityItem:
    principal = require_admin(get_current_principal(request, credentials))
    try:
        identity = update_identity_real_name(
            session,
            actor_identity_id=principal.identity_id,
            actor_role=principal.role,
            target_identity_id=identity_id,
            real_name=payload.real_name,
            reason=payload.reason,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _to_admin_identity_item(identity)


@router.get("/v1/staff/admin/access-requests", response_model=AdminHealthcarePermissionRequestListResponse)
async def list_admin_access_requests(
    request: Request,
    status: str | None = Query(default=None, pattern="^(pending|approved|rejected)$"),
    credentials=Depends(bearer_scheme),
    session: Session = Depends(get_staff_session),
) -> AdminHealthcarePermissionRequestListResponse:
    require_admin(get_current_principal(request, credentials))
    rows = list_healthcare_permission_requests(session, status=status)
    return AdminHealthcarePermissionRequestListResponse(
        items=[
            AdminHealthcarePermissionRequestItem(
                id=access_request.id,
                requester_identity_id=identity.id,
                line_user_id=identity.line_user_id,
                display_name=identity.display_name,
                requester_role=identity.role,  # type: ignore[arg-type]
                status=access_request.status,  # type: ignore[arg-type]
                reject_reason=access_request.reject_reason,
                decision_role=access_request.decision_role,  # type: ignore[arg-type]
                created_at=access_request.created_at,
                decided_at=access_request.decided_at,
            )
            for access_request, identity in rows
        ]
    )


@router.post("/v1/staff/admin/access-requests/{request_id}/approve", response_model=AdminHealthcarePermissionRequestItem)
async def approve_admin_access_request(
    request: Request,
    request_id: int,
    payload: AdminApproveHealthcarePermissionRequest,
    credentials=Depends(bearer_scheme),
    session: Session = Depends(get_staff_session),
) -> AdminHealthcarePermissionRequestItem:
    principal = require_admin(get_current_principal(request, credentials))
    try:
        access_request = approve_healthcare_permission_request(
            session,
            request_id=request_id,
            actor_identity_id=principal.identity_id,
            actor_role=principal.role,
            role=payload.role,
            reason=payload.reason,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc

    identity = session.get(LiffIdentity, access_request.requester_identity_id)
    if identity is None:
        raise HTTPException(status_code=404, detail="Requester identity not found")
    return AdminHealthcarePermissionRequestItem(
        id=access_request.id,
        requester_identity_id=identity.id,
        line_user_id=identity.line_user_id,
        display_name=identity.display_name,
        requester_role=identity.role,  # type: ignore[arg-type]
        status=access_request.status,  # type: ignore[arg-type]
        reject_reason=access_request.reject_reason,
        decision_role=access_request.decision_role,  # type: ignore[arg-type]
        created_at=access_request.created_at,
        decided_at=access_request.decided_at,
    )


@router.post("/v1/staff/admin/access-requests/{request_id}/reject", response_model=AdminHealthcarePermissionRequestItem)
async def reject_admin_access_request(
    request: Request,
    request_id: int,
    payload: AdminRejectHealthcarePermissionRequest,
    credentials=Depends(bearer_scheme),
    session: Session = Depends(get_staff_session),
) -> AdminHealthcarePermissionRequestItem:
    principal = require_admin(get_current_principal(request, credentials))
    try:
        access_request = reject_healthcare_permission_request(
            session,
            request_id=request_id,
            actor_identity_id=principal.identity_id,
            actor_role=principal.role,
            reason=payload.reason,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc

    identity = session.get(LiffIdentity, access_request.requester_identity_id)
    if identity is None:
        raise HTTPException(status_code=404, detail="Requester identity not found")
    return AdminHealthcarePermissionRequestItem(
        id=access_request.id,
        requester_identity_id=identity.id,
        line_user_id=identity.line_user_id,
        display_name=identity.display_name,
        requester_role=identity.role,  # type: ignore[arg-type]
        status=access_request.status,  # type: ignore[arg-type]
        reject_reason=access_request.reject_reason,
        decision_role=access_request.decision_role,  # type: ignore[arg-type]
        created_at=access_request.created_at,
        decided_at=access_request.decided_at,
    )
