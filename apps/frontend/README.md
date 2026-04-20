# PD Care — Peritoneal Dialysis Exit-Site Imaging and Infection Alert System

National Taiwan University Hospital Research Project (Jan. 2026).

## Product Objective

- Standardize exit-site image capture for peritoneal dialysis patients.
- Use deep learning to provide **potential infection alerts** (final diagnosis remains with physicians).
- Build an image database for backend review and research.

## User Roles

| Role | Scope | Key Requirements |
|------|--------|------------------|
| **Patient** | Capture images, receive alerts | Guided UI, prompts, image upload |
| **Healthcare Staff** | Image review | Image history, verify model outputs, follow-up alerts |
| **Backend Admin** | System maintenance | User management, model versioning, data access control |

## Core Features & Workflow

### 1. Patient-Side Capture

- Single-step capture with a **fixed-size circular dashed mask** for exit-site alignment.
- On-screen instructions: sufficient lighting, align exit site within mask, catheter line visible.
- Upload image to backend.

### 2. Backend Processing & AI Classification

1. **Preliminary check**: reject if lighting insufficient; return reason.
2. **Object detection (YOLO)**: exit site + catheter line bounding boxes; reject if not found or too small.
3. **If passed**: crop ROI from exit-site box, resize for CNN.
4. **CNN binary classifier** (ResNet/ConvNext): **Normal** / **Suspected infection**.

**API response shape:**

- `rejected`: upload rejected with reason.
- `accepted`: passed checks with CNN result and bounding box.

### 3. Backend Healthcare Review

- **Table-based UI**: all columns filterable and sortable; click row for detail.
- **Manual annotation**: clinical judgment and comments per case.
- **Notification center** (bell in header): recent alert logs (patient name, case number, LINE username, etc.).
- **Capabilities**: review image history and AI results, check rejection reasons, monitor follow-up alerts, **export data** (with filters).

### 4. Follow-Up Alert

- If AI flags **suspected infection**, send **LINE official account** notification (guidance only; diagnosis by physician).
- Store uploaded image and AI results in backend for staff review.

## System Boundaries

- Capture assistance and risk alerts only; **no diagnosis or prescription**.
- Patient-side Web/LIFF subject to browser and LINE WebView limits.
- **Images**: stored encrypted with audit logs for tracking and research.

## Technical Stack (from PRD)

- **YOLO**: exit-site and catheter line detection.
- **CNN** (ResNet/ConvNext): binary infection classification.
- Backend stores rejection reasons and CNN results.

---

## Getting Started

From the monorepo root, you can run:

```bash
npm run dev:frontend
```

Or run the app directly from this folder:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Docker

The frontend is also available through the monorepo root compose setup:

```bash
npm run docker:up:frontend
```

For client-side API calls, the app reserves `NEXT_PUBLIC_API_BASE_URL`. The example value for local development lives in `.env.example`.

## Learn More

- [Next.js Documentation](https://nextjs.org/docs)
- [Deploy on Vercel](https://nextjs.org/docs/app/building-your-application/deploying)
