---
name: safe-api-data-mutations
description: >-
  Perform production-like data mutations through authenticated API endpoints
  (not direct DB writes) to preserve service-layer validation and audit logs.
  Use when users ask to approve/reject requests, update roles/status, or perform
  other live data changes in dev/prod environments.
---

# Safe API Data Mutations (PD Care)

Use this skill when a user asks for a live data change and wants safety plus traceability.

## Core Rule

**Mutate data through API endpoints only.**

Do not run direct DB `INSERT`/`UPDATE`/`DELETE` for business-state changes when an API route exists.

Allowed DB usage:
- read-only lookup to identify target IDs and context
- read-only verification after API mutation

Why:
- API layer enforces permissions and invariants
- audit/event rows are written consistently by service code
- behavior matches real client flows

## Safety Checklist

Copy and track this checklist:

```text
Mutation Progress:
- [ ] Identify target environment/namespace and endpoint
- [ ] Confirm mutation route exists (approve/reject/update/etc.)
- [ ] Gather target IDs with read-only DB query or list endpoint
- [ ] Obtain authenticated actor token (least privilege that can perform action)
- [ ] Execute API mutation request
- [ ] Verify response payload + status code
- [ ] Verify persisted state via read-only API/DB checks
- [ ] Report exactly what changed
```

## Execution Workflow

### 1) Identify route and payload

Find the backend route and schema first (examples in this repo):
- `POST /v1/staff/admin/access-requests/{request_id}/approve`
- `POST /v1/staff/admin/access-requests/{request_id}/reject`
- `POST /v1/staff/admin/users/{identity_id}/role`
- `POST /v1/staff/admin/users/{identity_id}/status`

If no API route exists, stop and tell the user. Do not silently mutate DB.

### 2) Discover target records (read-only)

Use one of:
- list API endpoint with filters, or
- read-only DB query from app pod/session context

When reading DB directly in K8s:
- query only necessary columns
- do not issue any write statements

### 3) Obtain actor credentials

Prefer a real existing actor with required role (usually admin).

If needed in operational/debug flows, mint a token using backend token service and cluster secret:
- only for authorized user-requested maintenance operations
- only for the minimum role needed
- do not persist or log secrets/tokens in files

### 4) Execute mutation via API

Send mutation to service endpoint with bearer auth.

Expected pattern:
- `2xx`: success
- `4xx`: permission/validation/path errors (report and stop)
- `5xx`: service failure (collect logs/events and report)

### 5) Verify and report

Verify through:
- API response body
- read-only follow-up query/list/status endpoint
- optional read-only DB check for fields and audit consequences

Report:
- environment + namespace
- endpoint called
- target IDs
- resulting status/role/value changes
- verification evidence

## Mandatory Guardrails

- Never mutate Kubernetes or DB objects directly when an API path exists.
- Never bypass auth/permission checks by editing rows manually.
- Never print raw secrets in user-facing output.
- Never claim success without checking final state.

## Healthcare Access Request Playbook (Common PD Care Case)

1. Find pending request:
   - query `healthcare_access_requests` + `liff_identities` (read-only), or
   - call admin list endpoint.
2. Pick approval role (`staff` or `admin`) per user instruction.
3. Call:
   - `POST /v1/staff/admin/access-requests/{request_id}/approve`
4. Verify:
   - response `status=approved`
   - `decision_role` matches requested role
   - request no longer pending

Use the same pattern for reject and user-management mutations.
