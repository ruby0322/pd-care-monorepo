import { buildLoginPath, getLiffLoginProof, readSafeNextPath, redirectToLiffLogin } from "@/lib/auth/liff";

describe("liff login redirect helpers", () => {
  it("builds /login redirect path with encoded next", () => {
    expect(buildLoginPath("/patient/capture?draft=1")).toBe("/login?next=%2Fpatient%2Fcapture%3Fdraft%3D1");
  });

  it("rejects unsafe or recursive next path values", () => {
    expect(readSafeNextPath("//evil.com")).toBeNull();
    expect(readSafeNextPath("https://evil.com")).toBeNull();
    expect(readSafeNextPath("/login")).toBeNull();
  });

  it("throws after initiating login redirect", () => {
    // jsdom does not allow mocking window.location.replace; URL shape is covered by buildLoginPath.
    expect(() => redirectToLiffLogin("/patient/messages")).toThrow("正在導向登入頁面...");
  });
});

describe("dev bypass login proof", () => {
  afterEach(() => {
    window.localStorage.removeItem("pdCare.devLineUserId");
    delete (window as unknown as { liff?: unknown }).liff;
  });

  it("returns a backend-verifiable stub token for the dev bypass user, skipping the LIFF SDK", async () => {
    jest.replaceProperty(process.env, "NODE_ENV", "development");
    delete process.env.NEXT_PUBLIC_LIFF_ID;
    window.localStorage.setItem("pdCare.devLineUserId", "U_DEV_ADMIN");

    const proof = await getLiffLoginProof();

    expect(proof).toEqual({
      profile: expect.objectContaining({ userId: "U_DEV_ADMIN" }),
      idToken: "stub:U_DEV_ADMIN",
    });
    expect(window.liff).toBeUndefined();
  });
});
