import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import Home from "@/app/page";
import { fetchAuthBootstrap } from "@/lib/api/identity";
import { getLiffLoginProof, isLiffLoggedInSilently } from "@/lib/auth/liff";
import { getPatientSession } from "@/lib/auth/patient-session";
import { getStaffSession } from "@/lib/auth/staff-session";

const mockReplace = jest.fn();
const mockPush = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: mockReplace,
    push: mockPush,
  }),
}));

jest.mock("@/lib/auth/staff-session", () => ({
  getStaffSession: jest.fn(),
}));

jest.mock("@/lib/auth/patient-session", () => ({
  getPatientSession: jest.fn(),
}));

jest.mock("@/lib/api/identity", () => ({
  fetchAuthBootstrap: jest.fn(),
}));

jest.mock("@/lib/auth/liff", () => ({
  getLiffLoginProof: jest.fn(),
  isLiffLoggedInSilently: jest.fn(),
}));

describe("Home landing page", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getStaffSession as jest.Mock).mockReturnValue(null);
    (getPatientSession as jest.Mock).mockReturnValue(null);
    (isLiffLoggedInSilently as jest.Mock).mockResolvedValue(false);
  });

  it("redirects staff users to app selection", async () => {
    (getStaffSession as jest.Mock).mockReturnValue({ role: "staff" });

    render(<Home />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/apps");
    });
  });

  it("redirects patient users to patient app", async () => {
    (getPatientSession as jest.Mock).mockReturnValue({ role: "patient" });

    render(<Home />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/patient");
    });
  });

  it("shows intro content for new users and navigates to role selection", async () => {
    render(<Home />);

    await waitFor(() => {
      expect(screen.getByText("PD Care")).toBeInTheDocument();
    });
    const cta = screen.getByRole("button", { name: "開始使用" });
    fireEvent.click(cta);
    expect(mockPush).toHaveBeenCalledWith("/role-select");
  });

  it("routes LIFF-authenticated returning users directly by bootstrap state", async () => {
    (isLiffLoggedInSilently as jest.Mock).mockResolvedValue(true);
    (getLiffLoginProof as jest.Mock).mockResolvedValue({ idToken: "id.token.value" });
    (fetchAuthBootstrap as jest.Mock).mockResolvedValue({ next_step: "app_selection" });

    render(<Home />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/apps");
    });
  });

  it("keeps intro for anonymous users without triggering bootstrap", async () => {
    (isLiffLoggedInSilently as jest.Mock).mockResolvedValue(false);

    render(<Home />);

    await waitFor(() => {
      expect(screen.getByText("PD Care")).toBeInTheDocument();
    });
    expect(getLiffLoginProof).not.toHaveBeenCalled();
    expect(fetchAuthBootstrap).not.toHaveBeenCalled();
  });
});
