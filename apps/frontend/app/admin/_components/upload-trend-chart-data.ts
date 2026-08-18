export type UploadSeriesPoint = {
  date: string;
  total_uploads: number;
};

export type UploadChartMode = "daily" | "cumulative";

export function buildUploadChartData(series: UploadSeriesPoint[], mode: UploadChartMode) {
  let running = 0;
  return series.map((point) => {
    running += point.total_uploads;
    return {
      date: point.date,
      shortDate: new Date(point.date).toLocaleDateString("zh-TW", { month: "numeric", day: "numeric" }),
      upload_count: mode === "daily" ? point.total_uploads : running,
    };
  });
}
