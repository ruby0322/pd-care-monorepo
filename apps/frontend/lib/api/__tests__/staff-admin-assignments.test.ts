import { apiClient } from "@/lib/api/client";
import { fetchAdminAssignmentsByStaff } from "@/lib/api/staff";

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
