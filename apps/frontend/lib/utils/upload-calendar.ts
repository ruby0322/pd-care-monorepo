type UploadLike = {
  created_at: string;
  screening_result: "normal" | "suspected" | "rejected" | "technical_error";
};

export type CalendarDaySummary = {
  date: string;
  upload_count: number;
  has_suspected_risk: boolean;
};

const taipeiDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function toTaipeiDateKey(isoDatetime: string): string {
  const parsed = new Date(isoDatetime);
  if (Number.isNaN(parsed.getTime())) {
    return isoDatetime.slice(0, 10);
  }
  return taipeiDateFormatter.format(parsed);
}

export function summarizeUploadsForCalendar(uploads: UploadLike[]): CalendarDaySummary[] {
  const dayMap = new Map<string, CalendarDaySummary>();
  for (const upload of uploads) {
    const key = toTaipeiDateKey(upload.created_at);
    const current = dayMap.get(key);
    const hasSuspectedRisk = upload.screening_result === "suspected";
    if (!current) {
      dayMap.set(key, {
        date: key,
        upload_count: 1,
        has_suspected_risk: hasSuspectedRisk,
      });
      continue;
    }
    dayMap.set(key, {
      date: key,
      upload_count: current.upload_count + 1,
      has_suspected_risk: current.has_suspected_risk || hasSuspectedRisk,
    });
  }
  return Array.from(dayMap.values()).sort((a, b) => a.date.localeCompare(b.date));
}

export function getTaipeiTodayKey(reference: Date = new Date()): string {
  return taipeiDateFormatter.format(reference);
}

export function listRecentTaipeiDateKeys(windowDays: number, reference: Date = new Date()): string[] {
  const todayKey = getTaipeiTodayKey(reference);
  const [year, month, day] = todayKey.split("-").map(Number);
  const utcMidnight = Date.UTC(year, month - 1, day);
  return Array.from({ length: windowDays }, (_, index) => {
    const offset = windowDays - 1 - index;
    return new Date(utcMidnight - offset * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  });
}
