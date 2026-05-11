"use client";

type PatientRole = "patient" | "admin";

type PatientSession = {
  accessToken: string;
  expiresAt: number;
  role: PatientRole;
  lineUserId: string;
};

const PATIENT_SESSION_STORAGE_KEY = "pdCare.patientSession";

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function parseSession(raw: string | null): PatientSession | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<PatientSession>;
    if (!parsed.accessToken || !parsed.expiresAt || !parsed.role || !parsed.lineUserId) {
      return null;
    }
    if (parsed.role !== "patient" && parsed.role !== "admin") {
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

export function getPatientSession(): PatientSession | null {
  if (!isBrowser()) {
    return null;
  }
  const session = parseSession(window.localStorage.getItem(PATIENT_SESSION_STORAGE_KEY));
  if (!session) {
    return null;
  }
  if (Date.now() >= session.expiresAt) {
    clearPatientSession();
    return null;
  }
  return session;
}

export function setPatientSession(session: PatientSession): void {
  if (!isBrowser()) {
    return;
  }
  window.localStorage.setItem(PATIENT_SESSION_STORAGE_KEY, JSON.stringify(session));
}

export function clearPatientSession(): void {
  if (!isBrowser()) {
    return;
  }
  window.localStorage.removeItem(PATIENT_SESSION_STORAGE_KEY);
}

export function getPatientAccessToken(): string | null {
  return getPatientSession()?.accessToken ?? null;
}
