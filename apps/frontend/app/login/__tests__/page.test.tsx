import { AxiosError } from "axios";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import LoginPage from "@/app/login/page";
import { apiClient, getApiErrorDetail } from "@/lib/api/client";
import { fetchIdentityStatus } from "@/lib/api/identity";
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
  getApiErrorDetail: jest.fn(() => null),
}));

jest.mock("@/lib/api/identity", () => ({
  createHealthcareAccessRequest: jest.fn(),
  fetchIdentityStatus: jest.fn(),
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
  function mockForbiddenLoginError() {
    return new AxiosError("Forbidden", undefined, undefined, undefined, {
      status: 403,
      data: {},
      statusText: "Forbidden",
      headers: {},
      config: {},
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    (getApiErrorDetail as jest.Mock).mockReturnValue(null);
    mockSearchParams.delete("next");
    (getLiffLoginProof as jest.Mock).mockResolvedValue({
      idToken: "id.token.value",
      profile: { displayName: "Tester" },
    });
  });

  it("routes staff to requested admin page", async () => {
    mockSearchParams.set("next", "/admin/patients");
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
      expect(setStaffSession).toHaveBeenCalledWith(
        expect.objectContaining({
          accessToken: "staff-token",
          role: "staff",
          lineUserId: "line-staff",
        })
      );
      expect(setPatientSession).not.toHaveBeenCalled();
      expect(mockReplace).toHaveBeenCalledWith("/admin/patients");
    });
  });

  it("stores both sessions when staff opens patient entry with matched identity", async () => {
    mockSearchParams.set("next", "/patient");
    (apiClient.post as jest.Mock).mockResolvedValue({
      data: {
        access_token: "staff-token",
        expires_in: 3600,
        role: "staff",
        line_user_id: "line-staff",
      },
    });
    (fetchIdentityStatus as jest.Mock).mockResolvedValue({ status: "matched" });

    render(<LoginPage />);

    await waitFor(() => {
      expect(setStaffSession).toHaveBeenCalledWith(
        expect.objectContaining({
          accessToken: "staff-token",
          role: "staff",
          lineUserId: "line-staff",
        })
      );
      expect(setPatientSession).toHaveBeenCalledWith(
        expect.objectContaining({
          accessToken: "staff-token",
          role: "staff",
          lineUserId: "line-staff",
        })
      );
      expect(mockReplace).toHaveBeenCalledWith("/patient");
    });
  });

  it("routes patient to patient page and stores session when matched", async () => {
    mockSearchParams.set("next", "/patient");
    (apiClient.post as jest.Mock).mockResolvedValue({
      data: {
        access_token: "patient-token",
        expires_in: 3600,
        role: "patient",
        line_user_id: "line-patient",
      },
    });
    (fetchIdentityStatus as jest.Mock).mockResolvedValue({ status: "matched" });

    render(<LoginPage />);

    await waitFor(() => {
      expect(setPatientSession).toHaveBeenCalledWith(
        expect.objectContaining({
          accessToken: "patient-token",
          role: "patient",
          lineUserId: "line-patient",
        })
      );
      expect(mockReplace).toHaveBeenCalledWith("/patient");
    });
  });

  it("redirects staff-intent patient login to no-permission request flow", async () => {
    mockSearchParams.set("next", "/admin");
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
      expect(mockReplace).toHaveBeenCalledWith("/no-permission?next=%2Fadmin");
    });
    expect(setPatientSession).not.toHaveBeenCalled();
    expect(setStaffSession).not.toHaveBeenCalled();
  });

  it("falls back patient login to /patient when next is /apps", async () => {
    mockSearchParams.set("next", "/apps");
    (apiClient.post as jest.Mock).mockResolvedValue({
      data: {
        access_token: "patient-token",
        expires_in: 3600,
        role: "patient",
        line_user_id: "line-patient",
      },
    });
    (fetchIdentityStatus as jest.Mock).mockResolvedValue({ status: "pending" });

    render(<LoginPage />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/patient");
    });
    expect(setPatientSession).not.toHaveBeenCalled();
    expect(setStaffSession).not.toHaveBeenCalled();
  });

  it("stores both sessions when admin opens nested patient route with matched identity", async () => {
    mockSearchParams.set("next", "/patient/capture");
    (apiClient.post as jest.Mock).mockResolvedValue({
      data: {
        access_token: "admin-token",
        expires_in: 3600,
        role: "admin",
        line_user_id: "line-admin",
      },
    });
    (fetchIdentityStatus as jest.Mock).mockResolvedValue({ status: "matched" });

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
      expect(mockReplace).toHaveBeenCalledWith("/patient/capture");
    });
  });

  it("stores only staff session when staff opens patient entry without matched identity", async () => {
    mockSearchParams.set("next", "/patient");
    (apiClient.post as jest.Mock).mockResolvedValue({
      data: {
        access_token: "staff-token",
        expires_in: 3600,
        role: "staff",
        line_user_id: "line-staff",
      },
    });
    (fetchIdentityStatus as jest.Mock).mockResolvedValue({ status: "pending" });

    render(<LoginPage />);

    await waitFor(() => {
      expect(setStaffSession).toHaveBeenCalled();
      expect(setPatientSession).not.toHaveBeenCalled();
      expect(mockReplace).toHaveBeenCalledWith("/patient");
    });
  });

  it("redirects unmatched patient without storing patient session", async () => {
    (apiClient.post as jest.Mock).mockResolvedValue({
      data: {
        access_token: "patient-token",
        expires_in: 3600,
        role: "patient",
        line_user_id: "line-patient",
      },
    });
    (fetchIdentityStatus as jest.Mock).mockResolvedValue({ status: "pending" });

    render(<LoginPage />);

    await waitFor(() => {
      expect(setPatientSession).not.toHaveBeenCalled();
      expect(mockReplace).toHaveBeenCalledWith("/patient");
    });
  });

  it("shows an error when automatic login fails on mount", async () => {
    mockSearchParams.set("next", "/patient");
    (apiClient.post as jest.Mock).mockRejectedValue(mockForbiddenLoginError());

    render(<LoginPage />);

    await waitFor(() => {
      expect(screen.getByText("此 LINE 帳號沒有系統權限，請聯絡系統管理員開通。")).toBeInTheDocument();
    });
    expect(mockReplace).not.toHaveBeenCalled();
    expect(setPatientSession).not.toHaveBeenCalled();
    expect(setStaffSession).not.toHaveBeenCalled();
  });

  it("routes staff to app selection when next is absent", async () => {
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

  it("redirects bare login permission errors back home", async () => {
    (apiClient.post as jest.Mock).mockRejectedValue(mockForbiddenLoginError());

    render(<LoginPage />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/");
    });
    expect(setPatientSession).not.toHaveBeenCalled();
    expect(setStaffSession).not.toHaveBeenCalled();
  });

  it("redirects to no-permission when staff/admin-targeted login hits permission error", async () => {
    mockSearchParams.set("next", "/admin");
    (apiClient.post as jest.Mock).mockRejectedValue(mockForbiddenLoginError());

    render(<LoginPage />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/no-permission?next=%2Fadmin");
    });
    expect(setPatientSession).not.toHaveBeenCalled();
    expect(setStaffSession).not.toHaveBeenCalled();
  });

  it("retries login manually after an automatic login failure", async () => {
    mockSearchParams.set("next", "/patient");
    (apiClient.post as jest.Mock)
      .mockRejectedValueOnce(mockForbiddenLoginError())
      .mockResolvedValueOnce({
        data: {
          access_token: "patient-token",
          expires_in: 3600,
          role: "patient",
          line_user_id: "line-patient",
        },
      });
    (fetchIdentityStatus as jest.Mock).mockResolvedValue({ status: "matched" });

    render(<LoginPage />);

    await waitFor(() => {
      expect(screen.getByText("此 LINE 帳號沒有系統權限，請聯絡系統管理員開通。")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "使用 LINE 登入" }));

    await waitFor(() => {
      expect(setPatientSession).toHaveBeenCalledWith(
        expect.objectContaining({
          accessToken: "patient-token",
          role: "patient",
          lineUserId: "line-patient",
        })
      );
      expect(mockReplace).toHaveBeenCalledWith("/patient");
    });
    expect(apiClient.post).toHaveBeenCalled();
    expect((apiClient.post as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("maps backend permission errors to a user-facing message", async () => {
    mockSearchParams.set("next", "/patient");
    (getApiErrorDetail as jest.Mock).mockReturnValue("尚未開通此角色");
    (apiClient.post as jest.Mock).mockRejectedValue(new Error("尚未開通此角色"));

    render(<LoginPage />);

    await waitFor(() => {
      expect(screen.getByText("此 LINE 帳號尚未開通對應權限，請聯絡系統管理員。")).toBeInTheDocument();
    });
  });
});
