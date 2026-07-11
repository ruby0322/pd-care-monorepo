import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { DragEndEvent } from "@dnd-kit/core";

import AdminPatientAssignmentPage from "@/app/admin/patient-assignment/page";
import {
  fetchAdminAssignments,
  fetchAdminAssignmentsByStaff,
  fetchAdminUsersPage,
  fetchStaffMe,
  unassignAdminAssignment,
  upsertAdminAssignment,
} from "@/lib/api/staff";

const mockSearchParams = new URLSearchParams();
let capturedOnDragEnd: ((event: DragEndEvent) => void) | null = null;

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

jest.mock("@dnd-kit/core", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest mock factory must stay synchronous
  const React = require("react");
  const actual = jest.requireActual("@dnd-kit/core");
  return {
    ...actual,
    DndContext: ({
      children,
      onDragEnd,
    }: {
      children: React.ReactNode;
      onDragEnd: (event: DragEndEvent) => void;
    }) => {
      capturedOnDragEnd = onDragEnd;
      return React.createElement("div", { "data-testid": "dnd-context" }, children);
    },
  };
});

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
    capturedOnDragEnd = null;
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
    (upsertAdminAssignment as jest.Mock).mockResolvedValue({});
    (unassignAdminAssignment as jest.Mock).mockResolvedValue({});
  });

  test("renders unassigned pool and staff cards with real names", async () => {
    render(<AdminPatientAssignmentPage />);

    expect(await screen.findByRole("heading", { name: "未分配病患" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "可指派人員" })).toBeInTheDocument();
    expect(await screen.findByText("Nurse A")).toBeInTheDocument();
    expect(await screen.findByText("Admin B")).toBeInTheDocument();
    expect(await screen.findByText("池中病患")).toBeInTheDocument();
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

  test("assigns patient on drag end to staff", async () => {
    render(<AdminPatientAssignmentPage />);

    await screen.findByText("池中病患");
    expect(capturedOnDragEnd).not.toBeNull();

    await act(async () => {
      capturedOnDragEnd?.({
        active: {
          data: {
            current: {
              patientId: 201,
              fromStaffId: null,
              caseNumber: "P-000201",
              fullName: "池中病患",
            },
          },
        },
        over: {
          data: {
            current: {
              type: "staff",
              staffId: 11,
            },
          },
        },
      } as DragEndEvent);
    });

    await waitFor(() => {
      expect(upsertAdminAssignment).toHaveBeenCalledWith({
        patient_id: 201,
        staff_identity_id: 11,
      });
    });
  });

  test("opens unassign confirm on drag end to pool", async () => {
    render(<AdminPatientAssignmentPage />);

    await screen.findByText("王小明");
    expect(capturedOnDragEnd).not.toBeNull();

    await act(async () => {
      capturedOnDragEnd?.({
        active: {
          data: {
            current: {
              patientId: 101,
              fromStaffId: 11,
              caseNumber: "P-000101",
              fullName: "王小明",
            },
          },
        },
        over: {
          data: {
            current: {
              type: "pool",
            },
          },
        },
      } as DragEndEvent);
    });

    expect(await screen.findByRole("dialog", { name: "確認移除指派" })).toBeInTheDocument();
    expect(unassignAdminAssignment).not.toHaveBeenCalled();
  });

  test("loads more unassigned patients when truncated", async () => {
    (fetchAdminAssignments as jest.Mock)
      .mockResolvedValueOnce({
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
        total: 3,
        limit: 200,
        offset: 0,
      })
      .mockResolvedValueOnce({
        items: [
          {
            patient_id: 202,
            case_number: "P-000202",
            patient_full_name: "第二位病患",
            gender: "male",
            picture_url: null,
            staff_identity_id: null,
            staff_line_user_id: null,
            staff_display_name: null,
          },
        ],
        total: 3,
        limit: 200,
        offset: 1,
      });

    render(<AdminPatientAssignmentPage />);

    expect(await screen.findByText("顯示 1 / 3 位未分配病患")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "載入更多" }));

    await waitFor(() => {
      expect(fetchAdminAssignments).toHaveBeenLastCalledWith(
        expect.objectContaining({
          assignmentFilter: "unassigned",
          offset: 1,
        })
      );
    });
    expect(await screen.findByText("第二位病患")).toBeInTheDocument();
  });
});
