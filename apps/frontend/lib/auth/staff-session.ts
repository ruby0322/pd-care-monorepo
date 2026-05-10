"use client";

type StaffRole = "staff" | "admin";

type StaffSession = {
  accessToken: string;
  expiresAt: number;
  role: StaffRole;
  lineUserId: string;
};

const STAFF_SESSION_STORAGE_KEY = "pdCare.staffSession";

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function parseSession(raw: string | null): StaffSession | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<StaffSession>;
    if (!parsed.accessToken || !parsed.expiresAt || !parsed.role || !parsed.lineUserId) {
      return null;
    }
    if (parsed.role !== "staff" && parsed.role !== "admin") {
      return null;
    }
    return {
      accessToken: parsed.accessToken,
      expiresAt: parsed.expiresAt,
      role: parsed.role,
      lineUserId: parsed.lineUserId,
    };
  } catch {
    return null;
  }
}

export function getStaffSession(): StaffSession | null {
  if (!isBrowser()) {
    return null;
  }
  const session = parseSession(window.localStorage.getItem(STAFF_SESSION_STORAGE_KEY));
  if (!session) {
    return null;
  }
  if (Date.now() >= session.expiresAt) {
    clearStaffSession();
    return null;
  }
  return session;
}

export function setStaffSession(session: StaffSession): void {
  if (!isBrowser()) {
    return;
  }
  window.localStorage.setItem(STAFF_SESSION_STORAGE_KEY, JSON.stringify(session));
}

export function clearStaffSession(): void {
  if (!isBrowser()) {
    return;
  }
  window.localStorage.removeItem(STAFF_SESSION_STORAGE_KEY);
}

export function getStaffAccessToken(): string | null {
  return getStaffSession()?.accessToken ?? null;
}

export function getStaffRole(): StaffRole | null {
  return getStaffSession()?.role ?? null;
}
