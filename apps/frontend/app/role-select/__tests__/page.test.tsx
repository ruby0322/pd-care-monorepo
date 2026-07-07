import { fireEvent, render, screen } from "@testing-library/react";

import RoleSelectPage from "@/app/role-select/page";

const mockPush = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

describe("RoleSelectPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("routes patient choice to patient flow", () => {
    render(<RoleSelectPage />);

    fireEvent.click(screen.getByRole("button", { name: /我是病患/ }));
    expect(mockPush).toHaveBeenCalledWith("/patient");
  });

  it("routes nurse choice to login with admin next path", () => {
    render(<RoleSelectPage />);

    fireEvent.click(screen.getByRole("button", { name: /我是護理師/ }));
    expect(mockPush).toHaveBeenCalledWith("/login?next=%2Fadmin");
  });
});
