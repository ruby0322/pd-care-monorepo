export function getSuspectedKpi(
  period: "today" | number,
  summarySuspectedUsers: number | null | undefined
): { label: string; value: number } {
  if (period === "today") {
    return {
      label: "今日疑似感染人數",
      value: summarySuspectedUsers ?? 0,
    };
  }

  return {
    label: `${period} 月疑似感染人數`,
    value: summarySuspectedUsers ?? 0,
  };
}

export function getElevatedUserKpi(
  period: "today" | number,
  summaryElevatedUsers: number | null | undefined
): { label: string; value: number } {
  if (period === "today") {
    return {
      label: "今日症狀高風險人數",
      value: summaryElevatedUsers ?? 0,
    };
  }

  return {
    label: `${period} 月症狀高風險人數`,
    value: summaryElevatedUsers ?? 0,
  };
}
