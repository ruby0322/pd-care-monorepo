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
    annotation_reviewer_name: null,
    annotation_reviewed_by_me: false,
    annotation_reviewer_count: 0,
    annotation_reviewed_at: null,
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
  expect(overlay.className).toContain("bg-black/30");
  expect(previewCells[3].contains(overlay)).toBe(true);
});

test("shows the annotation reviewer line, keeping the handled colour cue", () => {
  render(
    <TodayPatientDetailPanel
      item={makePatient({
        has_annotation: true,
        annotation_label: "normal",
        annotation_reviewer_name: "林美玲",
        annotation_reviewer_count: 1,
        annotation_reviewed_at: "2026-08-09T06:22:00Z",
      })}
      selectedDate="2026-08-09"
      dayScopeLabel="今日"
    />
  );

  const reviewerLine = screen.getByText("林美玲 14:22 已標註");
  expect(reviewerLine.className).toContain("text-emerald-600");
  expect(screen.queryByText("未標註")).not.toBeInTheDocument();
});

test("still shows 未標註 when nobody annotated the representative upload", () => {
  render(
    <TodayPatientDetailPanel
      item={makePatient()}
      selectedDate="2026-08-09"
      dayScopeLabel="今日"
    />
  );

  const meta = screen.getByText(/張上傳/);
  expect(meta.textContent).toContain("未標註");
  expect(meta.textContent).not.toContain("已標註");
});
