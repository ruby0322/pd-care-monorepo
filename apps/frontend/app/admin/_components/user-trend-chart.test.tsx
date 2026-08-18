import { render, screen, waitFor } from "@testing-library/react";

import { UserTrendChart } from "@/app/admin/_components/user-trend-chart";
import { fetchAdminActiveUsersSeries } from "@/lib/api/staff";

jest.mock("@/components/ui/chart", () => ({
  ChartContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="chart-container">{children}</div>,
  ChartTooltip: () => null,
  ChartTooltipContent: () => null,
  ChartLegend: () => null,
  ChartLegendContent: () => null,
}));

jest.mock("recharts", () => ({
  CartesianGrid: () => null,
  Line: () => null,
  LineChart: ({ data }: { data: { active_users?: number; registered_users?: number }[] }) => (
    <div data-testid="line-chart">{JSON.stringify(data)}</div>
  ),
  XAxis: () => null,
  YAxis: () => null,
}));

jest.mock("@/lib/api/staff", () => ({
  fetchAdminActiveUsersSeries: jest.fn(),
}));

describe("UserTrendChart", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fetchAdminActiveUsersSeries as jest.Mock).mockResolvedValue({
      active_window_days: 7,
      lookback_days: 30,
      interval: "day",
      items: [{ date: "2026-07-01", active_users: 4, registered_users: 9 }],
    });
  });

  test("renders registered and active series on a shared chart", async () => {
    render(<UserTrendChart />);

    expect(await screen.findByText("用戶趨勢")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId("line-chart").textContent).toContain('"active_users":4');
      expect(screen.getByTestId("line-chart").textContent).toContain('"registered_users":9');
    });
  });
});
