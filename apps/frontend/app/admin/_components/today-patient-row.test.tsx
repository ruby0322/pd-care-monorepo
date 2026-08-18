import { render, screen } from "@testing-library/react";

import { TodayPatientRow } from "@/app/admin/_components/today-patient-row";
import type { StaffTodayAttentionPatientItem } from "@/lib/api/staff";

function makePatient(overrides?: Partial<StaffTodayAttentionPatientItem>): StaffTodayAttentionPatientItem {
  return {
    patient_id: 1,
    case_number: "P000001",
    full_name: "測試病患",
    tier: "other",
    representative_upload_id: 101,
    sort_upload_at: "2026-08-09T00:00:00Z",
    has_annotation: false,
    annotation_label: null,
    picture_url: null,
    day_upload_count: 2,
    preview_upload_ids: [],
    risk_highlight: null,
    ...overrides,
  };
}

test("shows the upload count as 上傳 x 張", () => {
  render(
    <TodayPatientRow
      item={makePatient()}
      selected={false}
      onSelect={jest.fn()}
      imageUrlByUploadId={{}}
      imageErrorByUploadId={{}}
    />
  );

  expect(screen.getByText("上傳 2 張")).toBeInTheDocument();
  expect(screen.queryByText("當日 2 張上傳")).not.toBeInTheDocument();
  expect(screen.getByText("未標註")).toBeInTheDocument();
  expect(screen.queryByText("未註解")).not.toBeInTheDocument();
  expect(screen.queryByText("未處理")).not.toBeInTheDocument();
  expect(screen.queryByText("已註解")).not.toBeInTheDocument();
});

test("shows a risk badge and AI percent for suspected highlights", () => {
  render(
    <TodayPatientRow
      item={makePatient({
        tier: "suspected",
        has_annotation: false,
        risk_highlight: {
          upload_id: 101,
          screening_result: "suspected",
          probability: 0.82,
          threshold: 0.5,
          symptom_pain: true,
          symptom_discharge: false,
          symptom_pus: false,
          symptom_cloudy_dialysate: false,
          has_high_risk_symptoms: true,
          symptom_aware_priority: "suspected",
          created_at: "2026-08-09T00:00:00Z",
        },
      })}
      selected={false}
      onSelect={jest.fn()}
      imageUrlByUploadId={{}}
      imageErrorByUploadId={{}}
    />
  );

  expect(screen.getByText("疑似感染")).toBeInTheDocument();
  expect(screen.getByText("AI 82%")).toBeInTheDocument();
  expect(screen.getByText("未標註")).toBeInTheDocument();
});

test("hides symptom chips in list card for elevated risk", () => {
  render(
    <TodayPatientRow
      item={makePatient({
        tier: "elevated",
        has_annotation: false,
        risk_highlight: {
          upload_id: 101,
          screening_result: "normal",
          probability: null,
          threshold: 0.5,
          symptom_pain: true,
          symptom_discharge: false,
          symptom_pus: true,
          symptom_cloudy_dialysate: false,
          has_high_risk_symptoms: true,
          symptom_aware_priority: "suspected",
          created_at: "2026-08-09T00:00:00Z",
        },
      })}
      selected={false}
      onSelect={jest.fn()}
      imageUrlByUploadId={{}}
      imageErrorByUploadId={{}}
    />
  );

  expect(screen.getByText("症狀高風險")).toBeInTheDocument();
  expect(screen.queryByText("疼痛")).not.toBeInTheDocument();
  expect(screen.queryByText("膿")).not.toBeInTheDocument();
});
