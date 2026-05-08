# PD Care Clinical Pilot PRD

## Document Purpose

This document refines the original PD Care brief in `docs/prd.md` into a clinical-pilot product requirement document. It preserves the original objective: help peritoneal dialysis patients capture consistent exit-site images, provide AI-assisted infection-risk alerts, and build a reviewable image database for care and research.

The first usable release is intentionally patient-flow-first and targeted for a one-week build. It must create the data foundation that staff workflows need, but it does not need to complete the full staff dashboard. Later phases complete staff review, AI quality gates, and operational hardening for the broader 200+ patient pilot.

## Product Goal

PD Care should let peritoneal dialysis patients submit daily exit-site images from home through LINE LIFF/mobile web, receive clear non-diagnostic AI screening feedback, and give healthcare staff a reliable review surface for image history, suspected-risk notifications, and clinical notes.

The system does not diagnose, prescribe treatment, or replace clinical judgment. All patient-facing risk language must clearly state that the result is an AI-assisted screening signal and that medical decisions remain with healthcare staff.

## Pilot Scope

### Target Release

The week-1 release focuses on the patient upload loop:

- Patient opens PD Care through LINE LIFF.
- System reads LINE profile data and prepares a clinical-identity binding.
- Patient enters case number and birth date.
- If a staff-precreated patient profile matches, the LINE profile binds immediately.
- If no profile matches, the user remains pending until staff manually links the LINE profile to a patient profile.
- Patient sees a daily scan calendar before entering capture.
- Patient can upload one or more exit-site images per day.
- Backend stores upload metadata, AI result, and image object reference.
- Patient sees the classifier result with non-diagnostic wording.
- Suspected-risk uploads create database-backed dashboard notifications for staff.

### Pilot Assumptions

- Pilot size: 200+ patients and 3-10 staff.
- Primary workflow: patients self-capture at home; staff review asynchronously.
- Deployment: single VM/server using Docker Compose.
- UI language: Traditional Chinese first, with copy structured for future English localization.
- Data sensitivity: full PHI storage is allowed for the pilot.
- Security baseline: minimal internal research-server controls for the first release, then staged hardening.

## Users And Roles

### Patient

Patients use LINE LIFF/mobile web to complete a daily scan routine. They need simple instructions, a visible scan history, clear upload status, and cautious result language that tells them when staff review is needed.

Key needs:

- Understand whether today has already been scanned.
- Upload additional images when symptoms or concerns arise.
- Receive immediate AI screening feedback without interpreting it as diagnosis.
- Avoid repeated setup after initial LIFF binding.

### Healthcare Staff

Healthcare staff review patient uploads, suspected-risk notifications, and patient history. In week 1 the staff surface can be basic, but the backend must already persist the records that real review workflows will use.

Key needs:

- Pre-create patient profiles.
- Resolve pending LIFF users by linking them to patient profiles.
- See suspected-risk dashboard notifications.
- Review patient image history and AI outputs.
- Add simple clinical labels and comments in later staff-focused phases.

### Backend Admin

Backend admins operate the deployment, manage staff accounts, support data access, and maintain AI/model configuration.

Key needs:

- Built-in staff/admin authentication in the pilot.
- Role boundary designed so SSO can be added later.
- Model and threshold configuration visibility.
- Safe access to stored image objects through authenticated backend endpoints.

## Core Workflows

### Patient Enrollment And Binding

1. Staff pre-create patient profiles with clinical identifiers.
2. Patient opens the LIFF app.
3. System captures LINE profile fields needed for app identity.
4. Patient enters case number and birth date.
5. Backend attempts to match an existing patient profile.
6. If exactly one active profile matches, backend binds the LINE profile to that patient.
7. If no active profile matches, backend creates a pending user-link request.
8. Staff manually links pending users to newly created or existing patient profiles.

Acceptance criteria:

- A matched patient can reach the scan calendar after first LIFF login and identity confirmation.
- An unmatched patient sees a pending-review state and cannot upload clinical images until staff approval.
- The data model keeps LINE identity separate from clinical patient identity so later SSO or alternative identity methods can be added.

### Daily Scan Calendar

Before scanning, patients see a simple calendar/heatmap view for recent daily scans.

Calendar color rules:

- Grey: no upload on that day.
- Green: one or more uploads and no suspected infection risk.
- Red: at least one suspected-risk upload.
- Color intensity increases with the number of uploads that day.

Acceptance criteria:

- Patients can upload multiple times per day.
- Calendar state is derived from persisted upload records, not browser-only state.
- The scan button remains available even if today already has uploads.

### Capture, Upload, And Result

The patient capture flow keeps the current guided-camera direction from the brief: simple instructions, circular alignment guidance, and image upload to the backend.

Week-1 backend behavior:

- Accept supported image uploads.
- Store the image in private SeaweedFS object storage.
- Store upload metadata and object key in Postgres.
- Run the existing classifier endpoint or internal classifier service.
- Persist AI result, probability/confidence, threshold, and model/version metadata when available.
- Create a dashboard notification when the result is suspected risk.
- Return a patient-facing result payload.

Acceptance criteria:

- Patient sees normal, suspected-risk, or rejected/error state after upload.
- Suspected-risk copy says staff will review and that the system does not provide diagnosis.
- Failed upload states distinguish technical failure from image rejection when the backend can provide a reason.

### Staff Review And Notifications

The staff dashboard should evolve into a combined review surface:

- Patient list with filters and sortable columns.
- Upload queue for newest and high-risk submissions.
- Notification inbox for suspected-risk uploads.
- Patient timeline/calendar and detail page.
- Simple annotation: normal, suspected, confirmed infection, rejected, plus free-text comment.

Week 1 requires data-backed notification records, protected staff/admin access, and enough basic visibility to confirm suspected-risk uploads were recorded. Phase 2 connects the broader existing mock dashboard to real APIs.

Acceptance criteria:

- Suspected-risk uploads create notification records in Postgres.
- Notification records include patient reference, upload reference, AI result summary, and status.
- Staff can later mark notifications as reviewed or resolved without changing original AI outputs.

## Data Requirements

### Relational Data

Postgres stores:

- Staff users and roles.
- Patient profiles.
- LINE identity bindings.
- Pending identity-link requests.
- Upload records.
- AI screening results.
- Dashboard notifications.
- Staff annotations.
- Audit events in later hardening phases.

### Image Storage

SeaweedFS provides private S3-compatible object storage in Docker Compose.

Image access policy:

- Browser uploads images to the PD Care backend, not directly to object storage.
- Backend writes image objects to SeaweedFS and stores object keys in Postgres.
- Browser image viewing goes through authenticated backend endpoints.
- Backend issues short-lived PD Care image access URLs for patient/staff UI rendering after checking authorization.
- Short-lived URLs expire quickly, are scoped to one upload/image object, and resolve through the PD Care backend rather than exposing SeaweedFS directly.
- Raw SeaweedFS URLs and public buckets are not exposed to patients or staff.

## AI Requirements

### Week-1 AI Scope

Use the current classifier result to produce normal versus suspected-risk screening output. The model result can be shown to the patient with non-diagnostic wording.

Persist:

- Raw predicted class and probability when available.
- Binary screening result.
- Threshold.
- Model identifier/version when available.
- Error or rejection reason when applicable.

### Future AI Quality Gate

The original PRD calls for lighting checks, YOLO exit-site/catheter detection, ROI crop, and binary CNN classification. This remains a planned extension point, not a week-1 blocker.

Future accepted/rejected semantics:

- `accepted`: image passed quality/detection checks and classifier ran.
- `rejected`: image failed quality/detection checks with a patient-readable reason.

## Authentication And Authorization

Week-1 authentication requirements:

- Patient identity starts with LINE LIFF profile data.
- Clinical identity binding uses case number plus birth date.
- Staff/admin accounts are built into PD Care.
- Role checks protect staff dashboard APIs and image access APIs.

Maintainability requirements:

- Keep auth logic behind a service/interface boundary.
- Avoid coupling core patient/upload logic directly to LINE-specific code.
- Design staff auth so hospital SSO can later replace or supplement built-in accounts.

## Security And Privacy

The first release targets a minimal internal research-server baseline:

- HTTPS at the deployment edge.
- Private object storage.
- Authenticated backend-mediated image access.
- Short-lived signed image access URLs for UI image rendering.
- Role-based staff/admin access.
- Secrets provided through environment variables, not committed files.
- Database backups and object-store backups planned in the next hardening phase.

Known follow-up hardening:

- Complete audit log coverage.
- Documented retention policy.
- Access review process.
- Incident procedure.
- Formal backup restore testing.
- SSO integration.

## Non-Goals

Week 1 does not include:

- Realtime LINE push notifications.
- Full formal compliance package.
- YOLO/image-quality rejection pipeline.
- Staff annotation UI completion.
- Full research export pipeline.
- Hospital SSO.
- Multi-site deployment.
- Diagnosis, treatment recommendation, or prescription.

## Success Metrics

Primary pilot metric:

- Operational adoption: enrolled patients submit usable images on schedule and staff can review them efficiently.

Supporting metrics:

- Percentage of enrolled patients who complete LIFF binding.
- Daily upload completion rate.
- Number of uploads per patient per week.
- Percentage of suspected-risk uploads surfaced to staff dashboard notifications.
- Median staff review time for suspected-risk uploads once the staff workflow is live.
- Upload failure rate by reason.

## Current Repo Mapping

Current implemented surfaces:

- Patient capture and result pages exist in `apps/frontend/app/patient/capture/page.tsx` and `apps/frontend/app/patient/result/page.tsx`.
- Frontend API client code exists under `apps/frontend/lib/api/`.
- Mock staff dashboard exists in `apps/frontend/app/admin/page.tsx`, `apps/frontend/app/admin/patients/[id]/page.tsx`, and `apps/frontend/lib/mock-data.ts`.
- Backend classifier endpoint exists in `apps/backend/app/api/routes/predict.py`.
- Prediction response schema exists in `apps/backend/app/schemas/prediction.py`.

Major gaps to close:

- Real database and migrations.
- SeaweedFS object storage wiring.
- LIFF identity and clinical binding.
- Persistent upload records and calendar history.
- Staff/admin auth.
- Dashboard notifications.
- Real staff APIs replacing mock data.
- Staff annotations.
- Audit and backup hardening.
