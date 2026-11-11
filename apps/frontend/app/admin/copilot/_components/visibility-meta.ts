import { Lock, Shield, Users } from "lucide-react";

import type { CopilotVisibility } from "@/lib/api/copilot";

/**
 * How a scope is shown in a list or on a badge: the short label, its icon, and the tint.
 *
 * Short on purpose, and separate from `visibility-options.ts`: that file holds the longer
 * sentences a picker needs ("護理師與管理員可見，其他護理師可唯讀檢視") and the rule about which
 * role may choose what. This one is for places where the scope is a chip beside a title.
 */
export const VISIBILITY_META: Record<
  CopilotVisibility,
  { label: string; Icon: typeof Lock; badgeClass: string }
> = {
  private: { label: "僅自己", Icon: Lock, badgeClass: "bg-zinc-100 text-zinc-600" },
  staff: { label: "護理師可見", Icon: Users, badgeClass: "bg-blue-50 text-blue-700" },
  admin: { label: "管理員可見", Icon: Shield, badgeClass: "bg-amber-50 text-amber-700" },
};
