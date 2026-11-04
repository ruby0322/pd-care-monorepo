export type UploadSeriesPoint = {
  date: string;
  total_uploads: number;
  labeled_uploads?: number;
};

export type UploadChartMode = "daily" | "cumulative";

export function buildUploadChartData(
  series: UploadSeriesPoint[],
  mode: UploadChartMode,
  todayKey?: string
) {
  let running = 0;
  let runningLabeled = 0;
  return series.map((point) => {
    const labeled = Math.min(point.labeled_uploads ?? 0, point.total_uploads);
    const unlabeled = point.total_uploads - labeled;
    running += point.total_uploads;
    runningLabeled += labeled;
    return {
      date: point.date,
      shortDate: new Date(point.date).toLocaleDateString("zh-TW", { month: "numeric", day: "numeric" }),
      upload_count: mode === "daily" ? point.total_uploads : running,
      labeled_count: mode === "daily" ? labeled : runningLabeled,
      unlabeled_count: mode === "daily" ? unlabeled : running - runningLabeled,
      isToday: todayKey != null && point.date === todayKey,
    };
  });
}
