import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import AdminUsersPage from "@/app/admin/users/page";
import {
  fetchAdminAccessRequests,
  fetchAdminUsersPage,
  fetchStaffMe,
  updateAdminUserRealName,
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

    const editButton = await screen.findByRole("button", { name: "更新姓名" });
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
});
