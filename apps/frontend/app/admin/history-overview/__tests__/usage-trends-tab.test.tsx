import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { UsageTrendsTab } from "@/app/admin/history-overview/usage-trends-tab";
import { buildUploadChartData } from "@/app/admin/history-overview/usage-upload-chart-data";
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

describe("buildUploadChartData", () => {
  test("maps daily upload counts", () => {
    const result = buildUploadChartData(
      uploadSeriesFixture.map(({ date, total_uploads }) => ({ date, total_uploads })),
      "daily"
    );
    expect(result.map((point) => point.upload_count)).toEqual([2, 3, 1]);
  });

  test("maps cumulative upload counts within the window", () => {
    const result = buildUploadChartData(
      uploadSeriesFixture.map(({ date, total_uploads }) => ({ date, total_uploads })),
      "cumulative"
    );
    expect(result.map((point) => point.upload_count)).toEqual([2, 5, 6]);
  });
});

describe("UsageTrendsTab", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fetchAdminActiveUsersSeries as jest.Mock).mockResolvedValue({
      active_window_days: 7,
      lookback_days: 30,
      interval: "day",
      items: [{ date: "2026-07-01", active_users: 4 }],
    });
    (fetchAdminDailySuspectedSeries as jest.Mock).mockResolvedValue({
      lookback_days: 30,
      items: uploadSeriesFixture,
    });
  });

  test("renders upload trend section", async () => {
    render(<UsageTrendsTab />);

    expect(await screen.findByText("上傳數趨勢")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "單日" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "累進" })).toBeInTheDocument();
  });

  test("switches upload chart to cumulative mode", async () => {
    render(<UsageTrendsTab />);

    await screen.findByText("上傳數趨勢");
    const charts = screen.getAllByTestId("line-chart");
    const uploadChart = charts[1];
    expect(uploadChart.textContent).toContain('"upload_count":2');

    fireEvent.click(screen.getByRole("button", { name: "累進" }));

    await waitFor(() => {
      expect(uploadChart.textContent).toContain('"upload_count":6');
    });
  });

  test("fetches upload series with independent lookback", async () => {
    render(<UsageTrendsTab />);

    await screen.findByText("上傳數趨勢");

    expect(fetchAdminDailySuspectedSeries).toHaveBeenCalledWith({ lookbackDays: 30 });
    expect(fetchAdminDailySuspectedSeries).toHaveBeenCalledTimes(2);
  });
});
