# PD Care Multi-Phase Development Plan

## Goal

Deliver a one-week, patient-flow-first clinical pilot release for PD Care, then expand it into a 200+ patient pilot with complete staff review workflows, AI quality gates, and operational hardening.

## Architecture Direction

The system remains a Docker Compose monorepo:

- Frontend: Next.js App Router in `apps/frontend`.
- Backend: FastAPI in `apps/backend`.
- Database: local Postgres container for clinical records, identity bindings, uploads, AI results, notifications, and annotations.
- Object storage: SeaweedFS S3-compatible private object storage for images.
- AI: existing classifier endpoint/service first; later add image-quality and YOLO gate before classification.

Patient and staff clients should never use raw SeaweedFS object URLs. Upload and read flows go through authenticated backend endpoints, which write objects and enforce authorization. For UI image rendering, the backend can issue short-lived PD Care image access URLs that expire quickly, are scoped to one upload/image object, and resolve through the backend rather than exposing SeaweedFS directly.

## Delivery Principles

- Week 1 prioritizes patient LIFF binding, daily calendar, upload, persistence, result, and dashboard notification records.
- Keep auth behind maintainable service boundaries so LINE LIFF, built-in staff accounts, and future SSO can coexist.
- Replace mock clinical data incrementally rather than blocking the patient flow on a complete staff dashboard rebuild.
- Persist model/version/threshold metadata where available so future model validation has traceable records.
- Treat YOLO/image-quality checks as a planned pipeline stage, not a week-1 dependency.

## Phase 0: Planning And Baseline Alignment

Objective: make the current branch safe to build on.

Tasks:

- Preserve `docs/prd.md` as the original human brief.
- Use `docs/curated-prd.md` as the product baseline.
- Use this file as the implementation roadmap.
- Confirm current uncommitted changes before code work begins.
- Run the existing frontend lint/build and backend tests to establish a baseline once implementation starts.

Acceptance criteria:

- The planning docs distinguish current implemented behavior from planned pilot behavior.
- The week-1 task list is narrow enough for a fast release.
- Known deferred work is explicitly listed under later phases.

## Phase 1: Week-1 Patient-Flow Release

Objective: let real pilot patients enter through LIFF, bind or request binding, view scan history, upload images, receive AI screening results, and create protected staff-visible notification records.

### Task 1: Add Postgres To Local Runtime

Files:

- Modify `docker-compose.yml`.
- Modify `apps/backend/requirements.txt`.
- Modify `apps/backend/requirements-dev.txt` if test-only database tooling is needed.
- Create backend database package under `apps/backend/app/db/`.
- Create backend migration or schema bootstrap module.
- Add tests under `apps/backend/tests/`.

Implementation notes:

- Add a `postgres` service with named volume.
- Backend reads `DATABASE_URL`.
- Use SQLAlchemy or SQLModel with Alembic if the project will keep growing; for week 1, SQLAlchemy plus Alembic is the safer maintainable default.
- Add tables for staff users, patients, LIFF identities, pending bindings, uploads, AI results, dashboard notifications, and annotations.

Acceptance criteria:

- Backend can connect to Postgres on startup or first request.
- Tests can create an isolated test database/session.
- The schema supports all week-1 patient-flow records without relying on frontend mock data.

### Task 2: Add SeaweedFS Object Storage

Files:

- Modify `docker-compose.yml`.
- Modify backend settings in `apps/backend/app/core/config.py`.
- Create storage service module under `apps/backend/app/services/`.
- Add backend tests for object-key generation and storage service behavior with mocks.

Implementation notes:

- Add SeaweedFS master, volume, and S3/filer services as needed for an S3-compatible API.
- Backend reads S3 endpoint, bucket, access key, secret key, and region from environment variables.
- Keep bucket private.
- Store images under generated object keys such as `patients/{patient_id}/uploads/{upload_id}.jpg`.
- Store object keys in Postgres, not public URLs.
- Add a short-lived image access URL mechanism for UI rendering. URLs should be signed or tokenized by the backend, expire quickly, reference exactly one upload/image object, and be validated before the backend streams the image.

Acceptance criteria:

- Backend can write an uploaded image to SeaweedFS.
- Backend can stream or proxy an image back only after auth checks.
- Backend can issue short-lived image access URLs for authorized patients or staff without exposing raw SeaweedFS URLs.
- Expired or unauthorized image access URLs fail without revealing whether an object key exists.
- Frontend does not need direct SeaweedFS credentials.

### Task 3: Implement Patient LIFF Identity Boundary

Files:

- Add frontend LIFF client utilities under `apps/frontend/lib/auth/`.
- Add patient entry/binding UI under `apps/frontend/app/patient/`.
- Add backend identity schemas/routes under `apps/backend/app/api/routes/`.
- Add backend identity service under `apps/backend/app/services/`.
- Add backend tests for matched and pending binding flows.

Implementation notes:

- Week 1 uses real LIFF profile data.
- Store LINE user ID/display name/picture URL separately from clinical patient identity.
- Patient enters case number and birth date.
- Exact active patient match binds the LIFF identity immediately.
- No match creates a pending binding request.
- Keep the interface generic enough for future non-LINE identity providers.

Acceptance criteria:

- Matched patient can proceed to calendar and scan flow.
- Unmatched patient sees a pending staff approval state.
- Backend prevents unbound/pending users from uploading clinical images.

### Task 4: Build Patient Daily Calendar

Files:

- Add or modify patient home page in `apps/frontend/app/patient/page.tsx`.
- Add reusable calendar/heatmap component under `apps/frontend/app/patient/` or `apps/frontend/components/`.
- Add upload-history API route and schema in backend.
- Add tests for backend aggregation logic.

Implementation notes:

- Calendar derives state from persisted upload records.
- Grey means no upload.
- Green means uploads with no suspected-risk result.
- Red means at least one suspected-risk upload.
- Intensity reflects upload count.
- Allow scanning even when today already has uploads.

Acceptance criteria:

- Calendar renders recent daily scan status for a bound patient.
- Multiple uploads in one day increase intensity.
- A day with any suspected-risk upload is red.
- Patient can start a new scan from the calendar page.

### Task 5: Persist Upload, Image, And AI Result

Files:

- Modify `apps/backend/app/api/routes/predict.py` or add a patient upload route.
- Add upload and AI result schemas.
- Add upload service under `apps/backend/app/services/`.
- Modify frontend predict/upload client in `apps/frontend/lib/api/`.
- Modify capture page in `apps/frontend/app/patient/capture/page.tsx`.
- Add backend tests covering successful upload, suspected result notification, unsupported media, and unbound patient rejection.

Implementation notes:

- Prefer a new authenticated patient upload endpoint that orchestrates image storage, inference, persistence, and response.
- Keep `/v1/predict` available as a lower-level inference/smoke endpoint if useful.
- Save original image object key.
- Persist classifier response, binary screening result, threshold, and model metadata when available.
- Create a dashboard notification for suspected-risk uploads.

Acceptance criteria:

- Bound patient upload creates image object, upload row, AI result row, and response payload.
- Suspected-risk upload creates a notification row.
- Upload failures do not create incomplete clinical records unless intentionally marked as rejected/error records.
- Patient result page reads a durable upload/result identifier where practical, not only query-string state.

### Task 6: Update Patient Result Copy And Flow

Files:

- Modify `apps/frontend/app/patient/result/page.tsx`.
- Add shared Traditional Chinese copy constants if useful.

Implementation notes:

- Remove or replace claims that realtime LINE notification was sent.
- For suspected risk, say staff dashboard has been notified and staff will review.
- Keep non-diagnostic disclaimer visible.
- Add route back to calendar/home.

Acceptance criteria:

- Normal, suspected-risk, rejected, and technical-error states have clear Traditional Chinese copy.
- Suspected-risk state does not claim LINE push delivery.
- Result page works after refresh if backed by a result/upload ID.

### Task 7: Add Basic Staff/Admin Auth Boundary

Files:

- Add backend auth service/provider boundary and dependencies.
- Adjust user identity model support to include role-based authorization (`patient`, `staff`, `admin`) while remaining compatible with current patient identity flow.
- Add unified user auth/session or token route for passwordless pilot identity login using the shared user model.
- Add frontend admin login page or middleware integration needed for Task 7 only.
- Add tests for protected staff/admin endpoints and role behavior.

Implementation notes:

- Passwordless pilot auth is acceptable when staff/admin and patient identities use the same user/auth model.
- Staff/admin users should be pre-provisioned in the same user model with role metadata, then authenticated through the shared identity flow.
- Phase 1 should support staff/admin LINE LIFF login through the same auth boundary; do not treat LINE as patient-only auth.
- Keep provider abstraction so hospital SSO can be added later without rewriting business logic.
- Enforce role checks in backend dependencies/services (not only frontend UI blocking).
- Protect staff/admin image access and notification endpoints with authenticated auth boundary checks.
- Frontend admin auth entry and guarded admin surfaces should remain strongly responsive (RWD) for pilot usage on laptop/tablet/mobile, while still being optimized for larger screens.
- Keep Phase 1 scope minimal: do not expand into Phase 2 staff dashboard feature work.

Acceptance criteria:

- Staff dashboard APIs require authenticated staff/admin identity.
- Role checks distinguish `staff` from `admin` where relevant.
- `admin` can access both patient features and staff/admin routes; `patient` can only access patient features, enforced by backend authorization.
- Staff/admin identities can authenticate via LINE LIFF in Phase 1 through the shared auth/session boundary.
- Task 7 frontend additions remain usable across common viewport sizes without introducing Phase 2 dashboard rebuild scope.
- Auth implementation does not hard-code future SSO assumptions into business logic.

### Task 8: Add Dashboard Notification API

Files:

- Add notification schema/routes/services in backend.
- Add frontend API client under `apps/frontend/lib/api/`.
- Add minimal admin notification UI or data hook so staff can confirm suspected-risk records exist.
- Add tests for notification creation and status updates.

Implementation notes:

- Notification records are created by suspected-risk uploads.
- Include patient reference, upload reference, AI summary, created time, and status.
- Status can start as `new`, then later support `reviewed` or `resolved`.

Acceptance criteria:

- Staff can fetch suspected-risk notification records.
- Notification records are tied to persisted patient/upload/result data.
- Updating notification status does not mutate original AI results.

### Task 9: Docker Compose Integration

Files:

- Modify `docker-compose.yml`.
- Modify `apps/backend/.env.example`.
- Modify frontend/backend README snippets only if needed.

Implementation notes:

- Compose should start frontend, backend, Postgres, and SeaweedFS.
- Backend depends on database and object storage health where practical.
- Keep model cache volume.
- Avoid committing real secrets.

Acceptance criteria:

- `npm run docker:up` can build and start the week-1 stack with documented environment variables.
- Backend can reach Postgres and SeaweedFS from inside Docker.
- Frontend uses the configured backend URL.

### Task 10: Week-1 Verification

Run:

- `npm run lint`
- `npm run build`
- `npm run test`
- Backend API tests directly if root scripts do not cover new database/storage tests.
- Manual smoke test through Docker Compose when environment is available.

Acceptance criteria:

- Existing and new backend tests pass.
- Frontend lint/build pass.
- A bound LIFF-profile patient can upload an image and see a result.
- A suspected-risk result creates a staff notification row.
- A pending/unmatched LIFF user cannot upload until linked.

## Phase 2: Real Staff Review MVP

Objective: replace mock staff workflows with real data and let staff review patients, uploads, notifications, and simple annotations.

Epics:

- Connect `apps/frontend/app/admin/page.tsx` to backend patient/upload APIs.
- Connect patient detail page to real patient timeline and image access endpoint.
- Add upload queue with high-risk/newest sorting.
- Add simple annotation fields: normal, suspected, confirmed infection, rejected, comment.
- Add CSV export from real filtered backend data.
- Add staff workflow for pending LIFF binding requests.

Acceptance criteria:

- Staff dashboard no longer depends on `apps/frontend/lib/mock-data.ts` for pilot data.
- Staff can review all uploads for a patient.
- Staff can create and edit simple annotations.
- Staff can approve or reject pending patient bindings.
- CSV export respects active filters and excludes raw image URLs.

## Phase 3: AI Quality Gate And YOLO Pipeline

Objective: implement the original PRD's image-quality and object-detection gate before classification.

Epics:

- Add image-quality/light validation stage.
- Add YOLO exit-site and catheter-line detection.
- Add ROI crop and classifier handoff.
- Store bounding boxes, rejection reasons, and gate version.
- Update patient result page for rejected image guidance.
- Update staff review to display quality-gate outputs.

Acceptance criteria:

- Backend response supports `accepted` and `rejected` outcomes.
- Rejection reasons are patient-readable and staff-reviewable.
- Accepted images retain classifier result and detection metadata.
- Pipeline can be enabled or disabled by configuration while the model is validated.

## Phase 4: Security, Operations, And Reliability

Objective: make the pilot safer to operate for 200+ patients.

Epics:

- Add audit logs for login, binding, upload, image access, annotation, export, and admin actions.
- Add backup jobs for Postgres and SeaweedFS.
- Document restore procedure and test it.
- Add deployment health checks and monitoring.
- Add retention policy and data export/deletion procedures.
- Add staff access review flow.
- Add SSO provider adapter while preserving built-in accounts as fallback if approved.

Acceptance criteria:

- Administrators can review who accessed or changed PHI-related records.
- Backups are restorable in a test environment.
- Staff access can be reviewed and revoked.
- SSO can be introduced without rewriting patient/upload business logic.

## Phase 5: Research And Model Improvement

Objective: make collected data useful for research and future model validation.

Epics:

- Add de-identified export jobs for labeled image datasets.
- Track model version, threshold, and pipeline version per result.
- Add model-performance dashboards using staff labels as reference.
- Add dataset curation workflows for rejected, uncertain, and suspected-risk images.
- Add threshold analysis reporting.

Acceptance criteria:

- Research exports can exclude direct identifiers.
- Each AI result is traceable to model/pipeline configuration.
- Staff labels can be compared with AI outputs.
- Dataset curation does not require direct object-store access.

## Open Implementation Defaults

Use these defaults unless a later decision overrides them:

- Use SQLAlchemy plus Alembic for backend persistence.
- Use backend-proxied image upload and image viewing.
- Use short-lived backend-issued image access URLs when the UI needs an image `src`.
- Use private SeaweedFS buckets with generated object keys.
- Use Traditional Chinese UI copy in product surfaces.
- Use built-in staff/admin auth first, with provider boundaries for SSO later.
- Keep `/v1/predict` as a low-level inference endpoint and add authenticated patient upload orchestration separately.
