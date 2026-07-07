import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import NoPermissionPage from "@/app/no-permission/page";
import {
  createHealthcareAccessRequest,
  fetchHealthcareAccessRequestStatus,
} from "@/lib/api/identity";
import { buildLoginPath, getLiffLoginProof, readSafeNextPath } from "@/lib/auth/liff";

const mockSearchParams = new URLSearchParams();

jest.mock("next/navigation", () => ({
  useSearchParams: () => mockSearchParams,
}));

jest.mock("@/lib/auth/liff", () => ({
  getLiffLoginProof: jest.fn(),
  readSafeNextPath: jest.fn((value: string | null) => value),
  buildLoginPath: jest.fn((next: string) => `/login?next=${encodeURIComponent(next)}`),
}));

jest.mock("@/lib/api/identity", () => ({
  createHealthcareAccessRequest: jest.fn(),
  fetchHealthcareAccessRequestStatus: jest.fn(),
}));

describe("NoPermissionPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSearchParams.delete("next");
    (getLiffLoginProof as jest.Mock).mockResolvedValue({
      idToken: "token",
      profile: { displayName: "Nurse" },
    });
    (fetchHealthcareAccessRequestStatus as jest.Mock).mockResolvedValue({
      status: "none",
      reject_reason: null,
      decision_role: null,
    });
  });

  it("shows pending state when request is already under review", async () => {
    (fetchHealthcareAccessRequestStatus as jest.Mock).mockResolvedValue({
      status: "pending",
      reject_reason: null,
      decision_role: "staff",
    });

    render(<NoPermissionPage />);

    await waitFor(() => {
      expect(screen.getByText("目前狀態：審核中")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "我是醫護人員，請求權限" })).toBeDisabled();
  });

  it("submits a new request and shows success feedback", async () => {
    (createHealthcareAccessRequest as jest.Mock).mockResolvedValue({
      request_id: 1,
      status: "pending",
    });

    render(<NoPermissionPage />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "我是醫護人員，請求權限" })).toBeEnabled();
    });

    fireEvent.click(screen.getByRole("button", { name: "我是醫護人員，請求權限" }));

    await waitFor(() => {
      expect(createHealthcareAccessRequest).toHaveBeenCalledWith({ line_id_token: "token" });
      expect(screen.getByText("已送出「我是醫護人員」權限申請，請等待管理員審核。")).toBeInTheDocument();
    });
  });

  it("uses provided next param for relogin link", async () => {
    mockSearchParams.set("next", "/admin/users");
    render(<NoPermissionPage />);

    await waitFor(() => {
      expect(readSafeNextPath).toHaveBeenCalledWith("/admin/users");
      expect(buildLoginPath).toHaveBeenCalledWith("/admin/users");
    });
    expect(screen.getByRole("link", { name: "重新登入" })).toHaveAttribute("href", "/login?next=%2Fadmin%2Fusers");
  });
});
