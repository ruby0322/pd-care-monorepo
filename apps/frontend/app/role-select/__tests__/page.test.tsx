import { fireEvent, render, screen } from "@testing-library/react";

import RoleSelectPage from "@/app/role-select/page";
import { buildLoginPath } from "@/lib/auth/liff";

const mockPush = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

jest.mock("@/lib/auth/liff", () => ({
  buildLoginPath: jest.fn((next: string) => `/login?next=${encodeURIComponent(next)}`),
}));

describe("RoleSelectPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("routes patient choice to patient flow", () => {
    render(<RoleSelectPage />);

    fireEvent.click(screen.getByRole("button", { name: /我是病患/ }));
    expect(buildLoginPath).toHaveBeenCalledWith("/patient");
    expect(mockPush).toHaveBeenCalledWith("/login?next=%2Fpatient");
  });

  it("routes nurse choice to login with admin next path", () => {
    render(<RoleSelectPage />);

    fireEvent.click(screen.getByRole("button", { name: /我是護理師/ }));
    expect(buildLoginPath).toHaveBeenCalledWith("/admin");
    expect(mockPush).toHaveBeenCalledWith("/login?next=%2Fadmin");
  });
});
