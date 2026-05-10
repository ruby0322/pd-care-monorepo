-- PD Care manual seed for calendar testing
-- IMPORTANT:
-- 1) This file is NOT auto-executed by app startup or tests.
-- 2) Execute it manually when needed.
-- 3) Recommended command:
--    psql "$DATABASE_URL" -f apps/backend/sql/manual/patient_calendar_demo_seed.sql
--    Or from apps/backend: python sql/manual/seed_calendar_demo.py
--
-- This seed creates one matched LIFF user with multi-day upload history:
-- - grey day: no uploads
-- - green day: uploads with normal-only result
-- - red day: at least one suspected result
-- - intensity: days with multiple uploads

-- Bound LINE user (tester): Ua330fd0f658e181bb850be04bdb20251 → patient P-DEMO-CALENDAR-001

BEGIN;

-- Optional cleanup so this script is repeatable for the same demo identity/patient.
DELETE FROM ai_results
WHERE upload_id IN (
    SELECT u.id
    FROM uploads AS u
    JOIN patients AS p ON p.id = u.patient_id
    WHERE p.case_number = 'P-DEMO-CALENDAR-001' AND p.birth_date = '1985-06-15'
);

DELETE FROM uploads
WHERE patient_id IN (
    SELECT id
    FROM patients
    WHERE case_number = 'P-DEMO-CALENDAR-001' AND birth_date = '1985-06-15'
);

DELETE FROM liff_identities
WHERE line_user_id = 'Ua330fd0f658e181bb850be04bdb20251';

DELETE FROM pending_bindings
WHERE line_user_id = 'Ua330fd0f658e181bb850be04bdb20251';

DELETE FROM patients
WHERE case_number = 'P-DEMO-CALENDAR-001' AND birth_date = '1985-06-15';

WITH new_patient AS (
    INSERT INTO patients (case_number, birth_date, full_name, is_active)
    VALUES ('P-DEMO-CALENDAR-001', '1985-06-15', 'Calendar Demo Patient', TRUE)
    RETURNING id
),
new_identity AS (
    INSERT INTO liff_identities (line_user_id, display_name, picture_url, patient_id, role)
    SELECT
        'Ua330fd0f658e181bb850be04bdb20251',
        'Calendar Demo User',
        'https://example.com/calendar-demo-user.jpg',
        id,
        'patient'
    FROM new_patient
),
-- Day A (green, count=1)
upload_a1 AS (
    INSERT INTO uploads (patient_id, object_key, content_type, created_at)
    SELECT
        id,
        'patients/demo/uploads/2026-05-05-a1.jpg',
        'image/jpeg',
        '2026-05-05 09:10:00+08'
    FROM new_patient
    RETURNING id
),
result_a1 AS (
    INSERT INTO ai_results (upload_id, screening_result, predicted_class, probability, threshold, model_version, error_reason)
    SELECT
        id,
        'normal',
        'class_1',
        0.08,
        0.50,
        'demo-model-v1',
        NULL
    FROM upload_a1
),
-- Day B (red, count=2; one suspected)
upload_b1 AS (
    INSERT INTO uploads (patient_id, object_key, content_type, created_at)
    SELECT
        id,
        'patients/demo/uploads/2026-05-06-b1.jpg',
        'image/jpeg',
        '2026-05-06 08:30:00+08'
    FROM new_patient
    RETURNING id
),
result_b1 AS (
    INSERT INTO ai_results (upload_id, screening_result, predicted_class, probability, threshold, model_version, error_reason)
    SELECT
        id,
        'suspected',
        'class_4',
        0.89,
        0.50,
        'demo-model-v1',
        NULL
    FROM upload_b1
),
upload_b2 AS (
    INSERT INTO uploads (patient_id, object_key, content_type, created_at)
    SELECT
        id,
        'patients/demo/uploads/2026-05-06-b2.jpg',
        'image/jpeg',
        '2026-05-06 20:10:00+08'
    FROM new_patient
    RETURNING id
),
result_b2 AS (
    INSERT INTO ai_results (upload_id, screening_result, predicted_class, probability, threshold, model_version, error_reason)
    SELECT
        id,
        'normal',
        'class_1',
        0.12,
        0.50,
        'demo-model-v1',
        NULL
    FROM upload_b2
),
-- Day C (green, count=3, darker intensity)
upload_c1 AS (
    INSERT INTO uploads (patient_id, object_key, content_type, created_at)
    SELECT
        id,
        'patients/demo/uploads/2026-05-08-c1.jpg',
        'image/jpeg',
        '2026-05-08 07:45:00+08'
    FROM new_patient
    RETURNING id
),
result_c1 AS (
    INSERT INTO ai_results (upload_id, screening_result, predicted_class, probability, threshold, model_version, error_reason)
    SELECT
        id,
        'normal',
        'class_1',
        0.09,
        0.50,
        'demo-model-v1',
        NULL
    FROM upload_c1
),
upload_c2 AS (
    INSERT INTO uploads (patient_id, object_key, content_type, created_at)
    SELECT
        id,
        'patients/demo/uploads/2026-05-08-c2.jpg',
        'image/jpeg',
        '2026-05-08 12:30:00+08'
    FROM new_patient
    RETURNING id
),
result_c2 AS (
    INSERT INTO ai_results (upload_id, screening_result, predicted_class, probability, threshold, model_version, error_reason)
    SELECT
        id,
        'normal',
        'class_2',
        0.15,
        0.50,
        'demo-model-v1',
        NULL
    FROM upload_c2
),
upload_c3 AS (
    INSERT INTO uploads (patient_id, object_key, content_type, created_at)
    SELECT
        id,
        'patients/demo/uploads/2026-05-08-c3.jpg',
        'image/jpeg',
        '2026-05-08 21:00:00+08'
    FROM new_patient
    RETURNING id
)
INSERT INTO ai_results (upload_id, screening_result, predicted_class, probability, threshold, model_version, error_reason)
SELECT
    id,
    'normal',
    'class_0',
    0.05,
    0.50,
    'demo-model-v1',
    NULL
FROM upload_c3;

COMMIT;

-- LINE user id bound to demo patient (re-run this file after schema resets).
-- line_user_id: Ua330fd0f658e181bb850be04bdb20251
