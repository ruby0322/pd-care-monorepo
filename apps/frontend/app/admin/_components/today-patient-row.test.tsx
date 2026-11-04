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
    annotation_reviewer_name: null,
    annotation_reviewed_by_me: false,
    annotation_reviewer_count: 0,
    annotation_reviewed_at: null,
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

test("keeps three fixed 56px thumbs and does not show +n when the patient uploaded three images", () => {
  const { container } = render(
    <TodayPatientRow
      item={makePatient({
        day_upload_count: 3,
        preview_upload_ids: [101, 102, 103],
      })}
      selected={false}
      onSelect={jest.fn()}
      imageUrlByUploadId={{}}
      imageErrorByUploadId={{}}
    />
  );

  const thumbs = container.querySelectorAll(".h-14.w-14.shrink-0");
  expect(thumbs).toHaveLength(3);
  expect(screen.queryByText(/^\+\d+$/)).not.toBeInTheDocument();
});

test("overlays +n on the last of three thumbs when four or more images would overflow the card", () => {
  const { container } = render(
    <TodayPatientRow
      item={makePatient({
        day_upload_count: 4,
        preview_upload_ids: [101, 102, 103, 104],
      })}
      selected={false}
      onSelect={jest.fn()}
      imageUrlByUploadId={{}}
      imageErrorByUploadId={{}}
    />
  );

  const thumbs = container.querySelectorAll(".h-14.w-14.shrink-0");
  expect(thumbs).toHaveLength(3);
  const overlay = screen.getByText("+1");
  expect(overlay.className).toContain("bg-black/30");
  expect(thumbs[2].contains(overlay)).toBe(true);
});

test("overlays leftover count on the last thumb when the patient uploaded more than four images", () => {
  const { container } = render(
    <TodayPatientRow
      item={makePatient({
        day_upload_count: 6,
        preview_upload_ids: [101, 102, 103, 104],
      })}
      selected={false}
      onSelect={jest.fn()}
      imageUrlByUploadId={{}}
      imageErrorByUploadId={{}}
    />
  );

  const thumbs = container.querySelectorAll(".h-14.w-14.shrink-0");
  expect(thumbs).toHaveLength(3);
  const overlay = screen.getByText("+3");
  expect(overlay.className).toContain("bg-black/30");
  expect(thumbs[2].contains(overlay)).toBe(true);
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

function renderRow(item: StaffTodayAttentionPatientItem) {
  return render(
    <TodayPatientRow
      item={item}
      selected={false}
      onSelect={jest.fn()}
      imageUrlByUploadId={{}}
      imageErrorByUploadId={{}}
    />
  );
}

test("shows no reviewer line when the representative upload is unannotated", () => {
  renderRow(makePatient());

  expect(screen.queryByText(/已標註/)).not.toBeInTheDocument();
});

test("shows the reviewer name and Taipei time of the annotation", () => {
  renderRow(
    makePatient({
      has_annotation: true,
      annotation_label: "normal",
      annotation_reviewer_name: "林美玲",
      annotation_reviewer_count: 1,
      annotation_reviewed_at: "2026-08-09T06:22:00Z",
    })
  );

  expect(screen.getByText("林美玲 14:22 已標註")).toBeInTheDocument();
});

test("shows 我 when the viewer annotated it", () => {
  renderRow(
    makePatient({
      has_annotation: true,
      annotation_label: "suspected",
      annotation_reviewer_name: "林美玲",
      annotation_reviewed_by_me: true,
      annotation_reviewer_count: 1,
      annotation_reviewed_at: "2026-08-09T06:22:00Z",
    })
  );

  expect(screen.getByText("我 14:22 已標註")).toBeInTheDocument();
});

test("shows the reviewer count when several staff annotated the same upload", () => {
  renderRow(
    makePatient({
      has_annotation: true,
      annotation_label: "confirmed_infection",
      annotation_reviewer_name: "林美玲",
      annotation_reviewer_count: 3,
      annotation_reviewed_at: "2026-08-09T06:22:00Z",
    })
  );

  expect(screen.getByText("林美玲 等 3 人 14:22 已標註")).toBeInTheDocument();
});

test("falls back to 未命名 when the reviewer has no name on file", () => {
  renderRow(
    makePatient({
      has_annotation: true,
      annotation_label: "normal",
      annotation_reviewer_name: null,
      annotation_reviewer_count: 1,
      annotation_reviewed_at: "2026-08-09T06:22:00Z",
    })
  );

  expect(screen.getByText("未命名 14:22 已標註")).toBeInTheDocument();
});
