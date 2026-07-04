type UploadLike = {
  created_at: string;
  screening_result: "normal" | "suspected" | "rejected" | "technical_error";
};

export type CalendarDaySummary = {
  date: string;
  upload_count: number;
  has_suspected_risk: boolean;
};

export type TaipeiMonthGridCell = {
  dateKey: string;
  dayOfMonth: number;
  isCurrentMonth: boolean;
};

export type TaipeiMonthGrid = {
  monthKey: string;
  year: number;
  month: number;
  cells: TaipeiMonthGridCell[];
};

export type TaipeiDateKeyParts = {
  year: number;
  month: number;
  day: number;
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

function formatMonthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function parseMonthKey(monthKey: string): { year: number; month: number } {
  const [yearPart, monthPart] = monthKey.split("-");
  const year = Number(yearPart);
  const month = Number(monthPart);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`Invalid month key: ${monthKey}`);
  }
  return { year, month };
}

export function parseTaipeiDateKey(dateKey: string): TaipeiDateKeyParts {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) {
    throw new Error(`Invalid Taipei date key: ${dateKey}`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    throw new Error(`Invalid Taipei date key: ${dateKey}`);
  }
  const validated = new Date(Date.UTC(year, month - 1, day));
  if (
    validated.getUTCFullYear() !== year ||
    validated.getUTCMonth() + 1 !== month ||
    validated.getUTCDate() !== day
  ) {
    throw new Error(`Invalid Taipei date key: ${dateKey}`);
  }
  return { year, month, day };
}

export function getMonthKeyFromDateKey(dateKey: string): string {
  const { year, month } = parseTaipeiDateKey(dateKey);
  return formatMonthKey(year, month);
}

export function getRelativeMonthKey(monthKey: string, offset: number): string {
  const { year, month } = parseMonthKey(monthKey);
  const shifted = new Date(Date.UTC(year, month - 1 + offset, 1));
  return formatMonthKey(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1);
}

function formatDateKeyFromUtc(utcDate: Date): string {
  return utcDate.toISOString().slice(0, 10);
}

export function buildTaipeiMonthGrid(monthKey: string): TaipeiMonthGrid {
  const { year, month } = parseMonthKey(monthKey);
  const firstDayUtc = new Date(Date.UTC(year, month - 1, 1));
  const firstWeekday = firstDayUtc.getUTCDay();
  const gridStartUtc = new Date(Date.UTC(year, month - 1, 1 - firstWeekday));

  const cells: TaipeiMonthGridCell[] = Array.from({ length: 42 }, (_, index) => {
    const cellDateUtc = new Date(Date.UTC(
      gridStartUtc.getUTCFullYear(),
      gridStartUtc.getUTCMonth(),
      gridStartUtc.getUTCDate() + index
    ));
    return {
      dateKey: formatDateKeyFromUtc(cellDateUtc),
      dayOfMonth: cellDateUtc.getUTCDate(),
      isCurrentMonth: cellDateUtc.getUTCMonth() === month - 1,
    };
  });

  return {
    monthKey,
    year,
    month,
    cells,
  };
}
