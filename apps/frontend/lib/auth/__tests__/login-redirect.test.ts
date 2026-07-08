import {
  buildNoPermissionRedirect,
  isAdminRoute,
  isPatientRoute,
  resolveLoginFailureRedirect,
  resolvePatientLoginDestination,
  resolveStaffLoginDestination,
  shouldRedirectPatientToNoPermission,
} from "@/lib/auth/login-redirect";

describe("login redirect helpers", () => {
  it("classifies admin and patient routes", () => {
    expect(isAdminRoute("/admin")).toBe(true);
    expect(isAdminRoute("/admin/patients")).toBe(true);
    expect(isAdminRoute("/apps")).toBe(false);
    expect(isAdminRoute(null)).toBe(false);

    expect(isPatientRoute("/patient")).toBe(true);
    expect(isPatientRoute("/patient/capture")).toBe(true);
    expect(isPatientRoute("/apps")).toBe(false);
    expect(isPatientRoute(null)).toBe(false);
  });

  it("resolves post-login destinations", () => {
    expect(resolveStaffLoginDestination(null)).toBe("/apps");
    expect(resolveStaffLoginDestination("/admin/patients")).toBe("/admin/patients");

    expect(resolvePatientLoginDestination(null)).toBe("/patient");
    expect(resolvePatientLoginDestination("/apps")).toBe("/patient");
    expect(resolvePatientLoginDestination("/patient/capture")).toBe("/patient/capture");
  });

  it("routes admin-intent patient logins to no-permission", () => {
    expect(shouldRedirectPatientToNoPermission("/admin", "patient")).toBe(true);
    expect(shouldRedirectPatientToNoPermission("/apps", "patient")).toBe(false);
    expect(shouldRedirectPatientToNoPermission("/admin", "staff")).toBe(false);
  });

  it("builds no-permission redirect links", () => {
    expect(buildNoPermissionRedirect("/admin")).toBe("/no-permission?next=%2Fadmin");
    expect(buildNoPermissionRedirect(null)).toBe("/no-permission?next=%2Fadmin");
  });

  it("resolves permission-denied redirects by next path", () => {
    expect(resolveLoginFailureRedirect(null)).toEqual({ type: "home" });
    expect(resolveLoginFailureRedirect("/admin")).toEqual({
      type: "no-permission",
      href: "/no-permission?next=%2Fadmin",
    });
    expect(resolveLoginFailureRedirect("/apps")).toEqual({ type: "inline-error" });
    expect(resolveLoginFailureRedirect("/patient")).toEqual({ type: "inline-error" });
  });
});
