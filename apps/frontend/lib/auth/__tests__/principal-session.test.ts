import { getPrincipalSession, setPrincipalSession } from "@/lib/auth/principal-session";

describe("principal session legacy migration", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  test("migrates legacy patient session into principal session", () => {
    window.localStorage.setItem(
      "pdCare.patientSession",
      JSON.stringify({
        accessToken: "patient-token",
        expiresAt: Date.now() + 60_000,
        role: "patient",
        lineUserId: "U_PATIENT",
      })
    );

    const session = getPrincipalSession();

    expect(session).toEqual(
      expect.objectContaining({
        accessToken: "patient-token",
        role: "patient",
        lineUserId: "U_PATIENT",
        allowedApps: ["patient"],
      })
    );
    expect(window.localStorage.getItem("pdCare.principalSession")).not.toBeNull();
    expect(window.localStorage.getItem("pdCare.patientSession")).toBeNull();
  });

  test("merges legacy staff and patient sessions into allowed apps", () => {
    window.localStorage.setItem(
      "pdCare.staffSession",
      JSON.stringify({
        accessToken: "staff-token",
        expiresAt: Date.now() + 30_000,
        role: "staff",
        lineUserId: "U_STAFF",
      })
    );
    window.localStorage.setItem(
      "pdCare.patientSession",
      JSON.stringify({
        accessToken: "patient-token",
        expiresAt: Date.now() + 60_000,
        role: "patient",
        lineUserId: "U_PATIENT",
      })
    );

    const session = getPrincipalSession();

    expect(session?.allowedApps).toEqual(expect.arrayContaining(["admin", "patient"]));
    expect(window.localStorage.getItem("pdCare.staffSession")).toBeNull();
    expect(window.localStorage.getItem("pdCare.patientSession")).toBeNull();
  });

  test("clears expired legacy sessions without creating a principal session", () => {
    window.localStorage.setItem(
      "pdCare.staffSession",
      JSON.stringify({
        accessToken: "expired-token",
        expiresAt: Date.now() - 1,
        role: "staff",
        lineUserId: "U_OLD",
      })
    );

    expect(getPrincipalSession()).toBeNull();
    expect(window.localStorage.getItem("pdCare.principalSession")).toBeNull();
    expect(window.localStorage.getItem("pdCare.staffSession")).toBeNull();
  });

  test("keeps existing principal session and drops leftover legacy keys", () => {
    setPrincipalSession({
      accessToken: "principal-token",
      expiresAt: Date.now() + 60_000,
      role: "admin",
      lineUserId: "U_ADMIN",
      allowedApps: ["admin"],
    });
    window.localStorage.setItem(
      "pdCare.patientSession",
      JSON.stringify({
        accessToken: "patient-token",
        expiresAt: Date.now() + 60_000,
        role: "patient",
        lineUserId: "U_PATIENT",
      })
    );

    const session = getPrincipalSession();

    expect(session?.accessToken).toBe("principal-token");
    expect(window.localStorage.getItem("pdCare.patientSession")).toBeNull();
  });
});
