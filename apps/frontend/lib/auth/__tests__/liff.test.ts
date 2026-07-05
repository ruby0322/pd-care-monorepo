import { buildLoginPath, readSafeNextPath, redirectToLiffLogin } from "@/lib/auth/liff";

describe("liff login redirect helpers", () => {
  it("builds /login redirect path with encoded next", () => {
    expect(buildLoginPath("/patient/capture?draft=1")).toBe("/login?next=%2Fpatient%2Fcapture%3Fdraft%3D1");
  });

  it("rejects unsafe or recursive next path values", () => {
    expect(readSafeNextPath("//evil.com")).toBeNull();
    expect(readSafeNextPath("https://evil.com")).toBeNull();
    expect(readSafeNextPath("/login")).toBeNull();
  });

  it("redirects to /login with next path", () => {
    const replaceSpy = jest.spyOn(window.location, "replace").mockImplementation(() => undefined);
    expect(() => redirectToLiffLogin("/patient/messages")).toThrow("正在導向登入頁面...");
    expect(replaceSpy).toHaveBeenCalledWith("/login?next=%2Fpatient%2Fmessages");
    replaceSpy.mockRestore();
  });
});
