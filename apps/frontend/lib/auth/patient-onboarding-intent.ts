export const PATIENT_ONBOARDING_INTENT = "register-patient";

export function buildPatientOnboardingPath(withIntent: boolean): string {
  if (!withIntent) {
    return "/onboarding/patient";
  }
  return `/onboarding/patient?intent=${PATIENT_ONBOARDING_INTENT}`;
}
