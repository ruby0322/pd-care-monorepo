import { sortUploadsByRisk, type StaffUploadQueueItem } from "@/lib/api/staff";

function makeItem(overrides: Partial<StaffUploadQueueItem>): StaffUploadQueueItem {
  return {
    upload_id: 1,
    patient_id: 1,
    case_number: "P1",
    full_name: null,
    line_user_id: null,
    created_at: "2026-05-01T00:00:00Z",
    screening_result: "normal",
    probability: 0.2,
    threshold: 0.5,
    model_version: "v1",
    has_annotation: false,
    symptom_pain: false,
    symptom_discharge: false,
    symptom_pus: false,
    symptom_cloudy_dialysate: false,
    has_high_risk_symptoms: false,
    symptom_aware_priority: "normal",
    ...overrides,
  };
}

describe("sortUploadsByRisk", () => {
  test("ranks symptom_aware_priority suspected above image-normal", () => {
    const elevatedNormal = makeItem({
      upload_id: 2,
      screening_result: "normal",
      symptom_aware_priority: "suspected",
      has_high_risk_symptoms: true,
      symptom_pain: true,
      probability: 0.1,
      created_at: "2026-05-01T01:00:00Z",
    });
    const imageNormal = makeItem({
      upload_id: 3,
      screening_result: "normal",
      symptom_aware_priority: "normal",
      probability: 0.9,
      created_at: "2026-05-01T02:00:00Z",
    });
    const imageSuspected = makeItem({
      upload_id: 1,
      screening_result: "suspected",
      symptom_aware_priority: "suspected",
      probability: 0.8,
      created_at: "2026-05-01T00:00:00Z",
    });

    const sorted = sortUploadsByRisk([imageNormal, elevatedNormal, imageSuspected]);
    expect(sorted.map((item) => item.upload_id)).toEqual([1, 2, 3]);
    expect(sorted[0].risk_rank).toBe(0);
    expect(sorted[1].risk_rank).toBe(0);
    expect(sorted[2].risk_rank).toBe(2);
  });
});
