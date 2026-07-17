import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import AdminHistoryOverviewPage from "@/app/admin/history-overview/page";
import {
  fetchHistoryOverview,
  fetchHistoryOverviewCalendar,
  fetchHistoryOverviewDays,
  fetchUploadImageAccess,
  StaffHistoryOverviewResponse,
  StaffHistoryOverviewUploadItem,
  StaffHistoryOverviewUserGroupItem,
} from "@/lib/api/staff";

jest.mock("next/image", () => ({
  __esModule: true,
  default: (props: { alt?: string; src?: string } & Record<string, unknown>) => {
    const { alt, src } = props;
    // eslint-disable-next-line @next/next/no-img-element
    return <img alt={alt ?? ""} src={typeof src === "string" ? src : ""} />;
  },
}));

jest.mock("sonner", () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock("@/lib/api/staff", () => ({
  fetchHistoryOverviewDays: jest.fn(),
  fetchHistoryOverview: jest.fn(),
  fetchHistoryOverviewCalendar: jest.fn(),
  fetchUploadImageAccess: jest.fn(),
  upsertUploadAnnotation: jest.fn(),
}));

class MockIntersectionObserver {
  observe = jest.fn();
  unobserve = jest.fn();
  disconnect = jest.fn();
}

function makeUpload(overrides?: Partial<StaffHistoryOverviewUploadItem>): StaffHistoryOverviewUploadItem {
  return {
    upload_id: 501,
    patient_id: 42,
    case_number: "P000042",
    patient_full_name: "Full Name Patient",
    gender: "female",
    line_user_id: "U_PATIENT_42",
    line_display_name: "LINE Patient",
    real_name: "Real Name Patient",
    picture_url: "/avatar.jpg",
    age: 65,
    created_at: "2026-07-10T08:00:00Z",
    screening_result: "suspected",
    probability: 0.82,
    threshold: 0.5,
    model_version: "v1",
    symptom_pain: true,
    symptom_discharge: false,
    symptom_pus: false,
    symptom_cloudy_dialysate: false,
    has_high_risk_symptoms: true,
    symptom_aware_priority: "suspected",
    annotation_label: null,
    annotation_comment: null,
    risk_rank: 1,
    ...overrides,
  };
}

function makeGroup(overrides?: Partial<StaffHistoryOverviewUserGroupItem>): StaffHistoryOverviewUserGroupItem {
  const upload = makeUpload(overrides?.uploads?.[0]);
  return {
    patient_id: upload.patient_id,
    case_number: upload.case_number,
    patient_full_name: upload.patient_full_name,
    gender: upload.gender,
    age: upload.age,
    line_user_id: upload.line_user_id,
    line_display_name: upload.line_display_name,
    real_name: upload.real_name,
    picture_url: upload.picture_url,
    upload_count: overrides?.upload_count ?? 1,
    highest_risk_rank: upload.risk_rank,
    highest_risk_count: 1,
    latest_upload_at: upload.created_at,
    uploads: [upload],
    ...overrides,
  };
}

function makeOverviewResponse(
  overrides?: Partial<StaffHistoryOverviewResponse>
): StaffHistoryOverviewResponse {
  const group = makeGroup();
  return {
    local_date: "2026-07-10",
    sort_by: "timeline",
    group_by_user: true,
    group_sort_by: "infection_risk",
    kpi: {
      uploaded_users: 1,
      uploads: 1,
      suspected_infected_users: 1,
      infection_rate: 1,
    },
    items: group.uploads,
    groups: [group],
    ...overrides,
  };
}

describe("AdminHistoryOverviewPage grouped patient navigation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.IntersectionObserver = MockIntersectionObserver as unknown as typeof IntersectionObserver;

    (fetchHistoryOverviewDays as jest.Mock).mockResolvedValue({
      items: [
        {
          local_date: "2026-07-10",
          upload_count: 1,
          uploaded_users: 1,
          suspected_infected_users: 1,
          infection_rate: 1,
          risky_patient_count: 1,
          has_infection_risk: true,
        },
      ],
    });
    (fetchHistoryOverview as jest.Mock).mockResolvedValue(makeOverviewResponse());
    (fetchHistoryOverviewCalendar as jest.Mock).mockResolvedValue({
      year: 2026,
      month: 7,
      items: [{ local_date: "2026-07-10", risky_patient_count: 1, has_infection_risk: true }],
    });
    (fetchUploadImageAccess as jest.Mock).mockResolvedValue({ image_url: "/mock-upload.jpg" });
  });

  test("links grouped avatar and patient name to the staff patient detail page", async () => {
    render(<AdminHistoryOverviewPage />);

    const avatarLink = await screen.findByRole("link", { name: "查看 Real Name Patient 詳情" });
    expect(avatarLink).toHaveAttribute("href", "/admin/patients/42");

    const nameLink = screen.getByRole("link", { name: "Real Name Patient" });
    expect(nameLink).toHaveAttribute("href", "/admin/patients/42");
  });

  test("uses patient_full_name when real_name is missing", async () => {
    (fetchHistoryOverview as jest.Mock).mockResolvedValue(
      makeOverviewResponse({
        groups: [
          makeGroup({
            real_name: null,
            patient_full_name: "Fallback Full Name",
            uploads: [makeUpload({ real_name: null, patient_full_name: "Fallback Full Name" })],
          }),
        ],
      })
    );

    render(<AdminHistoryOverviewPage />);

    expect(await screen.findByRole("link", { name: "查看 Fallback Full Name 詳情" })).toHaveAttribute(
      "href",
      "/admin/patients/42"
    );
    expect(screen.getByRole("link", { name: "Fallback Full Name" })).toHaveAttribute("href", "/admin/patients/42");
  });

  test("shows 未命名 when both real_name and patient_full_name are missing", async () => {
    (fetchHistoryOverview as jest.Mock).mockResolvedValue(
      makeOverviewResponse({
        groups: [
          makeGroup({
            real_name: null,
            patient_full_name: null,
            uploads: [makeUpload({ real_name: null, patient_full_name: null })],
          }),
        ],
      })
    );

    render(<AdminHistoryOverviewPage />);

    expect(await screen.findByRole("link", { name: "查看 病患 詳情" })).toHaveAttribute("href", "/admin/patients/42");
    expect(screen.getByRole("link", { name: "未命名" })).toHaveAttribute("href", "/admin/patients/42");
  });

  test("opens upload detail modal from grouped thumbnails without patient header navigation", async () => {
    render(<AdminHistoryOverviewPage />);

    await screen.findByRole("link", { name: "Real Name Patient" });

    const groupArticle = screen.getByText("當日上傳 1 張").closest("article");
    expect(groupArticle).not.toBeNull();

    const uploadButton = within(groupArticle as HTMLElement).getByRole("button", { name: /16:00:00/ });
    fireEvent.click(uploadButton);

    expect(await screen.findByText("開啟病患完整頁")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "開啟病患完整頁" })).toHaveAttribute("href", "/admin/patients/42");
    expect(screen.getByText("Full Name Patient")).toBeInTheDocument();
  });

  test("hides grouped patient links when group mode is disabled", async () => {
    (fetchHistoryOverview as jest.Mock).mockImplementation(async (params: { groupByUser: boolean }) =>
      makeOverviewResponse({
        group_by_user: params.groupByUser,
      })
    );

    render(<AdminHistoryOverviewPage />);

    await screen.findByRole("link", { name: "Real Name Patient" });

    fireEvent.click(screen.getByRole("button", { name: "已群組" }));

    await waitFor(() => {
      expect(screen.queryByRole("link", { name: "Real Name Patient" })).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "查看 Real Name Patient 詳情" })).not.toBeInTheDocument();
    });
  });

  test("refetches overview when sort controls change", async () => {
    render(<AdminHistoryOverviewPage />);

    await screen.findByRole("link", { name: "Real Name Patient" });
    expect(fetchHistoryOverview).toHaveBeenCalledWith({
      localDate: "2026-07-10",
      sortBy: "timeline",
      groupByUser: true,
      groupSortBy: "infection_risk",
    });

    fireEvent.change(screen.getByDisplayValue("排序：上傳時間"), { target: { value: "risk" } });

    await waitFor(() => {
      expect(fetchHistoryOverview).toHaveBeenLastCalledWith({
        localDate: "2026-07-10",
        sortBy: "risk",
        groupByUser: true,
        groupSortBy: "infection_risk",
      });
    });

    fireEvent.change(screen.getByDisplayValue("群組排序：感染風險"), { target: { value: "age" } });

    await waitFor(() => {
      expect(fetchHistoryOverview).toHaveBeenLastCalledWith({
        localDate: "2026-07-10",
        sortBy: "risk",
        groupByUser: true,
        groupSortBy: "age",
      });
    });
  });
});
