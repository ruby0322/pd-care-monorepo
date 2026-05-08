---
title: Peritoneal Dialysis Exit-Site Imaging and Infection Alert System 
subtitle: Product Requiredment Document
author: National Taiwan University Hospital Research Project  
date: Jan. 2026
version: 1.0.0
---

# Product Objective

The system assists peritoneal dialysis patients in standardizing exit-site image capture, uses deep learning (DL) to provide potential infection alerts, while final diagnosis and medical advice remain the responsibility of physicians. Key objectives:

- Ensure consistent and high-quality patient-captured images
- Provide DL-based alert for potential infection
- Build an image database for backend review and research analysis

# User Roles and Requirements

| Role | Function Scope | Key Requirements |
|------|----------------|----------------|
| Patient | Capture images, receive alerts | Guided UI, prompt messages, image upload |
| Healthcare Staff | Image review | Review image history, verify model outputs, monitor follow-up alerts |
| Backend Admin | System maintenance | User management, model versioning, data access control |

# System Architecture and Workflow

## Workflow Diagram

![Flow Chart](./flow-chart.png){width=100%}

# Core Features and Workflow

## Patient-Side Capture

- Single-step capture
- Fixed-size circular dashed mask for exit-site alignment
- Instruction messages:
  - Ensure sufficient lighting
  - Align exit site within the mask
  - Make sure catheter line is visible
- Upload image to backend

## Backend Processing and AI Classification

1. Preliminary check:
  - Reject if lighting is insufficient; return reason

2. Object detection using YOLO:
  - Detect exit site and catheter line bounding boxes
  - Reject if targets are not found or bounding boxes are too small
3. If passed:
  - Crop ROI based on exit-site bounding box
  - Resize to CNN input size
4. CNN binary classifier (ResNet/ConvNext) outputs Normal / Suspected infection

## Backend Healthcare Review

The backend interface is primarily table-based, with all columns supporting filtering and sorting capabilities. Healthcare staff can click on individual data rows to view detailed information and manually annotate clinical judgment results and comments.

A notification center (bell icon) is located in the top navigation bar (header/nav), providing access to recent alert logs containing patient names, case numbers, LINE usernames, and other relevant information.

Key features include:

- Review patient image history and AI interpretation results
- Check rejected upload reasons
- Monitor follow-up alert notifications
- Export data (with filters)

## Follow-Up Alert

- If AI detects suspected infection, system sends notification message via LINE official account
- Message is a guidance alert; final diagnosis remains with physician
- Uploaded image and AI results are stored in backend for staff review

# System Boundaries and Limitations

- System only provides capture assistance and risk alerts
- No medical diagnosis or prescription is given
- Patient-side Web/LIFF is subject to browser and LINE WebView limitations
- Images must be stored encrypted with audit logs for tracking and research

# Technical Considerations

- YOLO for exit-site and catheter line detection
- CNN (ResNet/ConvNext) for binary infection classification
- Store rejected reasons and CNN results in backend
- API response:
  - `rejected`: upload rejected with reason
  - `accepted`: passed checks with CNN result and bounding box
