"use client";

import {
  canAccessApp,
  clearAuthState,
  getAppAccessToken,
  getPrincipalSession,
  setPrincipalSession,
  type AllowedApp,
} from "@/lib/auth/principal-session";

type PatientRole = "patient" | "staff" | "admin";

type PatientSession = {
  accessToken: string;
  expiresAt: number;
  role: PatientRole;
  lineUserId: string;
};

export function getPatientSession(): PatientSession | null {
  if (!canAccessApp("patient")) {
    return null;
  }
  const session = getPrincipalSession();
  if (!session) {
    return null;
  }
  return {
    accessToken: session.accessToken,
    expiresAt: session.expiresAt,
    role: session.role,
    lineUserId: session.lineUserId,
  };
}

export function setPatientSession(session: PatientSession): void {
  const existing = getPrincipalSession();
  const nextAllowedApps = new Set<AllowedApp>(existing?.allowedApps ?? []);
  nextAllowedApps.add("patient");
  setPrincipalSession({
    accessToken: session.accessToken,
    expiresAt: session.expiresAt,
    role: session.role,
    lineUserId: session.lineUserId,
    allowedApps: Array.from(nextAllowedApps),
  });
}

export function clearPatientSession(): void {
  const existing = getPrincipalSession();
  if (!existing) {
    return;
  }
  const nextAllowedApps = existing.allowedApps.filter((app) => app !== "patient");
  if (nextAllowedApps.length === 0) {
    clearAuthState();
    return;
  }
  setPrincipalSession({
    ...existing,
    allowedApps: nextAllowedApps,
  });
}

export function getPatientAccessToken(): string | null {
  return getAppAccessToken("patient");
}
