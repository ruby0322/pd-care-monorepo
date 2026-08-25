import { render, screen, waitFor } from "@testing-library/react";

import PatientProfilePage from "@/app/patient/profile/page";
import { fetchPatientProfile } from "@/lib/api/identity";
import { getPatientSession } from "@/lib/auth/patient-session";

const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
};

jest.mock("next/navigation", () => ({
  useRouter: () => mockRouter,
}));

jest.mock("next/image", () => ({
  __esModule: true,
  default: ({ alt, src }: { alt: string; src: string }) => (
    // eslint-disable-next-line @next/next/no-img-element -- test stub
    <img alt={alt} src={src} />
  ),
}));

jest.mock("@/lib/auth/patient-session", () => ({
  getPatientSession: jest.fn(),
}));

jest.mock("@/lib/api/identity", () => ({
  fetchPatientProfile: jest.fn(),
}));

jest.mock("@/lib/api/client", () => ({
  getReadableApiError: jest.fn(() => "readable error"),
}));

describe("PatientProfilePage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getPatientSession as jest.Mock).mockReturnValue({
      accessToken: "token",
      expiresAt: Date.now() + 3600 * 1000,
      role: "patient",
      lineUserId: "line-id",
    });
  });

  test("shows lifetime metrics without an outer wrapping card", async () => {
    (fetchPatientProfile as jest.Mock).mockResolvedValue({
      status: "matched",
      can_upload: true,
      line_user_id: "U1234abcd",
      display_name: "王小明",
      picture_url: null,
      patient_id: 1,
      full_name: "王小明",
      case_number: "P111111",
      birth_date: "1981-01-01",
      onboarding_guide_dismissed: false,
      longest_continuous_upload_streak_days: 14,
      total_upload_count: 42,
      primary_nurse_name: "鄭靜誼",
    });

    const { container } = render(<PatientProfilePage />);

    expect(await screen.findByText("最長連續上傳天數")).toBeInTheDocument();
    expect(screen.getByText("14 天")).toBeInTheDocument();
    expect(screen.getByText("總上傳次數")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("主要護理師")).toBeInTheDocument();
    expect(screen.getByText("鄭靜誼")).toBeInTheDocument();
    expect(container.querySelector(".rounded-3xl.border")).not.toBeInTheDocument();
    expect(screen.getByText("PD Care v0.1.0")).toBeInTheDocument();
  });

  test("redirects users without a patient session", async () => {
    (getPatientSession as jest.Mock).mockReturnValue(null);

    render(<PatientProfilePage />);

    await waitFor(() => {
      expect(mockRouter.replace).toHaveBeenCalledWith("/onboarding/patient");
    });
  });
});
