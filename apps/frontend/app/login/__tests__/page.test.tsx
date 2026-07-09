import { AxiosError } from "axios";
import { render, screen, waitFor } from "@testing-library/react";

import LoginPage from "@/app/login/page";
import { apiClient, getApiErrorCode, getApiErrorDetail } from "@/lib/api/client";
import { fetchAuthBootstrap } from "@/lib/api/identity";
import { getLiffLoginProof } from "@/lib/auth/liff";
import { setPatientSession } from "@/lib/auth/patient-session";
import { setStaffSession } from "@/lib/auth/staff-session";

const mockReplace = jest.fn();
const mockRefresh = jest.fn();
const mockSearchParams = new URLSearchParams();

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: mockReplace,
    refresh: mockRefresh,
  }),
  useSearchParams: () => mockSearchParams,
}));

jest.mock("@/lib/api/client", () => ({
  apiClient: {
    post: jest.fn(),
  },
  getApiErrorCode: jest.fn(() => null),
  getApiErrorDetail: jest.fn(() => null),
}));

jest.mock("@/lib/api/identity", () => ({
  fetchAuthBootstrap: jest.fn(),
}));

jest.mock("@/lib/auth/liff", () => ({
  getLiffLoginProof: jest.fn(),
  readSafeNextPath: jest.fn((value: string | null) => value),
}));

jest.mock("@/lib/auth/patient-session", () => ({
  setPatientSession: jest.fn(),
}));

jest.mock("@/lib/auth/staff-session", () => ({
  setStaffSession: jest.fn(),
}));

describe("LoginPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getApiErrorCode as jest.Mock).mockReturnValue(null);
    (getApiErrorDetail as jest.Mock).mockReturnValue(null);
    mockSearchParams.delete("next");
    (getLiffLoginProof as jest.Mock).mockResolvedValue({
      idToken: "id.token.value",
      profile: { displayName: "Tester" },
    });
  });

  it("routes new patient-intent users to patient onboarding", async () => {
    mockSearchParams.set("next", "/patient");
    (fetchAuthBootstrap as jest.Mock).mockResolvedValue({
      next_step: "role_select",
    });

    render(<LoginPage />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/onboarding/patient");
    });
  });

  it("routes new admin-intent users to admin onboarding", async () => {
    mockSearchParams.set("next", "/apps");
    (fetchAuthBootstrap as jest.Mock).mockResolvedValue({
      next_step: "role_select",
    });

    render(<LoginPage />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/onboarding/admin");
    });
  });

  it("routes pending admin permission state to admin onboarding", async () => {
    (fetchAuthBootstrap as jest.Mock).mockResolvedValue({
      next_step: "onboarding_admin",
    });

    render(<LoginPage />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/onboarding/admin");
    });
  });

  it("routes returning pending patients to patient onboarding", async () => {
    (fetchAuthBootstrap as jest.Mock).mockResolvedValue({
      next_step: "onboarding_patient",
    });

    render(<LoginPage />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/onboarding/patient");
    });
  });

  it("stores staff session and redirects to apps for app-selection step", async () => {
    (fetchAuthBootstrap as jest.Mock).mockResolvedValue({
      next_step: "app_selection",
      allowed_apps: ["admin"],
    });
    (apiClient.post as jest.Mock).mockResolvedValue({
      data: {
        access_token: "staff-token",
        expires_in: 3600,
        role: "staff",
        line_user_id: "line-staff",
      },
    });

    render(<LoginPage />);

    await waitFor(() => {
      expect(setStaffSession).toHaveBeenCalled();
      expect(mockReplace).toHaveBeenCalledWith("/apps");
    });
  });

  it("stores both sessions when app-selection allows patient app", async () => {
    (fetchAuthBootstrap as jest.Mock).mockResolvedValue({
      next_step: "app_selection",
      allowed_apps: ["admin", "patient"],
    });
    (apiClient.post as jest.Mock).mockResolvedValue({
      data: {
        access_token: "admin-token",
        expires_in: 3600,
        role: "admin",
        line_user_id: "line-admin",
      },
    });

    render(<LoginPage />);

    await waitFor(() => {
      expect(setStaffSession).toHaveBeenCalledWith(
        expect.objectContaining({
          accessToken: "admin-token",
          role: "admin",
          lineUserId: "line-admin",
        })
      );
      expect(setPatientSession).toHaveBeenCalledWith(
        expect.objectContaining({
          accessToken: "admin-token",
          role: "admin",
          lineUserId: "line-admin",
        })
      );
      expect(mockReplace).toHaveBeenCalledWith("/apps");
    });
  });

  it("stores patient session and redirects to patient app", async () => {
    mockSearchParams.set("next", "/patient/capture");
    (fetchAuthBootstrap as jest.Mock).mockResolvedValue({
      next_step: "patient_app",
      allowed_apps: ["patient"],
    });
    (apiClient.post as jest.Mock).mockResolvedValue({
      data: {
        access_token: "patient-token",
        expires_in: 3600,
        role: "patient",
        line_user_id: "line-patient",
      },
    });

    render(<LoginPage />);

    await waitFor(() => {
      expect(setPatientSession).toHaveBeenCalledWith(
        expect.objectContaining({
          accessToken: "patient-token",
          role: "patient",
          lineUserId: "line-patient",
        })
      );
      expect(mockReplace).toHaveBeenCalledWith("/patient/capture");
    });
  });

  it("shows an error when bootstrap fails", async () => {
    (fetchAuthBootstrap as jest.Mock).mockRejectedValue(
      new AxiosError("Forbidden", undefined, undefined, undefined, {
        status: 403,
        data: {},
        statusText: "Forbidden",
        headers: {},
        config: {},
      })
    );

    render(<LoginPage />);

    await waitFor(() => {
      expect(screen.getByText("此 LINE 帳號沒有系統權限，請聯絡系統管理員開通。")).toBeInTheDocument();
    });
  });
});
