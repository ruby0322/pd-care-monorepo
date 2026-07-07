import { renderHook } from "@testing-library/react";

import { useClientSnapshot } from "@/lib/utils/use-client-snapshot";

describe("useClientSnapshot", () => {
  it("returns the client snapshot once mounted in the browser", () => {
    const { result } = renderHook(() => useClientSnapshot(() => "client-value", "server-value"));

    expect(result.current).toBe("client-value");
  });

  it("re-reads the snapshot getter on re-render", () => {
    let value = "first";
    const { result, rerender } = renderHook(() => useClientSnapshot(() => value, "server-value"));

    expect(result.current).toBe("first");

    value = "second";
    rerender();

    expect(result.current).toBe("second");
  });
});
