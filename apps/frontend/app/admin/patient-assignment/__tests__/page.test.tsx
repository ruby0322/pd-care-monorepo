import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import AdminPatientAssignmentPage from "@/app/admin/patient-assignment/page";
import {
  fetchAdminAssignments,
  fetchAdminAssignmentsByStaff,
  fetchAdminUsersPage,
  fetchStaffMe,
} from "@/lib/api/staff";

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
  bulkUpsertAdminAssignments: jest.fn(),
  unassignAdminAssignment: jest.fn(),
}));

describe("AdminPatientAssignmentPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fetchStaffMe as jest.Mock).mockResolvedValue({ line_user_id: "U_ADMIN_ASSIGNMENT", role: "admin" });
    (fetchAdminUsersPage as jest.Mock).mockResolvedValue({
      items: [
        {
          id: 11,
          line_user_id: "U_STAFF_ASSIGNMENT",
          display_name: "護理師 A",
          real_name: "Nurse A",
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
          role: "admin",
          is_active: true,
          patient_id: null,
          created_at: "2026-05-01T00:00:00Z",
        },
      ],
      total: 2,
      limit: 10,
      offset: 0,
    });
    (fetchAdminAssignments as jest.Mock).mockResolvedValue({
      items: [
        {
          patient_id: 101,
          case_number: "P-000101",
          patient_full_name: "王小明",
          staff_identity_id: 11,
          staff_line_user_id: "U_STAFF_ASSIGNMENT",
          staff_display_name: "護理師 A",
        },
      ],
      total: 1,
      limit: 10,
      offset: 0,
    });
    (fetchAdminAssignmentsByStaff as jest.Mock).mockResolvedValue({
      items: [
        {
          staff_identity_id: 11,
          assigned_count: 1,
          assigned_patients: [{ patient_id: 101, case_number: "P-000101", patient_full_name: "王小明" }],
        },
        {
          staff_identity_id: 22,
          assigned_count: 1,
          assigned_patients: [{ patient_id: 102, case_number: "P-000102", patient_full_name: "陳小華" }],
        },
      ],
    });
  });

  test("shows assignee user list and pagination controls at top", async () => {
    render(<AdminPatientAssignmentPage />);

    expect(await screen.findByRole("heading", { name: "可指派人員" })).toBeInTheDocument();
    expect((await screen.findAllByText("護理師 A")).length).toBeGreaterThan(0);
    const userSection = screen.getByRole("heading", { name: "可指派人員" }).closest("section");
    expect(userSection).not.toBeNull();
    const userScope = within(userSection as HTMLElement);
    expect(
      userScope.getByText((content) => content.replace(/\s+/g, " ").includes("顯示 1-2 / 2 位人員"))
    ).toBeInTheDocument();
    expect(userScope.getByRole("button", { name: "上一頁" })).toBeDisabled();
    expect(userScope.getByRole("button", { name: "下一頁" })).toBeDisabled();
  });

  test("provides patient filters for assignment, role, active status and sends them to API", async () => {
    render(<AdminPatientAssignmentPage />);

    await screen.findByRole("heading", { name: "病患分配" });

    fireEvent.change(screen.getByLabelText("分配狀態"), { target: { value: "assigned" } });
    fireEvent.change(screen.getByLabelText("人員角色"), { target: { value: "staff" } });
    fireEvent.change(screen.getByLabelText("人員狀態"), { target: { value: "inactive" } });

    await waitFor(() => {
      expect(fetchAdminAssignments).toHaveBeenLastCalledWith(
        expect.objectContaining({
          assignmentFilter: "assigned",
          assigneeRole: "staff",
          assigneeActive: "inactive",
        })
      );
    });
  });

  test("keeps removable assigned-patient tags for both staff and admin rows", async () => {
    render(<AdminPatientAssignmentPage />);

    expect(await screen.findByLabelText("移除病患 P-000101 指派")).toBeInTheDocument();
    expect(screen.getByLabelText("移除病患 P-000102 指派")).toBeInTheDocument();
  });
});
