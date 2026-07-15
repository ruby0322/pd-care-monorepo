"use client";

import {
  canAccessApp,
  clearAuthState,
  getAppAccessToken,
  getPrincipalSession,
  setPrincipalSession,
  type AllowedApp,
} from "@/lib/auth/principal-session";

type StaffRole = "staff" | "admin";

type StaffSession = {
  accessToken: string;
  expiresAt: number;
  role: StaffRole;
  lineUserId: string;
};

export function getStaffSession(): StaffSession | null {
  if (!canAccessApp("admin")) {
    return null;
  }
  const session = getPrincipalSession();
  if (!session || (session.role !== "staff" && session.role !== "admin")) {
    return null;
  }
  return {
    accessToken: session.accessToken,
    expiresAt: session.expiresAt,
    role: session.role,
    lineUserId: session.lineUserId,
  };
}

export function setStaffSession(session: StaffSession): void {
  const existing = getPrincipalSession();
  const nextAllowedApps = new Set<AllowedApp>(existing?.allowedApps ?? []);
  nextAllowedApps.add("admin");
  setPrincipalSession({
    accessToken: session.accessToken,
    expiresAt: session.expiresAt,
    role: session.role,
    lineUserId: session.lineUserId,
    allowedApps: Array.from(nextAllowedApps),
  });
}

export function clearStaffSession(): void {
  const existing = getPrincipalSession();
  if (!existing) {
    return;
  }
  const nextAllowedApps = existing.allowedApps.filter((app) => app !== "admin");
  if (nextAllowedApps.length === 0) {
    clearAuthState();
    return;
  }
  setPrincipalSession({
    ...existing,
    allowedApps: nextAllowedApps,
  });
}

export function getStaffAccessToken(): string | null {
  return getAppAccessToken("admin");
}

export function getStaffRole(): StaffRole | null {
  return getStaffSession()?.role ?? null;
}
