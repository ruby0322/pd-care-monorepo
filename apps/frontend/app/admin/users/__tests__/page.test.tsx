import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import AdminUsersPage from "@/app/admin/users/page";
import {
  fetchAdminAccessRequests,
  fetchAdminUsers,
  fetchStaffMe,
  updateAdminUserRealName,
} from "@/lib/api/staff";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: jest.fn() }),
  usePathname: () => "/admin/users",
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock("sonner", () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock("@/lib/api/staff", () => ({
  fetchStaffMe: jest.fn(),
  fetchAdminUsers: jest.fn(),
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
    (fetchAdminUsers as jest.Mock).mockResolvedValue([
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
    ]);
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
});
