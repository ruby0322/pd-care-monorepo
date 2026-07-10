import { apiClient } from "@/lib/api/client";
import {
  fetchStaffPatientUploadCalendar,
  fetchStaffPatientUploads,
} from "@/lib/api/staff";

jest.mock("@/lib/api/client", () => ({
  apiClient: {
    get: jest.fn(),
  },
}));

describe("staff patient upload APIs", () => {
  test("requests a filtered upload page with backend parameter names", async () => {
    const getMock = apiClient.get as jest.Mock;
    getMock.mockResolvedValueOnce({ data: { items: [], total: 0, limit: 20, offset: 20 } });

    await fetchStaffPatientUploads(42, {
      createdFrom: "2026-05-01",
      createdTo: "2026-05-31",
      limit: 20,
      offset: 20,
    });

    expect(getMock).toHaveBeenCalledWith("/v1/staff/patients/42/uploads", {
      params: {
        created_from: "2026-05-01",
        created_to: "2026-05-31",
        limit: 20,
        offset: 20,
      },
    });
  });

  test("requests full calendar summaries independently from upload pages", async () => {
    const getMock = apiClient.get as jest.Mock;
    getMock.mockResolvedValueOnce({ data: { items: [] } });

    await fetchStaffPatientUploadCalendar(42);

    expect(getMock).toHaveBeenCalledWith("/v1/staff/patients/42/upload-calendar");
  });
});
