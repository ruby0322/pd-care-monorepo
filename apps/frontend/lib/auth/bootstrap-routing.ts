import { AuthBootstrapNextStep } from "@/lib/api/identity";
import { buildLoginPath } from "@/lib/auth/liff";

export function isAdminIntent(path: string | null): boolean {
  if (!path) {
    return false;
  }
  return path === "/apps" || path.startsWith("/admin");
}

export function isPatientRoute(path: string | null): boolean {
  if (!path) {
    return false;
  }
  return path === "/patient" || path.startsWith("/patient/");
}

export function resolveRoleSelectDestination(nextPath: string | null): string {
  if (isPatientRoute(nextPath)) {
    return "/onboarding/patient";
  }
  if (isAdminIntent(nextPath)) {
    return "/onboarding/admin";
  }
  return "/";
}

type BootstrapDestinationOptions = {
  roleSelectDestination?: string;
  onboardingPatientDestination?: string;
  onboardingAdminDestination?: string;
  patientAppDestination?: string;
  appSelectionDestination?: string;
  fallbackDestination?: string;
};

export function resolveBootstrapDestination(
  nextStep: AuthBootstrapNextStep,
  options: BootstrapDestinationOptions = {}
): string {
  if (nextStep === "role_select") {
    return options.roleSelectDestination ?? "/";
  }
  if (nextStep === "onboarding_patient") {
    return options.onboardingPatientDestination ?? "/onboarding/patient";
  }
  if (nextStep === "onboarding_admin") {
    return options.onboardingAdminDestination ?? "/onboarding/admin";
  }
  if (nextStep === "patient_app") {
    return options.patientAppDestination ?? "/patient";
  }
  if (nextStep === "app_selection") {
    return options.appSelectionDestination ?? "/apps";
  }
  return options.fallbackDestination ?? "/";
}

export function resolveSessionlessBootstrapDestination(
  nextStep: AuthBootstrapNextStep,
  options: { roleSelectDestination?: string } = {}
): string {
  const sharedOptions = {
    roleSelectDestination: options.roleSelectDestination ?? "/",
  };

  if (nextStep === "patient_app") {
    return resolveBootstrapDestination(nextStep, {
      ...sharedOptions,
      patientAppDestination: buildLoginPath("/patient"),
    });
  }

  if (nextStep === "app_selection") {
    return resolveBootstrapDestination(nextStep, {
      ...sharedOptions,
      appSelectionDestination: buildLoginPath("/apps"),
    });
  }

  return resolveBootstrapDestination(nextStep, sharedOptions);
}
