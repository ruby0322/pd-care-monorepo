import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import AdminPatientAssignmentPage from "@/app/admin/patient-assignment/page";
import {
  fetchAdminAssignments,
  fetchAdminAssignmentsByStaff,
  fetchAdminUsersPage,
  fetchStaffMe,
} from "@/lib/api/staff";

const mockSearchParams = new URLSearchParams();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: jest.fn() }),
  usePathname: () => "/admin/patient-assignment",
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
  fetchAdminAssignments: jest.fn(),
  fetchAdminAssignmentsByStaff: jest.fn(),
  upsertAdminAssignment: jest.fn(),
  unassignAdminAssignment: jest.fn(),
}));

describe("AdminPatientAssignmentPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSearchParams.forEach((_, key) => mockSearchParams.delete(key));
    (fetchStaffMe as jest.Mock).mockResolvedValue({ line_user_id: "U_ADMIN_ASSIGNMENT", role: "admin" });
    (fetchAdminUsersPage as jest.Mock).mockResolvedValue({
      items: [
        {
          id: 11,
          line_user_id: "U_STAFF_ASSIGNMENT",
          display_name: "護理師 A",
          real_name: "Nurse A",
          picture_url: null,
          role: "staff",
          is_active: true,
          patient_id: null,
          created_at: "2026-05-01T00:00:00Z",
        },
        {
          id: 22,
          line_user_id: "U_ADMIN_ASSIGNMENT_TARGET",
          display_name: "管理員 B",
          real_name: "Admin B",
          picture_url: null,
          role: "admin",
          is_active: true,
          patient_id: null,
          created_at: "2026-05-01T00:00:00Z",
        },
      ],
      total: 2,
      limit: 200,
      offset: 0,
    });
    (fetchAdminAssignments as jest.Mock).mockResolvedValue({
      items: [
        {
          patient_id: 201,
          case_number: "P-000201",
          patient_full_name: "池中病患",
          gender: "female",
          picture_url: null,
          staff_identity_id: null,
          staff_line_user_id: null,
          staff_display_name: null,
        },
      ],
      total: 1,
      limit: 200,
      offset: 0,
    });
    (fetchAdminAssignmentsByStaff as jest.Mock).mockResolvedValue({
      items: [
        {
          staff_identity_id: 11,
          assigned_count: 1,
          assigned_patients: [
            {
              patient_id: 101,
              case_number: "P-000101",
              patient_full_name: "王小明",
              gender: "male",
              picture_url: null,
            },
          ],
        },
        {
          staff_identity_id: 22,
          assigned_count: 1,
          assigned_patients: [
            {
              patient_id: 102,
              case_number: "P-000102",
              patient_full_name: "陳小華",
              gender: "female",
              picture_url: null,
            },
          ],
        },
      ],
    });
  });

  test("renders unassigned pool and staff cards with real names", async () => {
    render(<AdminPatientAssignmentPage />);

    expect(await screen.findByRole("heading", { name: "未分配病患" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "可指派人員" })).toBeInTheDocument();
    expect(screen.getByText("Nurse A")).toBeInTheDocument();
    expect(screen.getByText("Admin B")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "未分配病患" })).toBeInTheDocument();
    expect(screen.getByText("池中病患")).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "選擇" })).not.toBeInTheDocument();
  });

  test("loads pool with unassigned filter and binding changes", async () => {
    render(<AdminPatientAssignmentPage />);

    await screen.findByRole("heading", { name: "病患分配" });

    await waitFor(() => {
      expect(fetchAdminAssignments).toHaveBeenCalledWith(
        expect.objectContaining({
          assignmentFilter: "unassigned",
          bindingFilter: "bound",
        })
      );
    });

    fireEvent.change(screen.getByLabelText("註冊狀態"), { target: { value: "unbound_only" } });

    await waitFor(() => {
      expect(fetchAdminAssignments).toHaveBeenCalledWith(
        expect.objectContaining({
          assignmentFilter: "unassigned",
          bindingFilter: "unbound_only",
        })
      );
    });
  });

  test("opens staff sheet with remove actions for assigned patients", async () => {
    render(<AdminPatientAssignmentPage />);

    const staffName = await screen.findByText("Nurse A");
    fireEvent.click(staffName);

    expect(await screen.findByRole("dialog", { name: "Nurse A 詳情" })).toBeInTheDocument();
    expect(screen.getByLabelText("移除病患 P-000101 指派")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "新增病患" })).toBeInTheDocument();
  });
});
