import { render, waitFor } from "@testing-library/react";

import LoginPage from "@/app/login/page";
import { apiClient } from "@/lib/api/client";
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
  beforeEach(() => {
    jest.clearAllMocks();
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
      expect(mockReplace).toHaveBeenCalledWith("/admin/patients");
    });
  });

  it("routes patient to patient page and stores session when matched", async () => {
    mockSearchParams.set("next", "/admin");
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
});
