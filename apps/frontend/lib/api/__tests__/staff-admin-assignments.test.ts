import { apiClient } from "@/lib/api/client";
import { fetchAdminAssignments, fetchAdminAssignmentsByStaff, fetchAdminUsersPage } from "@/lib/api/staff";

jest.mock("@/lib/api/client", () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
    delete: jest.fn(),
  },
}));

describe("fetchAdminAssignmentsByStaff", () => {
  test("serializes staff_identity_ids using repeated query keys", async () => {
    const getMock = apiClient.get as jest.Mock;
    getMock.mockResolvedValueOnce({ data: { items: [] } });

    await fetchAdminAssignmentsByStaff({ staffIdentityIds: [11, 22] });

    expect(getMock).toHaveBeenCalledWith(
      "/v1/staff/admin/assignments/by-staff",
      expect.objectContaining({
        params: {
          staff_identity_ids: [11, 22],
        },
        paramsSerializer: {
          indexes: null,
        },
      })
    );
  });
});

describe("fetchAdminAssignments", () => {
  test("sends the dual-role exclusion filter", async () => {
    const getMock = apiClient.get as jest.Mock;
    getMock.mockResolvedValueOnce({ data: { items: [], total: 0, limit: 12, offset: 0 } });

    await fetchAdminAssignments({ excludeStaffAdminPatients: true, limit: 12, offset: 0 });

    expect(getMock).toHaveBeenCalledWith(
      "/v1/staff/admin/assignments",
      expect.objectContaining({
        params: expect.objectContaining({
          exclude_staff_admin_patients: true,
        }),
      })
    );
  });
});

describe("fetchAdminUsersPage", () => {
  test("sends assigned count sort to the admin users endpoint", async () => {
    const getMock = apiClient.get as jest.Mock;
    getMock.mockResolvedValueOnce({ data: { items: [], total: 0, limit: 12, offset: 0 } });

    await fetchAdminUsersPage({ sort: "assigned_count_desc", limit: 12, offset: 0 });

    expect(getMock).toHaveBeenCalledWith(
      "/v1/staff/admin/users",
      expect.objectContaining({
        params: expect.objectContaining({
          sort: "assigned_count_desc",
        }),
      })
    );
  });
});
