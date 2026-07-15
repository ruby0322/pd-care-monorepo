import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import AppSelectionPage from "@/app/apps/page";
import { fetchAuthBootstrap } from "@/lib/api/identity";
import { buildLoginPath, getLiffLoginProof } from "@/lib/auth/liff";
import { getPatientSession } from "@/lib/auth/patient-session";
import { clearAuthState, setActiveApp } from "@/lib/auth/principal-session";
import { getStaffSession } from "@/lib/auth/staff-session";

const mockReplace = jest.fn();
const mockPush = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: mockReplace,
    push: mockPush,
  }),
}));

jest.mock("@/lib/auth/liff", () => ({
  getLiffLoginProof: jest.fn(),
  buildLoginPath: jest.fn(() => "/login?next=%2Fapps"),
}));

jest.mock("@/lib/auth/staff-session", () => ({
  getStaffSession: jest.fn(),
}));

jest.mock("@/lib/auth/patient-session", () => ({
  getPatientSession: jest.fn(),
}));

jest.mock("@/lib/auth/principal-session", () => ({
  clearAuthState: jest.fn(),
  setActiveApp: jest.fn(),
}));

jest.mock("@/lib/api/identity", () => ({
  fetchAuthBootstrap: jest.fn(),
}));

describe("AppSelectionPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getStaffSession as jest.Mock).mockReturnValue({ role: "staff" });
    (getPatientSession as jest.Mock).mockReturnValue(null);
    (getLiffLoginProof as jest.Mock).mockResolvedValue({ idToken: "token", profile: { displayName: "User" } });
    (fetchAuthBootstrap as jest.Mock).mockResolvedValue({ next_step: "role_select" });
  });

  it("redirects users without staff session to login", async () => {
    (getStaffSession as jest.Mock).mockReturnValue(null);
    (getPatientSession as jest.Mock).mockReturnValue(null);
    (fetchAuthBootstrap as jest.Mock).mockRejectedValue(new Error("no liff"));

    render(<AppSelectionPage />);

    await waitFor(() => {
      expect(buildLoginPath).toHaveBeenCalledWith("/apps");
      expect(mockReplace).toHaveBeenCalledWith("/login?next=%2Fapps");
    });
  });

  it("routes brand-new users to role-select instead of patient onboarding", async () => {
    (getStaffSession as jest.Mock).mockReturnValue(null);
    (getPatientSession as jest.Mock).mockReturnValue(null);
    (fetchAuthBootstrap as jest.Mock).mockResolvedValue({ next_step: "role_select" });

    render(<AppSelectionPage />);

    await waitFor(() => {
      expect(clearAuthState).toHaveBeenCalled();
      expect(mockReplace).toHaveBeenCalledWith("/role-select");
    });
  });

  it("redirects patient-only users to patient app", async () => {
    (getStaffSession as jest.Mock).mockReturnValue(null);
    (getPatientSession as jest.Mock).mockReturnValue({ role: "patient" });

    render(<AppSelectionPage />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/patient");
    });
    expect(buildLoginPath).not.toHaveBeenCalled();
  });

  it("shows patient onboarding entry when patient session is unavailable", async () => {
    render(<AppSelectionPage />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /護理師後台/ })).toBeInTheDocument();
    });
    const patientButton = screen.getByRole("button", { name: /病患 App/ });
    expect(patientButton).toBeInTheDocument();
    fireEvent.click(patientButton);
    expect(mockPush).toHaveBeenCalledWith("/onboarding/patient?intent=register-patient");
  });

  it("shows both cards when patient session exists and routes correctly", async () => {
    (getPatientSession as jest.Mock).mockReturnValue({ role: "patient" });
    render(<AppSelectionPage />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /病患 App/ })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /護理師後台/ }));
    fireEvent.click(screen.getByRole("button", { name: /病患 App/ }));

    expect(setActiveApp).toHaveBeenNthCalledWith(1, "admin");
    expect(setActiveApp).toHaveBeenNthCalledWith(2, "patient");
    expect(mockPush).toHaveBeenNthCalledWith(1, "/admin");
    expect(mockPush).toHaveBeenNthCalledWith(2, "/patient");
  });
});
