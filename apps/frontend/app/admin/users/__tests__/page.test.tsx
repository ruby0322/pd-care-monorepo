import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import AdminUsersPage from "@/app/admin/users/page";
import {
  fetchAdminAccessRequests,
  fetchAdminStaffOverview,
  fetchAdminUsersPage,
  fetchStaffMe,
  updateAdminUserRealName,
  updateAdminUserRole,
  updateAdminUserStatus,
} from "@/lib/api/staff";

const mockSearchParams = new URLSearchParams();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: jest.fn() }),
  usePathname: () => "/admin/users",
  useSearchParams: () => mockSearchParams,
}));

jest.mock("sonner", () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock("@/lib/api/staff", () => ({
  fetchStaffMe: jest.fn(),
  fetchAdminUsersPage: jest.fn(),
  fetchAdminAccessRequests: jest.fn(),
  fetchAdminStaffOverview: jest.fn(),
  updateAdminUserStatus: jest.fn(),
  updateAdminUserRole: jest.fn(),
  updateAdminUserRealName: jest.fn(),
  approveAdminAccessRequest: jest.fn(),
  rejectAdminAccessRequest: jest.fn(),
  previewDeleteInactiveAdminUsers: jest.fn(),
  deleteInactiveAdminUsers: jest.fn(),
}));

describe("AdminUsersPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fetchStaffMe as jest.Mock).mockResolvedValue({ line_user_id: "U_ADMIN", role: "admin" });
    (fetchAdminAccessRequests as jest.Mock).mockResolvedValue([]);
    (fetchAdminStaffOverview as jest.Mock).mockResolvedValue({
      items: [
        {
          identity_id: 1,
          line_user_id: "U_STAFF_1",
          display_name: "LINE Name 1",
          real_name: "Dr. Chen",
          picture_url: null,
          role: "staff",
          is_active: true,
          assigned_patient_count: 4,
          review_count_7d: 3,
          review_count_30d: 11,
          last_review_at: "2026-10-31T00:00:00Z",
          created_at: "2026-05-01T00:00:00Z",
        },
        {
          identity_id: 2,
          line_user_id: "U_ADMIN",
          display_name: "Admin Lin",
          real_name: null,
          picture_url: null,
          role: "admin",
          is_active: true,
          assigned_patient_count: 0,
          review_count_7d: 0,
          review_count_30d: 0,
          last_review_at: null,
          created_at: "2026-04-01T00:00:00Z",
        },
      ],
      summary: {
        staff_count: 2,
        active_staff_count: 2,
        pending_access_request_count: 0,
        zero_assignment_staff_count: 1,
        unassigned_patient_count: 5,
      },
    });
    (updateAdminUserRole as jest.Mock).mockResolvedValue({});
    (updateAdminUserStatus as jest.Mock).mockResolvedValue({});
    (fetchAdminUsersPage as jest.Mock).mockResolvedValue({
      items: [
        {
          id: 1,
          line_user_id: "U_STAFF_1",
          display_name: "LINE Name 1",
          real_name: "Dr. Chen",
          role: "staff",
          is_active: true,
          patient_id: null,
          created_at: "2026-05-01T00:00:00Z",
        },
      ],
      total: 1,
      limit: 10,
      offset: 0,
    });
    (updateAdminUserRealName as jest.Mock).mockResolvedValue({
      id: 1,
      line_user_id: "U_STAFF_1",
      display_name: "LINE Name 1",
      real_name: "Dr. Wang",
      role: "staff",
      is_active: true,
      patient_id: null,
      created_at: "2026-05-01T00:00:00Z",
    });
  });

  test("renders separate LINE display name and real name columns", async () => {
    render(<AdminUsersPage />);

    await waitFor(() => {
      expect(screen.getByText("LINE 顯示名稱")).toBeInTheDocument();
      expect(screen.getByText("真實姓名")).toBeInTheDocument();
    });
  });

  test("allows admin to edit real name for staff/admin rows", async () => {
    render(<AdminUsersPage />);

    const identityTable = await screen.findByRole("region", { name: "全部用戶" });
    const editButton = within(identityTable).getByRole("button", { name: "更新姓名" });
    fireEvent.click(editButton);

    const input = await screen.findByLabelText("真實姓名");
    fireEvent.change(input, { target: { value: "Dr. Wang" } });

    fireEvent.click(screen.getByRole("button", { name: "儲存姓名" }));

    await waitFor(() => {
      expect(updateAdminUserRealName).toHaveBeenCalledWith(1, { real_name: "Dr. Wang" });
    });
  });

  test("shows total-aware footer and requests next page", async () => {
    (fetchAdminUsersPage as jest.Mock)
      .mockResolvedValueOnce({
        items: [
          {
            id: 1,
            line_user_id: "U_STAFF_1",
            display_name: "LINE Name 1",
            real_name: "Dr. Chen",
            role: "staff",
            is_active: true,
            patient_id: null,
            created_at: "2026-05-01T00:00:00Z",
          },
        ],
        total: 12,
        limit: 10,
        offset: 0,
      })
      .mockResolvedValueOnce({
        items: [
          {
            id: 11,
            line_user_id: "U_STAFF_11",
            display_name: "LINE Name 11",
            real_name: "Dr. Eleven",
            role: "staff",
            is_active: true,
            patient_id: null,
            created_at: "2026-05-11T00:00:00Z",
          },
          {
            id: 12,
            line_user_id: "U_STAFF_12",
            display_name: "LINE Name 12",
            real_name: "Dr. Twelve",
            role: "staff",
            is_active: true,
            patient_id: null,
            created_at: "2026-05-12T00:00:00Z",
          },
        ],
        total: 12,
        limit: 10,
        offset: 10,
      });

    render(<AdminUsersPage />);

    await waitFor(() => {
      expect(screen.getByText("顯示 1-1 / 12 位用戶（目前篩選與當前頁面）")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "下一頁" }));

    await waitFor(() => {
      expect(fetchAdminUsersPage).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: 10,
          offset: 10,
        })
      );
    });
  });

  test("resets user page to first page when filter query changes", async () => {
    (fetchAdminUsersPage as jest.Mock)
      .mockResolvedValueOnce({
        items: [
          {
            id: 1,
            line_user_id: "U_STAFF_1",
            display_name: "LINE Name 1",
            real_name: "Dr. Chen",
            role: "staff",
            is_active: true,
            patient_id: null,
            created_at: "2026-05-01T00:00:00Z",
          },
        ],
        total: 12,
        limit: 10,
        offset: 0,
      })
      .mockResolvedValueOnce({
        items: [
          {
            id: 11,
            line_user_id: "U_STAFF_11",
            display_name: "LINE Name 11",
            real_name: "Dr. Eleven",
            role: "staff",
            is_active: true,
            patient_id: null,
            created_at: "2026-05-11T00:00:00Z",
          },
        ],
        total: 12,
        limit: 10,
        offset: 10,
      })
      .mockResolvedValue({
        items: [
          {
            id: 1,
            line_user_id: "U_STAFF_1",
            display_name: "LINE Name 1",
            real_name: "Dr. Chen",
            role: "staff",
            is_active: true,
            patient_id: null,
            created_at: "2026-05-01T00:00:00Z",
          },
        ],
        total: 1,
        limit: 10,
        offset: 0,
      });

    render(<AdminUsersPage />);

    await waitFor(() => {
      expect(fetchAdminUsersPage).toHaveBeenCalledWith(expect.objectContaining({ offset: 0 }));
    });

    fireEvent.click(screen.getByRole("button", { name: "下一頁" }));

    await waitFor(() => {
      expect(fetchAdminUsersPage).toHaveBeenCalledWith(expect.objectContaining({ offset: 10 }));
    });

    fireEvent.change(screen.getByPlaceholderText("搜尋姓名 / LINE ID / 角色"), { target: { value: "staff" } });

    await waitFor(() => {
      expect(fetchAdminUsersPage).toHaveBeenCalledWith(expect.objectContaining({ query: "staff", offset: 0 }));
    });
  });
  test("renders the staff roster with workload and review metrics", async () => {
    render(<AdminUsersPage />);

    await waitFor(() => {
      expect(screen.getByText("醫護團隊")).toBeInTheDocument();
    });

    expect(screen.getByText("負責病患")).toBeInTheDocument();
    expect(screen.getByText("近 7 日審核")).toBeInTheDocument();
    expect(screen.getByText("近 30 日審核")).toBeInTheDocument();
    expect(screen.getByText("最近審核")).toBeInTheDocument();
    // The admin row has never reviewed anything.
    expect(within(screen.getByRole("region", { name: "醫護團隊" })).getByText("從未審核")).toBeInTheDocument();
  });

  test("renders the KPI band with coverage gap counts from the summary", async () => {
    render(<AdminUsersPage />);

    await waitFor(() => {
      expect(screen.getByText("零指派醫護")).toBeInTheDocument();
    });

    expect(screen.getByText("在職醫護")).toBeInTheDocument();
    expect(screen.getByText("未分配病患")).toBeInTheDocument();
    expect(screen.getByText("共 2 個 staff/admin 帳號")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  test("keeps the staff roster separate from the full identity table", async () => {
    render(<AdminUsersPage />);

    await waitFor(() => {
      expect(screen.getByText("醫護團隊")).toBeInTheDocument();
    });

    expect(screen.getByText("全部用戶")).toBeInTheDocument();
  });

  test("disables role and status actions on the signed-in admin's own row", async () => {
    render(<AdminUsersPage />);

    await waitFor(() => {
      expect(screen.getByText("醫護團隊")).toBeInTheDocument();
    });

    // fetchStaffMe resolves as U_ADMIN, which is identity_id 2 in the roster.
    const roster = screen.getByRole("region", { name: "醫護團隊" });
    expect(within(roster).getByRole("button", { name: "降為 staff" })).toBeDisabled();
    // The other staff row stays actionable.
    expect(within(roster).getByRole("button", { name: "升為 admin" })).toBeEnabled();
  });

  test("promotes a staff member to admin from the roster", async () => {
    render(<AdminUsersPage />);

    await waitFor(() => {
      expect(screen.getByText("醫護團隊")).toBeInTheDocument();
    });

    fireEvent.click(within(screen.getByRole("region", { name: "醫護團隊" })).getByRole("button", { name: "升為 admin" }));

    await waitFor(() => {
      expect(updateAdminUserRole).toHaveBeenCalledWith(1, { role: "admin" });
    });
  });

  test("filters the roster by name without refetching the identity table", async () => {
    render(<AdminUsersPage />);

    await waitFor(() => {
      expect(screen.getByText("醫護團隊")).toBeInTheDocument();
    });

    const roster = screen.getByRole("region", { name: "醫護團隊" });
    const callsBefore = (fetchAdminUsersPage as jest.Mock).mock.calls.length;
    fireEvent.change(screen.getByLabelText("搜尋醫護"), { target: { value: "Admin Lin" } });

    await waitFor(() => {
      expect(within(roster).queryByText("Dr. Chen")).not.toBeInTheDocument();
    });
    expect(within(roster).getByText("Admin Lin")).toBeInTheDocument();
    // Roster filtering is client-side; it must not refetch the identity table.
    expect((fetchAdminUsersPage as jest.Mock).mock.calls.length).toBe(callsBefore);
  });
});
