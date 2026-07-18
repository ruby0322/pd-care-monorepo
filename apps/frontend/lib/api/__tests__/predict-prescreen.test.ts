import { AxiosError } from "axios";

import { apiClient } from "@/lib/api/client";
import { prescreenPatientExitSiteImage } from "@/lib/api/predict";

jest.mock("@/lib/api/client", () => ({
  apiClient: {
    post: jest.fn(),
  },
}));

describe("prescreenPatientExitSiteImage", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function axios429(): AxiosError {
    return new AxiosError("Too Many Requests", "ERR_BAD_REQUEST", undefined, undefined, {
      status: 429,
      statusText: "Too Many Requests",
      headers: {},
      config: {} as never,
      data: { detail: "Prescreen rate limit exceeded; retry shortly" },
    });
  }

  it("retries twice on 429 then succeeds", async () => {
    const postMock = apiClient.post as jest.Mock;
    postMock
      .mockRejectedValueOnce(axios429())
      .mockRejectedValueOnce(axios429())
      .mockResolvedValueOnce({ data: { present: true, checked: true } });

    const file = new File([new Uint8Array([1, 2, 3])], "frame.jpg", { type: "image/jpeg" });
    const promise = prescreenPatientExitSiteImage(file);

    await jest.advanceTimersByTimeAsync(400);
    await jest.advanceTimersByTimeAsync(800);

    await expect(promise).resolves.toEqual({ present: true, checked: true });
    expect(postMock).toHaveBeenCalledTimes(3);
  });

  it("gives up after 429 retries are exhausted", async () => {
    const postMock = apiClient.post as jest.Mock;
    const error = axios429();
    postMock.mockRejectedValue(error);

    const file = new File([new Uint8Array([1, 2, 3])], "frame.jpg", { type: "image/jpeg" });
    const promise = prescreenPatientExitSiteImage(file);
    const expectation = expect(promise).rejects.toBe(error);

    await jest.advanceTimersByTimeAsync(400);
    await jest.advanceTimersByTimeAsync(800);
    await expectation;
    expect(postMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry non-429 errors", async () => {
    const postMock = apiClient.post as jest.Mock;
    const error = new AxiosError("Server Error", "ERR_BAD_RESPONSE", undefined, undefined, {
      status: 500,
      statusText: "Internal Server Error",
      headers: {},
      config: {} as never,
      data: {},
    });
    postMock.mockRejectedValueOnce(error);

    const file = new File([new Uint8Array([1, 2, 3])], "frame.jpg", { type: "image/jpeg" });
    await expect(prescreenPatientExitSiteImage(file)).rejects.toBe(error);
    expect(postMock).toHaveBeenCalledTimes(1);
  });

  it("aborts during 429 backoff without waiting for the full timer", async () => {
    const postMock = apiClient.post as jest.Mock;
    postMock.mockRejectedValueOnce(axios429());

    const controller = new AbortController();
    const file = new File([new Uint8Array([1, 2, 3])], "frame.jpg", { type: "image/jpeg" });
    const promise = prescreenPatientExitSiteImage(file, { signal: controller.signal });
    const expectation = expect(promise).rejects.toMatchObject({ name: "AbortError" });

    await Promise.resolve();
    controller.abort();
    await expectation;
    expect(postMock).toHaveBeenCalledTimes(1);
  });
});
