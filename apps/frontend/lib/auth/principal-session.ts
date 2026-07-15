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
const STAFF_SESSION_STORAGE_KEY = "pdCare.staffSession";
const PATIENT_SESSION_STORAGE_KEY = "pdCare.patientSession";

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

type LegacySession = {
  accessToken: string;
  expiresAt: number;
  role: PrincipalRole;
  lineUserId: string;
  allowedApp: AllowedApp;
};

function parseLegacySession(raw: string | null, allowedApp: AllowedApp): LegacySession | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<PrincipalSession>;
    if (!parsed.accessToken || !parsed.expiresAt || !parsed.role || !parsed.lineUserId) {
      return null;
    }
    if (parsed.role !== "patient" && parsed.role !== "staff" && parsed.role !== "admin") {
      return null;
    }
    return {
      accessToken: parsed.accessToken,
      expiresAt: parsed.expiresAt,
      role: parsed.role,
      lineUserId: parsed.lineUserId,
      allowedApp,
    };
  } catch {
    return null;
  }
}

function clearLegacySessions(): void {
  window.localStorage.removeItem(STAFF_SESSION_STORAGE_KEY);
  window.localStorage.removeItem(PATIENT_SESSION_STORAGE_KEY);
}

function migrateLegacySessions(): PrincipalSession | null {
  const existing = parseSession(window.localStorage.getItem(PRINCIPAL_SESSION_STORAGE_KEY));
  if (existing) {
    clearLegacySessions();
    return existing;
  }

  const legacyCandidates = [
    parseLegacySession(window.localStorage.getItem(STAFF_SESSION_STORAGE_KEY), "admin"),
    parseLegacySession(window.localStorage.getItem(PATIENT_SESSION_STORAGE_KEY), "patient"),
  ]
    .filter((candidate): candidate is LegacySession => candidate !== null)
    .filter((candidate) => Date.now() < candidate.expiresAt);

  clearLegacySessions();
  if (legacyCandidates.length === 0) {
    return null;
  }

  const base = [...legacyCandidates].sort((a, b) => b.expiresAt - a.expiresAt)[0];
  const allowedApps = Array.from(new Set(legacyCandidates.map((candidate) => candidate.allowedApp)));
  const migratedSession: PrincipalSession = {
    accessToken: base.accessToken,
    expiresAt: base.expiresAt,
    role: base.role,
    lineUserId: base.lineUserId,
    allowedApps,
  };
  setPrincipalSession(migratedSession);
  return migratedSession;
}

export function getPrincipalSession(): PrincipalSession | null {
  if (!isBrowser()) {
    return null;
  }
  const existing = parseSession(window.localStorage.getItem(PRINCIPAL_SESSION_STORAGE_KEY));
  if (existing) {
    clearLegacySessions();
  }
  const session = existing ?? migrateLegacySessions();
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
