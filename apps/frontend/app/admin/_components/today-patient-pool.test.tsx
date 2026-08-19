import { render, screen } from "@testing-library/react";

import { TodayPatientPool } from "@/app/admin/_components/today-patient-pool";
import type { StaffTodayAttentionPatientItem } from "@/lib/api/staff";

jest.mock("@/app/admin/_components/use-upload-image-urls", () => ({
  useUploadImageUrls: () => ({ imageUrlByUploadId: {}, imageErrorByUploadId: {} }),
}));

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
    day_upload_count: 4,
    preview_upload_ids: [101, 102, 103, 104],
    risk_highlight: null,
    ...overrides,
  };
}

test("keeps the original breakpoint column grid for patient cards", () => {
  const { container } = render(
    <TodayPatientPool
      loading={false}
      error={null}
      suspectedPatients={0}
      elevatedPatients={0}
      otherPatients={1}
      items={[makePatient()]}
      dayScopeLabel="今日"
      selectedDate="2026-08-09"
      selectedPatientId={1}
      onSelectPatient={jest.fn()}
    />
  );

  const grid = container.querySelector(".grid");
  expect(grid?.className).toContain("xl:grid-cols-3");
  expect(grid?.className).not.toContain("auto-fill");
  expect(screen.getByText("上傳 4 張")).toBeInTheDocument();
});
