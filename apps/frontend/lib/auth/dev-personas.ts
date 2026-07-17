import { buildLoginPath, isLiffDevBypassActive, setDevBypassLineUserId } from "@/lib/auth/liff";
import { clearAuthState } from "@/lib/auth/principal-session";

export type DevPersona = {
  id: string;
  label: string;
  description: string;
  /** Safe next path after login, or null to let bootstrap choose. */
  nextPath: string | null;
};

/** Mirrors apps/backend/sql/manual/seed_dev_personas.py */
export const DEV_PERSONAS: readonly DevPersona[] = [
  {
    id: "U_DEV_NEW",
    label: "新用戶",
    description: "尚無身分 → role-select / onboarding",
    nextPath: "/role-select",
  },
  {
    id: "U_DEV_PAT_PEND",
    label: "待審核病患",
    description: "patient + pending_bindings",
    nextPath: "/patient",
  },
  {
    id: "U_DEV_PAT_MATCH",
    label: "已綁定病患",
    description: "matched patient dashboard",
    nextPath: "/patient",
  },
  {
    id: "U_DEV_STAFF",
    label: "護理師 (staff)",
    description: "active staff → /apps",
    nextPath: "/apps",
  },
  {
    id: "U_DEV_ADMIN",
    label: "管理員 (admin)",
    description: "active admin → /apps 或 /admin",
    nextPath: "/admin",
  },
  {
    id: "U_DEV_DUAL",
    label: "雙重身分",
    description: "admin + matched patient → /apps 兩張卡",
    nextPath: "/apps",
  },
] as const;

export function buildDevPersonaLoginPath(persona: DevPersona): string {
  const base = buildLoginPath(persona.nextPath);
  const url = new URL(base, "http://localhost");
  url.searchParams.set("dev_line_user_id", persona.id);
  return `${url.pathname}${url.search}`;
}

/**
 * Clear sticky sessions, pin the persona, and return the login URL to navigate to.
 * Only valid when LIFF bypass is active.
 */
export function prepareDevPersonaSwitch(persona: DevPersona): string {
  if (!isLiffDevBypassActive()) {
    throw new Error("Dev personas are only available when LIFF bypass is active.");
  }
  clearAuthState();
  setDevBypassLineUserId(persona.id);
  return buildDevPersonaLoginPath(persona);
}
