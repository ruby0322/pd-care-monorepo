import { apiClient } from "@/lib/api/client";
import {
  fetchUploadHistoryByMonthWindow,
  getWindowStartMonthKey,
  mergeUploadHistoryDays,
  type UploadHistoryDay,
} from "@/lib/api/upload-history";

jest.mock("@/lib/api/client", () => ({
  apiClient: {
    get: jest.fn(),
  },
}));

describe("upload-history month window contract", () => {
  test("getWindowStartMonthKey resolves month key 2 months earlier", () => {
    expect(getWindowStartMonthKey("2026-05")).toBe("2026-03");
    expect(getWindowStartMonthKey("2026-01")).toBe("2025-11");
  });

  test("fetchUploadHistoryByMonthWindow sends month range params", async () => {
    const getMock = apiClient.get as jest.Mock;
    getMock.mockResolvedValueOnce({
      data: {
        status: "matched",
        patient_id: 1,
        can_upload: true,
        days: [],
        summary_28d: {
          all_upload_count_28d: 0,
          suspected_upload_count_28d: 0,
          continuous_upload_streak_days: 0,
        },
      },
    });

    await fetchUploadHistoryByMonthWindow("2026-05");

    expect(getMock).toHaveBeenCalledWith("/v1/patient/upload-history", {
      params: {
        month_start: "2026-03",
        month_end: "2026-05",
      },
    });
  });

  test("mergeUploadHistoryDays deduplicates by date and keeps latest record", () => {
    const previous: UploadHistoryDay[] = [
      { date: "2026-05-04", upload_count: 1, has_suspected_risk: false },
      { date: "2026-05-05", upload_count: 1, has_suspected_risk: false },
    ];
    const incoming: UploadHistoryDay[] = [
      { date: "2026-05-05", upload_count: 3, has_suspected_risk: true },
      { date: "2026-05-06", upload_count: 1, has_suspected_risk: false },
    ];

    expect(mergeUploadHistoryDays(previous, incoming)).toEqual([
      { date: "2026-05-04", upload_count: 1, has_suspected_risk: false },
      { date: "2026-05-05", upload_count: 3, has_suspected_risk: true },
      { date: "2026-05-06", upload_count: 1, has_suspected_risk: false },
    ]);
  });
});
