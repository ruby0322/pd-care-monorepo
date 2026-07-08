import {
  isAdminIntent,
  isPatientRoute,
  resolveBootstrapDestination,
  resolveRoleSelectDestination,
} from "@/lib/auth/bootstrap-routing";

describe("bootstrap routing helpers", () => {
  it("detects admin and patient route intents", () => {
    expect(isAdminIntent("/apps")).toBe(true);
    expect(isAdminIntent("/admin/review-fast")).toBe(true);
    expect(isAdminIntent("/patient")).toBe(false);

    expect(isPatientRoute("/patient")).toBe(true);
    expect(isPatientRoute("/patient/messages")).toBe(true);
    expect(isPatientRoute("/apps")).toBe(false);
  });

  it("maps role-select destinations from next path intent", () => {
    expect(resolveRoleSelectDestination("/apps")).toBe("/onboarding/admin");
    expect(resolveRoleSelectDestination("/patient/capture")).toBe("/onboarding/patient");
    expect(resolveRoleSelectDestination(null)).toBe("/");
  });

  it("resolves destination for each bootstrap step", () => {
    expect(resolveBootstrapDestination("role_select")).toBe("/");
    expect(resolveBootstrapDestination("onboarding_patient")).toBe("/onboarding/patient");
    expect(resolveBootstrapDestination("onboarding_admin")).toBe("/onboarding/admin");
    expect(resolveBootstrapDestination("patient_app")).toBe("/patient");
    expect(resolveBootstrapDestination("app_selection")).toBe("/apps");
  });

  it("supports destination overrides by route context", () => {
    expect(
      resolveBootstrapDestination("role_select", {
        roleSelectDestination: "/role-select",
      })
    ).toBe("/role-select");
    expect(
      resolveBootstrapDestination("patient_app", {
        patientAppDestination: "/login?next=%2Fpatient",
      })
    ).toBe("/login?next=%2Fpatient");
    expect(
      resolveBootstrapDestination("app_selection", {
        appSelectionDestination: "/login?next=%2Fapps",
      })
    ).toBe("/login?next=%2Fapps");
  });
});
