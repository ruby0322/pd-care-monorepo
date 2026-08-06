import { AxiosError } from "axios";

import { apiClient, getApiErrorCode } from "@/lib/api/client";
import { bindIdentity, bindIdentityWithRetry } from "@/lib/api/identity";
import { getLiffLoginProof } from "@/lib/auth/liff";

jest.mock("@/lib/api/client", () => ({
  apiClient: {
    post: jest.fn(),
  },
  getApiErrorCode: jest.fn(),
}));

jest.mock("@/lib/auth/liff", () => ({
  getLiffLoginProof: jest.fn(),
}));

describe("bindIdentityWithRetry", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getLiffLoginProof as jest.Mock).mockResolvedValue({
      idToken: "token-1",
      profile: { displayName: "Patient" },
    });
  });

  it("retries once when LINE verify is temporarily unavailable", async () => {
    const unavailableError = new AxiosError("bad request");
    unavailableError.response = {
      status: 400,
      data: { detail: { code: "LINE_VERIFY_UNAVAILABLE", message: "無法連上 LINE，請稍後再試。" } },
      statusText: "Bad Request",
      headers: {},
      config: {} as never,
    };
    (getApiErrorCode as jest.Mock)
      .mockReturnValueOnce("LINE_VERIFY_UNAVAILABLE")
      .mockReturnValueOnce(null);
    (apiClient.post as jest.Mock)
      .mockRejectedValueOnce(unavailableError)
      .mockResolvedValueOnce({
        data: { status: "pending", patient_id: null, can_upload: false },
      });
    (getLiffLoginProof as jest.Mock)
      .mockResolvedValueOnce({ idToken: "token-1", profile: { displayName: "Patient" } })
      .mockResolvedValueOnce({ idToken: "token-2", profile: { displayName: "Patient" } });

    const onRetry = jest.fn();
    const result = await bindIdentityWithRetry(
      { case_number: "P123456", birth_date: "1980-01-02" },
      async () => (await getLiffLoginProof()).idToken,
      onRetry
    );

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(apiClient.post).toHaveBeenCalledTimes(2);
    expect(result.status).toBe("pending");
  });

  it("does not retry for other errors", async () => {
    const invalidError = new AxiosError("bad request");
    invalidError.response = {
      status: 400,
      data: { detail: { code: "LINE_TOKEN_INVALID", message: "LINE 登入失敗，請重新開啟。" } },
      statusText: "Bad Request",
      headers: {},
      config: {} as never,
    };
    (getApiErrorCode as jest.Mock).mockReturnValue("LINE_TOKEN_INVALID");
    (apiClient.post as jest.Mock).mockRejectedValueOnce(invalidError);

    await expect(
      bindIdentityWithRetry({ case_number: "P123456", birth_date: "1980-01-02" })
    ).rejects.toBe(invalidError);
    expect(apiClient.post).toHaveBeenCalledTimes(1);
  });
});

describe("bindIdentity", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("posts bind payload to the identity endpoint", async () => {
    (apiClient.post as jest.Mock).mockResolvedValue({
      data: { status: "matched", patient_id: 1, can_upload: true },
    });

    const result = await bindIdentity({
      line_id_token: "token",
      case_number: "P123456",
      birth_date: "1980-01-02",
    });

    expect(apiClient.post).toHaveBeenCalledWith("/v1/identity/bind", {
      line_id_token: "token",
      case_number: "P123456",
      birth_date: "1980-01-02",
    });
    expect(result.status).toBe("matched");
  });
});
