import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import PatientPage from "@/app/patient/page";
import { apiClient } from "@/lib/api/client";
import { fetchIdentityStatus } from "@/lib/api/identity";
import { fetchPatientMessages, fetchUploadHistoryByMonthWindow } from "@/lib/api/upload-history";
import { getLiffLoginProof } from "@/lib/auth/liff";

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: jest.fn(),
  }),
}));

jest.mock("@/lib/auth/patient-session", () => ({
  clearPatientSession: jest.fn(),
  getPatientSession: jest.fn(),
  setPatientSession: jest.fn(),
}));

jest.mock("@/lib/auth/staff-session", () => ({
  setStaffSession: jest.fn(),
}));

jest.mock("@/components/patient-daily-calendar", () => ({
  PatientDailyCalendar: ({ onMonthChange }: { onMonthChange?: (monthKey: string) => void }) => (
    <div>
      <button type="button" onClick={() => onMonthChange?.("2026-02")}>
        change-month
      </button>
    </div>
  ),
}));

jest.mock("@/lib/api/client", () => ({
  apiClient: {
    post: jest.fn(),
  },
  getApiErrorDetail: jest.fn(() => null),
}));

jest.mock("@/lib/api/identity", () => ({
  bindIdentity: jest.fn(),
  fetchIdentityStatus: jest.fn(),
}));

jest.mock("@/lib/auth/liff", () => ({
  getLiffLoginProof: jest.fn(),
}));

jest.mock("@/lib/api/upload-history", () => ({
  fetchPatientMessages: jest.fn(),
  fetchUploadHistoryByMonthWindow: jest.fn(),
  mergeUploadHistoryDays: jest.fn((previous, incoming) => [...previous, ...incoming]),
}));

describe("PatientPage month window prefetch flow", () => {
  test("loads current month window and progressively prefetches older windows", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-05-25T08:00:00+08:00"));

    const fakeTokenPayload = { exp: Math.floor(Date.now() / 1000) + 3600 };
    const idToken = `header.${btoa(JSON.stringify(fakeTokenPayload))}.signature`;

    (getLiffLoginProof as jest.Mock).mockResolvedValue({
      idToken,
      profile: { displayName: "Patient A" },
    });
    (fetchIdentityStatus as jest.Mock).mockResolvedValue({ status: "matched" });
    (apiClient.post as jest.Mock).mockResolvedValue({
      data: {
        access_token: "token",
        expires_in: 3600,
        role: "patient",
        line_user_id: "line-id",
      },
    });
    (fetchUploadHistoryByMonthWindow as jest.Mock).mockResolvedValue({
      status: "matched",
      patient_id: 1,
      can_upload: true,
      days: [],
      summary_28d: {
        all_upload_count_28d: 0,
        suspected_upload_count_28d: 0,
        continuous_upload_streak_days: 0,
      },
    });
    (fetchPatientMessages as jest.Mock).mockResolvedValue({
      items: [],
      total: 0,
      unread_count: 0,
      limit: 1,
      offset: 0,
    });

    render(<PatientPage />);

    await waitFor(() => {
      expect(fetchUploadHistoryByMonthWindow).toHaveBeenCalledWith("2026-05");
    });

    fireEvent.click(await screen.findByRole("button", { name: "change-month" }));

    await waitFor(() => {
      expect(fetchUploadHistoryByMonthWindow).toHaveBeenCalledWith("2025-11");
    });

    jest.useRealTimers();
  });
});
