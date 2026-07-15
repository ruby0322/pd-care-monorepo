import { render, screen, waitFor } from "@testing-library/react";

import PatientOnboardingPage from "@/app/onboarding/patient/page";
import { fetchAuthBootstrap, fetchIdentityStatus } from "@/lib/api/identity";
import { buildLoginPath, getLiffLoginProof } from "@/lib/auth/liff";

const mockReplace = jest.fn();
const mockSearchParamsGet = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: mockReplace,
  }),
  useSearchParams: () => ({
    get: mockSearchParamsGet,
  }),
}));

jest.mock("@/lib/auth/liff", () => ({
  getLiffLoginProof: jest.fn(),
  buildLoginPath: jest.fn((next: string) => `/login?next=${encodeURIComponent(next)}`),
}));

jest.mock("@/lib/api/identity", () => ({
  fetchAuthBootstrap: jest.fn(),
  fetchIdentityStatus: jest.fn(),
}));

describe("PatientOnboardingPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSearchParamsGet.mockReturnValue(null);
    (getLiffLoginProof as jest.Mock).mockResolvedValue({
      idToken: "token",
      profile: { displayName: "Patient" },
    });
    (fetchAuthBootstrap as jest.Mock).mockResolvedValue({
      next_step: "onboarding_patient",
    });
    (fetchIdentityStatus as jest.Mock).mockResolvedValue({
      status: "unbound",
      patient_id: null,
      can_upload: false,
    });
  });

  it("redirects to app selection login when bootstrap says app_selection", async () => {
    (fetchAuthBootstrap as jest.Mock).mockResolvedValue({
      next_step: "app_selection",
    });

    render(<PatientOnboardingPage />);

    await waitFor(() => {
      expect(buildLoginPath).toHaveBeenCalledWith("/apps");
      expect(mockReplace).toHaveBeenCalledWith("/login?next=%2Fapps");
    });
  });

  it("shows pending state message", async () => {
    (fetchIdentityStatus as jest.Mock).mockResolvedValue({
      status: "pending",
      patient_id: null,
      can_upload: false,
    });

    render(<PatientOnboardingPage />);

    expect(await screen.findByText("病患註冊審核中")).toBeInTheDocument();
  });

  it("stays on patient onboarding when app-selection intent is present for staff/admin", async () => {
    mockSearchParamsGet.mockImplementation((key: string) => (key === "intent" ? "register-patient" : null));
    (fetchAuthBootstrap as jest.Mock).mockResolvedValue({
      next_step: "app_selection",
      role: "staff",
    });

    render(<PatientOnboardingPage />);

    expect(await screen.findByText("病患身分註冊")).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
