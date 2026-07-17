import { DEV_PERSONAS, buildDevPersonaLoginPath, prepareDevPersonaSwitch } from "@/lib/auth/dev-personas";

describe("dev personas", () => {
  afterEach(() => {
    window.localStorage.clear();
    delete process.env.NEXT_PUBLIC_LIFF_ID;
  });

  it("builds login paths with persona query and optional next", () => {
    const admin = DEV_PERSONAS.find((p) => p.id === "U_DEV_ADMIN");
    expect(admin).toBeDefined();
    expect(buildDevPersonaLoginPath(admin!)).toBe(
      "/login?next=%2Fadmin&dev_line_user_id=U_DEV_ADMIN"
    );

    const newbie = DEV_PERSONAS.find((p) => p.id === "U_DEV_NEW");
    expect(buildDevPersonaLoginPath(newbie!)).toBe(
      "/login?next=%2Frole-select&dev_line_user_id=U_DEV_NEW"
    );
  });

  it("clears auth state and pins persona when bypass is active", () => {
    jest.replaceProperty(process.env, "NODE_ENV", "development");
    delete process.env.NEXT_PUBLIC_LIFF_ID;
    window.localStorage.setItem("pdCare.principalSession", JSON.stringify({ keep: false }));
    window.localStorage.setItem("pdCare.activeApp", "admin");

    const staff = DEV_PERSONAS.find((p) => p.id === "U_DEV_STAFF")!;
    const path = prepareDevPersonaSwitch(staff);

    expect(path).toBe("/login?next=%2Fapps&dev_line_user_id=U_DEV_STAFF");
    expect(window.localStorage.getItem("pdCare.principalSession")).toBeNull();
    expect(window.localStorage.getItem("pdCare.activeApp")).toBeNull();
    expect(window.localStorage.getItem("pdCare.devLineUserId")).toBe("U_DEV_STAFF");
  });

  it("refuses persona switch when LIFF id is set", () => {
    jest.replaceProperty(process.env, "NODE_ENV", "development");
    process.env.NEXT_PUBLIC_LIFF_ID = "1657724367-uzPg8SgK";
    const admin = DEV_PERSONAS.find((p) => p.id === "U_DEV_ADMIN")!;
    expect(() => prepareDevPersonaSwitch(admin)).toThrow(/LIFF bypass/);
  });
});
