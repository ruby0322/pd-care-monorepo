export const DEFAULT_PATIENT_PATH = "/patient";
export const DEFAULT_STAFF_PATH = "/apps";
export const DEFAULT_ADMIN_INTENT_PATH = "/admin";

export function isAdminRoute(path: string | null): boolean {
  if (!path) {
    return false;
  }
  return path.startsWith("/admin");
}

export function isPatientRoute(path: string | null): boolean {
  if (!path) {
    return false;
  }
  return path === DEFAULT_PATIENT_PATH || path.startsWith(`${DEFAULT_PATIENT_PATH}/`);
}

export function shouldRedirectPatientToNoPermission(nextPath: string | null, role: string): boolean {
  return role === "patient" && isAdminRoute(nextPath);
}

export function resolvePatientLoginDestination(nextPath: string | null): string {
  return nextPath && isPatientRoute(nextPath) ? nextPath : DEFAULT_PATIENT_PATH;
}

export function resolveStaffLoginDestination(nextPath: string | null): string {
  return nextPath ?? DEFAULT_STAFF_PATH;
}

export function buildNoPermissionRedirect(nextPath: string | null): string {
  const redirectNext = encodeURIComponent(nextPath ?? DEFAULT_ADMIN_INTENT_PATH);
  return `/no-permission?next=${redirectNext}`;
}

export type LoginFailureRedirect =
  | { type: "home" }
  | { type: "no-permission"; href: string }
  | { type: "inline-error" };

export function resolveLoginFailureRedirect(nextPath: string | null): LoginFailureRedirect {
  if (!nextPath) {
    return { type: "home" };
  }
  if (isAdminRoute(nextPath)) {
    return { type: "no-permission", href: buildNoPermissionRedirect(nextPath) };
  }
  return { type: "inline-error" };
}
