export function getSuspectedKpi(
  period: "today" | number,
  statsSuspectedPatients: number,
  todaySuspectedUploads: number | null | undefined
): { label: string; value: number } {
  if (period === "today") {
    return {
      label: "今日疑似感染筆數",
      value: todaySuspectedUploads ?? 0,
    };
  }

  return {
    label: "疑似感染人數",
    value: statsSuspectedPatients,
  };
}
