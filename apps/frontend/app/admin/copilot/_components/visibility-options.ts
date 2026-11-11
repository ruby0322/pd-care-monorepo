import type { CopilotVisibility } from "@/lib/api/copilot";

/**
 * Who a session or module can be shown to, and which of those choices an admin alone may
 * make. One list, because the backend rejects a visibility the role is not allowed to set
 * (`assert_visibility_allowed`) and a second copy of this gating would drift from it.
 */
export const VISIBILITY_OPTIONS: Array<{
  value: CopilotVisibility;
  label: string;
  hint: string;
  adminOnly?: boolean;
}> = [
  { value: "private", label: "僅自己可見", hint: "只有你能看到。" },
  { value: "staff", label: "護理師與管理員可見", hint: "其他護理師與管理員可唯讀檢視。" },
  { value: "admin", label: "僅管理員可見", hint: "只有管理員可唯讀檢視。", adminOnly: true },
];

/** The choices one role may actually pick. */
export function visibilityOptionsFor(role: "staff" | "admin") {
  return VISIBILITY_OPTIONS.filter((option) => role === "admin" || !option.adminOnly);
}
