import { render, screen, waitFor } from "@testing-library/react";

import AdminOnboardingPage from "@/app/onboarding/admin/page";
import {
  fetchAuthBootstrap,
  fetchHealthcareAccessRequestStatus,
} from "@/lib/api/identity";
import { buildLoginPath, getLiffLoginProof } from "@/lib/auth/liff";

const mockReplace = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: mockReplace,
  }),
}));

jest.mock("@/lib/auth/liff", () => ({
  getLiffLoginProof: jest.fn(),
  buildLoginPath: jest.fn((next: string) => `/login?next=${encodeURIComponent(next)}`),
}));

jest.mock("@/lib/api/identity", () => ({
  fetchAuthBootstrap: jest.fn(),
  fetchHealthcareAccessRequestStatus: jest.fn(),
}));

describe("AdminOnboardingPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getLiffLoginProof as jest.Mock).mockResolvedValue({
      idToken: "token",
      profile: { displayName: "Staff" },
    });
    (fetchAuthBootstrap as jest.Mock).mockResolvedValue({
      next_step: "onboarding_admin",
    });
    (fetchHealthcareAccessRequestStatus as jest.Mock).mockResolvedValue({
      status: "none",
      reject_reason: null,
      decision_role: null,
    });
  });

  it("redirects to apps login when already app-selection eligible", async () => {
    (fetchAuthBootstrap as jest.Mock).mockResolvedValue({
      next_step: "app_selection",
    });

    render(<AdminOnboardingPage />);

    await waitFor(() => {
      expect(buildLoginPath).toHaveBeenCalledWith("/apps");
      expect(mockReplace).toHaveBeenCalledWith("/login?next=%2Fapps");
    });
  });

  it("shows pending state when request is under review", async () => {
    (fetchHealthcareAccessRequestStatus as jest.Mock).mockResolvedValue({
      status: "pending",
      reject_reason: null,
      decision_role: "staff",
    });

    render(<AdminOnboardingPage />);

    expect(await screen.findByText("目前狀態：審核中")).toBeInTheDocument();
  });
});
