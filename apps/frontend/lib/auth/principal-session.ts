"use client";

export type PrincipalRole = "patient" | "staff" | "admin";
export type AllowedApp = "patient" | "admin";
export type ActiveApp = AllowedApp | null;

export type PrincipalSession = {
  accessToken: string;
  expiresAt: number;
  role: PrincipalRole;
  lineUserId: string;
  allowedApps: AllowedApp[];
};

const PRINCIPAL_SESSION_STORAGE_KEY = "pdCare.principalSession";
const ACTIVE_APP_STORAGE_KEY = "pdCare.activeApp";

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function parseSession(raw: string | null): PrincipalSession | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<PrincipalSession>;
    if (!parsed.accessToken || !parsed.expiresAt || !parsed.role || !parsed.lineUserId || !parsed.allowedApps) {
      return null;
    }
    if (parsed.role !== "patient" && parsed.role !== "staff" && parsed.role !== "admin") {
      return null;
    }
    const apps = Array.isArray(parsed.allowedApps)
      ? parsed.allowedApps.filter((app): app is AllowedApp => app === "patient" || app === "admin")
      : [];
    const dedupedApps = Array.from(new Set(apps));
    return {
      accessToken: parsed.accessToken,
      expiresAt: parsed.expiresAt,
      role: parsed.role,
      lineUserId: parsed.lineUserId,
      allowedApps: dedupedApps,
    };
  } catch {
    return null;
  }
}

function normalizeAllowedApps(session: PrincipalSession): AllowedApp[] {
  const allowed = new Set<AllowedApp>(session.allowedApps);
  if (session.role === "staff" || session.role === "admin") {
    allowed.add("admin");
  }
  if (session.role === "patient") {
    allowed.add("patient");
  }
  return Array.from(allowed);
}

export function getPrincipalSession(): PrincipalSession | null {
  if (!isBrowser()) {
    return null;
  }
  const session = parseSession(window.localStorage.getItem(PRINCIPAL_SESSION_STORAGE_KEY));
  if (!session) {
    return null;
  }
  if (Date.now() >= session.expiresAt) {
    clearAuthState();
    return null;
  }
  return {
    ...session,
    allowedApps: normalizeAllowedApps(session),
  };
}

export function setPrincipalSession(session: PrincipalSession): void {
  if (!isBrowser()) {
    return;
  }
  const normalized = {
    ...session,
    allowedApps: normalizeAllowedApps(session),
  };
  window.localStorage.setItem(PRINCIPAL_SESSION_STORAGE_KEY, JSON.stringify(normalized));
}

export function clearPrincipalSession(): void {
  if (!isBrowser()) {
    return;
  }
  window.localStorage.removeItem(PRINCIPAL_SESSION_STORAGE_KEY);
}

export function canAccessApp(app: AllowedApp): boolean {
  const session = getPrincipalSession();
  if (!session) {
    return false;
  }
  return session.allowedApps.includes(app);
}

export function getActiveApp(): ActiveApp {
  if (!isBrowser()) {
    return null;
  }
  const value = window.localStorage.getItem(ACTIVE_APP_STORAGE_KEY);
  return value === "patient" || value === "admin" ? value : null;
}

export function setActiveApp(app: ActiveApp): void {
  if (!isBrowser()) {
    return;
  }
  if (app === null) {
    window.localStorage.removeItem(ACTIVE_APP_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(ACTIVE_APP_STORAGE_KEY, app);
}

export function clearAuthState(): void {
  clearPrincipalSession();
  setActiveApp(null);
}

export function getAppAccessToken(app: AllowedApp): string | null {
  if (!canAccessApp(app)) {
    return null;
  }
  return getPrincipalSession()?.accessToken ?? null;
}
