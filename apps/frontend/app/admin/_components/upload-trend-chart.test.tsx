import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { UploadTrendChart } from "@/app/admin/_components/upload-trend-chart";
import { buildUploadChartData } from "@/app/admin/_components/upload-trend-chart-data";
import { fetchAdminDailySuspectedSeries } from "@/lib/api/staff";

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
  Cell: () => null,
  Line: () => null,
  LineChart: ({ data }: { data: { upload_count?: number }[] }) => (
    <div data-testid="line-chart">{JSON.stringify(data)}</div>
  ),
  XAxis: () => null,
  YAxis: () => null,
}));

jest.mock("@/lib/api/staff", () => ({
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

  test("marks today's point for the daily bar highlight", () => {
    const result = buildUploadChartData(
      uploadSeriesFixture.map(({ date, total_uploads }) => ({ date, total_uploads })),
      "daily",
      "2026-07-03"
    );
    expect(result.map((point) => point.isToday)).toEqual([false, false, true]);
  });
});

describe("UploadTrendChart", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fetchAdminDailySuspectedSeries as jest.Mock).mockResolvedValue({
      lookback_days: 30,
      items: uploadSeriesFixture,
    });
  });

  test("renders upload trend section", async () => {
    render(<UploadTrendChart />);

    expect(await screen.findByText("上傳數趨勢")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "單日" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "累進" })).toBeInTheDocument();
  });

  test("renders daily uploads as a bar chart and cumulative as a line chart", async () => {
    render(<UploadTrendChart />);

    await screen.findByText("上傳數趨勢");
    const barChart = screen.getByTestId("bar-chart");
    await waitFor(() => {
      expect(barChart.textContent).toContain('"upload_count":2');
    });
    expect(screen.queryByTestId("line-chart")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "累進" }));

    const lineChart = await screen.findByTestId("line-chart");
    await waitFor(() => {
      expect(lineChart.textContent).toContain('"upload_count":6');
    });
    expect(screen.queryByTestId("bar-chart")).not.toBeInTheDocument();
  });

  test("fetches upload series with lookback", async () => {
    render(<UploadTrendChart />);

    await screen.findByText("上傳數趨勢");
    expect(fetchAdminDailySuspectedSeries).toHaveBeenCalledWith({ lookbackDays: 30 });
  });
});
