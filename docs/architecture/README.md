# Architecture Diagrams

This directory stores versioned architecture diagrams for PD Care.

## Files

- `system-architecture.tex`: Primary container-level system architecture diagram in LaTeX/TikZ.

## Compile

From the repository root:

```bash
pdflatex -interaction=nonstopmode -halt-on-error -output-directory docs/architecture docs/architecture/system-architecture.tex
```

Expected output:

- `docs/architecture/system-architecture.pdf`
- `docs/architecture/system-architecture.log`

## Scope Assumptions

- Diagram captures deployed runtime topology for the monorepo stack.
- Focuses on container/service boundaries and critical data/auth flows.
- Shows frontend `/api/*` rewrite boundary to FastAPI backend.
- Shows backend dependencies on PostgreSQL, SeaweedFS S3, LINE token verify endpoint, and startup model artifact download.

## Update Checklist

Update `system-architecture.tex` when any of these change:

- Service composition in `docker-compose.yml`
- Frontend proxy behavior in `apps/frontend/next.config.mjs`
- Backend startup dependencies in `apps/backend/app/main.py`
- Backend API domain boundaries in `apps/backend/app/api/router.py`

After updates:

1. Rebuild with `pdflatex`.
2. Confirm labels and flows still match source-of-truth files.
3. Keep terminology aligned with repository docs (`patient`, `staff/admin`, `predict`, `upload`, `identity`).
