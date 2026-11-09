import { AxiosError } from "axios";

import { getApiErrorDetail, getReadableApiError } from "@/lib/api/client";

function errorWith(status: number, data: unknown): AxiosError {
  const error = new AxiosError(`Request failed with status code ${status}`);
  // Only `response` is read, so this is the whole shape that matters here.
  Object.defineProperty(error, "response", {
    value: { status, data },
    enumerable: true,
  });
  return error;
}

describe("getApiErrorDetail", () => {
  it("reads pydantic's list-shaped detail, rather than reporting a bare HTTP 422", () => {
    const error = errorWith(422, {
      detail: [
        {
          type: "value_error",
          loc: ["body", "html"],
          msg: "Value error, html exceeds the 512 KB limit for a saved module",
        },
      ],
    });

    expect(getApiErrorDetail(error)).toBe("html exceeds the 512 KB limit for a saved module");
    expect(getReadableApiError(error)).not.toMatch(/HTTP 422/);
  });

  it("joins several validation issues", () => {
    const error = errorWith(422, {
      detail: [
        { loc: ["body", "title"], msg: "String should have at least 1 character" },
        { loc: ["body", "html"], msg: "Value error, html is too large" },
      ],
    });

    expect(getApiErrorDetail(error)).toBe("String should have at least 1 character；html is too large");
  });

  it("still falls back to the status when the list carries nothing readable", () => {
    expect(getApiErrorDetail(errorWith(422, { detail: [{ loc: ["body"] }] }))).toBe("HTTP 422");
  });

  it("leaves the string and {message} shapes alone", () => {
    expect(getApiErrorDetail(errorWith(422, { detail: "分享的模組必須即時查詢資料" }))).toBe(
      "分享的模組必須即時查詢資料",
    );
    expect(getApiErrorDetail(errorWith(403, { detail: { code: "forbidden", message: "沒有權限" } }))).toBe("沒有權限");
  });
});
