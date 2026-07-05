import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import PatientPage from "@/app/patient/page";
import { fetchIdentityStatus } from "@/lib/api/identity";
import { fetchPatientMessages, fetchUploadHistoryByMonthWindow } from "@/lib/api/upload-history";
import { getLiffLoginProof } from "@/lib/auth/liff";
import { getPatientSession } from "@/lib/auth/patient-session";

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: jest.fn(),
  }),
}));

jest.mock("@/lib/auth/patient-session", () => ({
  clearPatientSession: jest.fn(),
  getPatientSession: jest.fn(),
}));

jest.mock("@/lib/auth/staff-session", () => ({
  setStaffSession: jest.fn(),
}));

jest.mock("@/components/patient-daily-calendar", () => ({
  PatientDailyCalendar: ({
    onMonthChange,
    overlayLoading,
  }: {
    onMonthChange?: (monthKey: string) => void;
    overlayLoading?: boolean;
  }) => (
    <div>
      <div data-testid="patient-calendar" data-overlay-loading={overlayLoading ? "true" : "false"} />
      <button type="button" onClick={() => onMonthChange?.("2026-02")}>
        change-month
      </button>
      <button type="button" onClick={() => onMonthChange?.("2025-11")}>
        change-month-older
      </button>
    </div>
  ),
}));

jest.mock("@/lib/api/client", () => ({
  getApiErrorDetail: jest.fn(() => null),
}));

jest.mock("@/lib/api/identity", () => ({
  bindIdentity: jest.fn(),
  fetchIdentityStatus: jest.fn(),
}));

jest.mock("@/lib/auth/liff", () => ({
  getLiffLoginProof: jest.fn(),
  buildLoginPath: jest.fn((next?: string) => `/login?next=${encodeURIComponent(next ?? "/patient")}`),
}));

jest.mock("@/lib/api/upload-history", () => ({
  fetchPatientMessages: jest.fn(),
  fetchUploadHistoryByMonthWindow: jest.fn(),
  mergeUploadHistoryDays: jest.fn((previous, incoming) => [...previous, ...incoming]),
}));

describe("PatientPage month window prefetch flow", () => {
  const baseHistoryResponse = {
    status: "matched",
    patient_id: 1,
    can_upload: true,
    days: [],
    summary_28d: {
      all_upload_count_28d: 0,
      suspected_upload_count_28d: 0,
      continuous_upload_streak_days: 0,
    },
  };

  function mockMatchedSession() {
    (getPatientSession as jest.Mock).mockReturnValue({
      accessToken: "token",
      expiresAt: Date.now() + 3600 * 1000,
      role: "patient",
      lineUserId: "line-id",
    });
    (getLiffLoginProof as jest.Mock).mockResolvedValue({
      idToken: "id.token.value",
      profile: { displayName: "Patient A" },
    });
    (fetchPatientMessages as jest.Mock).mockResolvedValue({
      items: [],
      total: 0,
      unread_count: 0,
      limit: 1,
      offset: 0,
    });
  }

  test("loads current month window and progressively prefetches older windows", async () => {
    (fetchIdentityStatus as jest.Mock).mockResolvedValue({ status: "matched" });
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-05-25T08:00:00+08:00"));

    mockMatchedSession();
    let resolvePrefetch: (() => void) | null = null;
    (fetchUploadHistoryByMonthWindow as jest.Mock).mockImplementation((monthEnd: string) => {
      if (monthEnd === "2025-11") {
        return new Promise((resolve) => {
          resolvePrefetch = () => resolve(baseHistoryResponse);
        });
      }
      return Promise.resolve(baseHistoryResponse);
    });

    render(<PatientPage />);

    await waitFor(() => {
      expect(fetchUploadHistoryByMonthWindow).toHaveBeenCalledWith("2026-05");
    });

    fireEvent.click(await screen.findByRole("button", { name: "change-month" }));

    await waitFor(() => {
      expect(fetchUploadHistoryByMonthWindow).toHaveBeenCalledWith("2025-11");
    });

    expect(screen.getByTestId("patient-calendar")).toBeInTheDocument();
    expect(screen.getByTestId("patient-calendar")).toHaveAttribute("data-overlay-loading", "true");

    resolvePrefetch?.();
    await waitFor(() => {
      expect(screen.getByTestId("patient-calendar")).toHaveAttribute("data-overlay-loading", "false");
    });

    jest.useRealTimers();
  });

  test("keeps initial LINE loading state before first history window resolves", async () => {
    (fetchIdentityStatus as jest.Mock).mockResolvedValue({ status: "matched" });
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-05-25T08:00:00+08:00"));

    mockMatchedSession();
    let resolveInitial: (() => void) | null = null;
    (fetchUploadHistoryByMonthWindow as jest.Mock).mockImplementation((monthEnd: string) => {
      if (monthEnd === "2026-05") {
        return new Promise((resolve) => {
          resolveInitial = () => resolve(baseHistoryResponse);
        });
      }
      return Promise.resolve(baseHistoryResponse);
    });

    render(<PatientPage />);

    expect(await screen.findByText("LINE 身分驗證初始化中...")).toBeInTheDocument();
    expect(screen.queryByTestId("patient-calendar")).not.toBeInTheDocument();

    resolveInitial?.();
    await waitFor(() => {
      expect(screen.getByTestId("patient-calendar")).toBeInTheDocument();
    });

    jest.useRealTimers();
  });

  test("keeps calendar mounted across consecutive prefetch windows", async () => {
    (fetchIdentityStatus as jest.Mock).mockResolvedValue({ status: "matched" });
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-05-25T08:00:00+08:00"));

    mockMatchedSession();
    let resolveFirstPrefetch: (() => void) | null = null;
    let resolveSecondPrefetch: (() => void) | null = null;
    (fetchUploadHistoryByMonthWindow as jest.Mock).mockImplementation((monthEnd: string) => {
      if (monthEnd === "2025-11") {
        return new Promise((resolve) => {
          resolveFirstPrefetch = () => resolve(baseHistoryResponse);
        });
      }
      if (monthEnd === "2025-08") {
        return new Promise((resolve) => {
          resolveSecondPrefetch = () => resolve(baseHistoryResponse);
        });
      }
      return Promise.resolve(baseHistoryResponse);
    });

    render(<PatientPage />);

    await waitFor(() => {
      expect(fetchUploadHistoryByMonthWindow).toHaveBeenCalledWith("2026-05");
    });

    fireEvent.click(await screen.findByRole("button", { name: "change-month" }));
    await waitFor(() => {
      expect(fetchUploadHistoryByMonthWindow).toHaveBeenCalledWith("2025-11");
    });
    expect(screen.getByTestId("patient-calendar")).toBeInTheDocument();
    expect(screen.getByTestId("patient-calendar")).toHaveAttribute("data-overlay-loading", "true");

    fireEvent.click(screen.getByRole("button", { name: "change-month-older" }));
    await waitFor(() => {
      expect(fetchUploadHistoryByMonthWindow).toHaveBeenCalledWith("2025-08");
    });
    expect(screen.getByTestId("patient-calendar")).toBeInTheDocument();
    expect(screen.getByTestId("patient-calendar")).toHaveAttribute("data-overlay-loading", "true");

    resolveFirstPrefetch?.();
    await waitFor(() => {
      expect(screen.getByTestId("patient-calendar")).toBeInTheDocument();
      expect(screen.getByTestId("patient-calendar")).toHaveAttribute("data-overlay-loading", "true");
    });

    resolveSecondPrefetch?.();
    await waitFor(() => {
      expect(screen.getByTestId("patient-calendar")).toHaveAttribute("data-overlay-loading", "false");
    });

    jest.useRealTimers();
  });
});
