import { render, screen } from "@testing-library/react";

import { UsageTrendsTab } from "@/app/admin/history-overview/usage-trends-tab";
import { fetchAdminActiveUsersSeries, fetchAdminDailySuspectedSeries } from "@/lib/api/staff";

jest.mock("@/components/ui/chart", () => ({
  ChartContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="chart-container">{children}</div>,
  ChartTooltip: () => null,
  ChartTooltipContent: () => null,
  ChartLegend: () => null,
  ChartLegendContent: () => null,
}));

jest.mock("recharts", () => ({
  CartesianGrid: () => null,
  Bar: () => null,
  BarChart: ({ data }: { data: { upload_count?: number }[] }) => (
    <div data-testid="bar-chart">{JSON.stringify(data)}</div>
  ),
  Line: () => null,
  LineChart: ({ data }: { data: { upload_count?: number }[] }) => (
    <div data-testid="line-chart">{JSON.stringify(data)}</div>
  ),
  XAxis: () => null,
  YAxis: () => null,
}));

jest.mock("@/lib/api/staff", () => ({
  fetchAdminActiveUsersSeries: jest.fn(),
  fetchAdminDailySuspectedSeries: jest.fn(),
}));

const uploadSeriesFixture = [
  { date: "2026-07-01", total_uploads: 2, suspected_uploads: 0, symptom_elevated_uploads: 0, suspected_ratio: 0 },
  { date: "2026-07-02", total_uploads: 3, suspected_uploads: 1, symptom_elevated_uploads: 0, suspected_ratio: 0.33 },
  { date: "2026-07-03", total_uploads: 1, suspected_uploads: 0, symptom_elevated_uploads: 1, suspected_ratio: 0 },
];

describe("UsageTrendsTab", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fetchAdminActiveUsersSeries as jest.Mock).mockResolvedValue({
      active_window_days: 7,
      lookback_days: 30,
      interval: "day",
      items: [{ date: "2026-07-01", active_users: 4, registered_users: 9 }],
    });
    (fetchAdminDailySuspectedSeries as jest.Mock).mockResolvedValue({
      lookback_days: 30,
      items: uploadSeriesFixture,
    });
  });

  test("renders shared user and upload trend charts", async () => {
    render(<UsageTrendsTab />);

    expect(await screen.findByText("用戶趨勢")).toBeInTheDocument();
    expect(screen.getByText("上傳數趨勢")).toBeInTheDocument();
  });
});
