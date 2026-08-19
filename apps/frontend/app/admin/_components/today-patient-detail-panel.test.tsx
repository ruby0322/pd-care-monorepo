import { render, screen } from "@testing-library/react";

import { TodayPatientDetailPanel } from "@/app/admin/_components/today-patient-detail-panel";
import type { StaffTodayAttentionPatientItem } from "@/lib/api/staff";

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
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
    day_upload_count: 6,
    preview_upload_ids: [101, 102, 103, 104],
    risk_highlight: null,
    ...overrides,
  };
}

test("overlays +n on the last preview thumb instead of adding a fifth overflow cell", () => {
  const { container } = render(
    <TodayPatientDetailPanel
      item={makePatient()}
      selectedDate="2026-08-09"
      dayScopeLabel="今日"
    />
  );

  const previewCells = container.querySelectorAll(".aspect-square");
  expect(previewCells).toHaveLength(4);
  const overlay = screen.getByText("+2");
  expect(overlay.className).toContain("bg-black/50");
  expect(previewCells[3].contains(overlay)).toBe(true);
});
