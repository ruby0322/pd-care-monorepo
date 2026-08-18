import { render, screen } from "@testing-library/react";

import { TodayWorkbenchHeader } from "@/app/admin/_components/today-workbench-header";

describe("TodayWorkbenchHeader", () => {
  test("renders the dashboard title and usage-trend subtitle", () => {
    render(<TodayWorkbenchHeader showUsageTrends />);

    expect(screen.getByRole("heading", { name: "儀表板" })).toBeInTheDocument();
    expect(screen.getByText("使用趨勢與當日需關注病患。")).toBeInTheDocument();
    expect(screen.queryByText(/工作佇列/)).not.toBeInTheDocument();
  });

  test("omits usage-trend copy when charts are not shown", () => {
    render(<TodayWorkbenchHeader />);

    expect(screen.getByText("當日需關注病患。")).toBeInTheDocument();
  });
});
