import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";

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

const mockReplace = jest.fn((href: string) => {
  const queryIndex = href.indexOf("?");
  const query = queryIndex >= 0 ? href.slice(queryIndex + 1) : "";
  mockSearchParams.forEach((_, key) => mockSearchParams.delete(key));
  new URLSearchParams(query).forEach((value, key) => mockSearchParams.set(key, value));
});

const mediaQueries = new Map<string, { matches: boolean; listeners: Set<(event: MediaQueryListEvent) => void> }>();

function setMediaQueryMatches(matches: Record<string, boolean>) {
  for (const [query, queryMatches] of Object.entries(matches)) {
    const mediaQuery = mediaQueries.get(query) ?? { matches: false, listeners: new Set() };
    mediaQuery.matches = queryMatches;
    mediaQueries.set(query, mediaQuery);
    for (const listener of mediaQuery.listeners) {
      listener({ matches: queryMatches, media: query } as MediaQueryListEvent);
    }
  }
}

function rerenderAssignmentPage(view: ReturnType<typeof render>) {
  view.rerender(<AdminPatientAssignmentPage />);
}

let capturedOnDragEnd: ((event: DragEndEvent) => void) | null = null;
let capturedOnDragStart: ((event: DragStartEvent) => void) | null = null;
let capturedOnDragCancel: (() => void) | null = null;

function queryDragBackdrop() {
  return document.querySelector(".pointer-events-none.fixed.inset-0.z-30");
}

function getPoolSection() {
  return screen.getByRole("heading", { name: "未分配病患" }).closest("section");
}

function getStaffCard(title: string) {
  return screen.getByText(title).closest("article");
}

const dragStartEvent = {
  active: {
    data: {
      current: {
        patientId: 201,
        fromStaffId: null,
        caseNumber: "P-000201",
        fullName: "池中病患",
        gender: "female",
      },
    },
  },
} as DragStartEvent;

jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
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
      onDragStart,
      onDragCancel,
    }: {
      children: React.ReactNode;
      onDragEnd: (event: DragEndEvent) => void;
      onDragStart?: (event: DragStartEvent) => void;
      onDragCancel?: () => void;
    }) => {
      capturedOnDragEnd = onDragEnd;
      capturedOnDragStart = onDragStart ?? null;
      capturedOnDragCancel = onDragCancel ?? null;
      return React.createElement("div", { "data-testid": "dnd-context" }, children);
    },
    DragOverlay: ({ children }: { children: React.ReactNode }) =>
      children ? React.createElement("div", { "data-testid": "drag-overlay-portal" }, children) : null,
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
    capturedOnDragStart = null;
    capturedOnDragCancel = null;
    mockSearchParams.forEach((_, key) => mockSearchParams.delete(key));
    mediaQueries.clear();
    mediaQueries.set("(min-width: 1280px)", { matches: true, listeners: new Set() });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => {
        const mediaQuery = mediaQueries.get(query) ?? { matches: false, listeners: new Set() };
        mediaQueries.set(query, mediaQuery);
        return {
          get matches() {
            return mediaQuery.matches;
          },
          media: query,
          addEventListener: (_event: string, listener: (event: MediaQueryListEvent) => void) => mediaQuery.listeners.add(listener),
          removeEventListener: (_event: string, listener: (event: MediaQueryListEvent) => void) =>
            mediaQuery.listeners.delete(listener),
        };
      },
    });
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
      limit: 12,
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
      limit: 100,
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
    const view = render(<AdminPatientAssignmentPage />);

    await screen.findByRole("heading", { name: "病患分配" });

    await waitFor(() => {
      expect(fetchAdminAssignments).toHaveBeenCalledWith(
        expect.objectContaining({
          assignmentFilter: "unassigned",
          bindingFilter: "bound",
          excludeStaffAdminPatients: false,
          limit: 12,
        })
      );
    });

    fireEvent.change(screen.getByLabelText("註冊狀態"), { target: { value: "unbound_only" } });
    rerenderAssignmentPage(view);

    await waitFor(() => {
      expect(fetchAdminAssignments).toHaveBeenCalledWith(
        expect.objectContaining({
          assignmentFilter: "unassigned",
          bindingFilter: "unbound_only",
          limit: 12,
        })
      );
    });

    fireEvent.change(screen.getByLabelText("人員身分病患"), { target: { value: "exclude" } });
    rerenderAssignmentPage(view);

    await waitFor(() => {
      expect(fetchAdminAssignments).toHaveBeenCalledWith(
        expect.objectContaining({
          excludeStaffAdminPatients: true,
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

  test("shows drag backdrop and elevates drop targets while dragging", async () => {
    render(<AdminPatientAssignmentPage />);

    await screen.findByText("池中病患");
    expect(capturedOnDragStart).not.toBeNull();
    expect(queryDragBackdrop()).toBeNull();
    expect(screen.queryByTestId("patient-drag-overlay")).not.toBeInTheDocument();
    expect(getPoolSection()).not.toHaveClass("z-40");
    expect(getStaffCard("Nurse A")).not.toHaveClass("z-40");

    await act(async () => {
      capturedOnDragStart?.(dragStartEvent);
    });

    expect(queryDragBackdrop()).toBeInTheDocument();
    expect(screen.getByTestId("patient-drag-overlay")).toHaveTextContent("池中病患");
    expect(getPoolSection()).toHaveClass("z-40");
    expect(getStaffCard("Nurse A")).toHaveClass("z-40");
  });

  test("clears drag backdrop and elevation on drag end", async () => {
    render(<AdminPatientAssignmentPage />);

    await screen.findByText("池中病患");
    await act(async () => {
      capturedOnDragStart?.(dragStartEvent);
    });
    expect(queryDragBackdrop()).toBeInTheDocument();

    await act(async () => {
      capturedOnDragEnd?.({
        active: dragStartEvent.active,
        over: null,
      } as DragEndEvent);
    });

    expect(queryDragBackdrop()).toBeNull();
    expect(screen.queryByTestId("patient-drag-overlay")).not.toBeInTheDocument();
    expect(getPoolSection()).not.toHaveClass("z-40");
    expect(getStaffCard("Nurse A")).not.toHaveClass("z-40");
  });

  test("clears drag overlay on drag cancel", async () => {
    render(<AdminPatientAssignmentPage />);

    await screen.findByText("池中病患");
    await act(async () => {
      capturedOnDragStart?.(dragStartEvent);
    });
    expect(queryDragBackdrop()).toBeInTheDocument();

    await act(async () => {
      capturedOnDragCancel?.();
    });

    expect(queryDragBackdrop()).toBeNull();
    expect(screen.queryByTestId("patient-drag-overlay")).not.toBeInTheDocument();
    expect(getPoolSection()).not.toHaveClass("z-40");
    expect(getStaffCard("Nurse A")).not.toHaveClass("z-40");
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

  test("paginates unassigned patients", async () => {
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
        total: 13,
        limit: 12,
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
        total: 13,
        limit: 12,
        offset: 12,
      });

    const view = render(<AdminPatientAssignmentPage />);

    expect(await screen.findByText("顯示 1-12 / 13 位未分配病患")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "未分配病患下一頁" }));
    rerenderAssignmentPage(view);

    await waitFor(() => {
      expect(fetchAdminAssignments).toHaveBeenLastCalledWith(
        expect.objectContaining({
          assignmentFilter: "unassigned",
          offset: 12,
        })
      );
    });
    expect(await screen.findByText("第二位病患")).toBeInTheDocument();
  });

  test("resets the pool page when a breakpoint changes the page size", async () => {
    mockSearchParams.set("poolPage", "2");
    setMediaQueryMatches({ "(min-width: 1280px)": true });
    (fetchAdminAssignments as jest.Mock).mockResolvedValue({
      items: [],
      total: 24,
      limit: 12,
      offset: 12,
    });

    const view = render(<AdminPatientAssignmentPage />);

    await waitFor(() => {
      expect(fetchAdminAssignments).toHaveBeenCalledWith(expect.objectContaining({ limit: 12, offset: 12 }));
    });
    mockReplace.mockClear();

    await act(async () => {
      setMediaQueryMatches({
        "(min-width: 1280px)": false,
        "(min-width: 1024px)": false,
        "(min-width: 768px)": false,
        "(min-width: 640px)": false,
      });
    });

    await waitFor(() => expect(mockSearchParams.get("poolPage")).toBeNull());
    rerenderAssignmentPage(view);
    await waitFor(() => {
      expect(fetchAdminAssignments).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 3, offset: 0 }));
    });
  });

  test("searches staff list", async () => {
    (fetchAdminUsersPage as jest.Mock).mockImplementation(async (params) => {
      if (params?.query === "Nurse") {
        return {
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
          ],
          total: 1,
          limit: 12,
          offset: 0,
        };
      }
      return {
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
        limit: 12,
        offset: params?.offset ?? 0,
      };
    });

    const view = render(<AdminPatientAssignmentPage />);
    await screen.findByText("Nurse A");

    const staffSearchInput = screen.getByLabelText("搜尋可指派人員");
    fireEvent.change(staffSearchInput, { target: { value: "Nurse" } });
    fireEvent.submit(staffSearchInput.closest("form")!);
    rerenderAssignmentPage(view);

    await waitFor(() => {
      expect(fetchAdminUsersPage).toHaveBeenCalledWith(
        expect.objectContaining({
          query: "Nurse",
          isActive: true,
          limit: 12,
          offset: 0,
        })
      );
    });
  });

  test("requests staff ordered by assigned patient count when selected", async () => {
    mockSearchParams.set("staffSort", "assigned_count_desc");
    render(<AdminPatientAssignmentPage />);

    await waitFor(() => {
      expect(fetchAdminUsersPage).toHaveBeenCalledWith(
        expect.objectContaining({
          sort: "assigned_count_desc",
        })
      );
    });
  });

  test("paginates staff list", async () => {
    (fetchAdminUsersPage as jest.Mock).mockImplementation(async (params) => {
      if (params?.offset === 12) {
        return {
          items: [
            {
              id: 33,
              line_user_id: "U_STAFF_PAGE2",
              display_name: "護理師 C",
              real_name: "Nurse C",
              picture_url: null,
              role: "staff",
              is_active: true,
              patient_id: null,
              created_at: "2026-05-01T00:00:00Z",
            },
          ],
          total: 13,
          limit: 12,
          offset: 12,
        };
      }
      return {
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
        ],
        total: 13,
        limit: 12,
        offset: 0,
      };
    });

    (fetchAdminAssignmentsByStaff as jest.Mock).mockImplementation(async ({ staffIdentityIds }) => {
      if (staffIdentityIds.includes(33)) {
        return {
          items: [
            {
              staff_identity_id: 33,
              assigned_count: 0,
              assigned_patients: [],
            },
          ],
        };
      }
      return {
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
        ],
      };
    });

    const view = render(<AdminPatientAssignmentPage />);

    await screen.findByText("Nurse A");
    expect(screen.getByText(/顯示 1-1 \/ 13 位人員/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "下一頁" }));
    rerenderAssignmentPage(view);

    await waitFor(() => {
      expect(fetchAdminUsersPage).toHaveBeenCalledWith(
        expect.objectContaining({
          isActive: true,
          limit: 12,
          offset: 12,
        })
      );
    });
    expect(await screen.findByText("Nurse C")).toBeInTheDocument();
  });
});
