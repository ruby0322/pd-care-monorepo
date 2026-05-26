import { apiClient } from "@/lib/api/client";
import { fetchAdminUsers } from "@/lib/api/staff";

jest.mock("@/lib/api/client", () => ({
  apiClient: {
    get: jest.fn(),
  },
}));

describe("fetchAdminUsers", () => {
  test("always requests backend exclusion of patient users", async () => {
    const getMock = apiClient.get as jest.Mock;
    getMock.mockResolvedValueOnce({ data: { items: [] } });

    await fetchAdminUsers({ query: "demo" });

    expect(getMock).toHaveBeenCalledWith("/v1/staff/admin/users", {
      params: {
        query: "demo",
        role: undefined,
        exclude_patient: true,
        is_active: undefined,
        created_from: undefined,
        created_to: undefined,
      },
    });
  });
});
