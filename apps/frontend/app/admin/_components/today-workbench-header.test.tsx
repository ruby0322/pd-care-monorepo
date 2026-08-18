import { render, screen } from "@testing-library/react";

import { TodayWorkbenchHeader } from "@/app/admin/_components/today-workbench-header";

describe("TodayWorkbenchHeader", () => {
  test("renders the dashboard title without the day queue subtitle", () => {
    render(<TodayWorkbenchHeader />);

    expect(screen.getByRole("heading", { name: "儀表板" })).toBeInTheDocument();
    expect(screen.queryByText(/需關注的病患與工作佇列/)).not.toBeInTheDocument();
  });
});
