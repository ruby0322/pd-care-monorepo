import { apiClient } from "@/lib/api/client";
import { fetchAdminUsers, fetchAdminUsersPage, updateAdminUserRealName } from "@/lib/api/staff";

jest.mock("@/lib/api/client", () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

describe("fetchAdminUsers", () => {
  test("always requests backend exclusion of patient users", async () => {
    const getMock = apiClient.get as jest.Mock;
    getMock.mockResolvedValueOnce({ data: { items: [], total: 0, limit: 10, offset: 0 } });

    await fetchAdminUsers({ query: "demo" });

    expect(getMock).toHaveBeenCalledWith("/v1/staff/admin/users", {
      params: {
        query: "demo",
        role: undefined,
        exclude_patient: true,
        is_active: undefined,
        created_from: undefined,
        created_to: undefined,
        limit: 10,
        offset: 0,
      },
    });
  });

  test("returns identity items with real_name values", async () => {
    const getMock = apiClient.get as jest.Mock;
    getMock.mockResolvedValueOnce({
      data: {
        items: [
          {
            id: 1,
            line_user_id: "U_STAFF_1",
            display_name: "LINE Name",
            real_name: "Dr. Lin",
            role: "staff",
            is_active: true,
            patient_id: null,
            created_at: "2026-05-01T00:00:00Z",
          },
        ],
        total: 1,
        limit: 10,
        offset: 0,
      },
    });

    const items = await fetchAdminUsers();

    expect(items[0]?.real_name).toBe("Dr. Lin");
  });
});

describe("fetchAdminUsersPage", () => {
  test("forwards explicit pagination parameters", async () => {
    const getMock = apiClient.get as jest.Mock;
    getMock.mockResolvedValueOnce({
      data: {
        items: [],
        total: 12,
        limit: 10,
        offset: 10,
      },
    });

    await fetchAdminUsersPage({ query: "staff", limit: 10, offset: 10 });

    expect(getMock).toHaveBeenCalledWith("/v1/staff/admin/users", {
      params: {
        query: "staff",
        role: undefined,
        exclude_patient: true,
        is_active: undefined,
        created_from: undefined,
        created_to: undefined,
        limit: 10,
        offset: 10,
      },
    });
  });
});

describe("updateAdminUserRealName", () => {
  test("sends real-name update payload to admin endpoint", async () => {
    const postMock = apiClient.post as jest.Mock;
    postMock.mockResolvedValueOnce({ data: { id: 9, real_name: "Dr. Lin" } });

    await updateAdminUserRealName(9, { real_name: "Dr. Lin" });

    expect(postMock).toHaveBeenCalledWith("/v1/staff/admin/users/9/real-name", {
      real_name: "Dr. Lin",
    });
  });
});
