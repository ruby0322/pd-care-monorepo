export function getSuspectedKpi(
  period: "today" | number,
  statsSuspectedPatients: number,
  todaySuspectedUsers: number | null | undefined
): { label: string; value: number } {
  if (period === "today") {
    return {
      label: "今日疑似感染人數",
      value: todaySuspectedUsers ?? 0,
    };
  }

  return {
    label: `${period} 月疑似感染人數`,
    value: statsSuspectedPatients,
  };
}

export function getElevatedUserKpi(
  period: "today" | number,
  statsElevatedPatients: number,
  todayElevatedUsers: number | null | undefined
): { label: string; value: number } {
  if (period === "today") {
    return {
      label: "今日症狀高風險人數",
      value: todayElevatedUsers ?? 0,
    };
  }

  return {
    label: `${period} 月症狀高風險人數`,
    value: statsElevatedPatients,
  };
}
