/**
 * Named blog screenshot catalog.
 *
 * New articles should reuse these files in MDX (`/blog/<file>`). Add a shot
 * here only when a post needs a screen that is not already in the catalog.
 */

export const BLOG_PHONE_VIEWPORT = {
  width: 390,
  height: 844,
  deviceScaleFactor: 2,
} as const;

/** Mirrors apps/backend/sql/manual/seed_dev_personas.py bindable patient. */
export const BINDABLE_PATIENT = {
  caseNumber: "P-DEV-BIND-001",
  birthDate: "1990-01-01",
} as const;

export type BlogShotId =
  | "role-select"
  | "bind"
  | "pending"
  | "home"
  | "home-photos"
  | "gallery"
  | "gallery-calendar"
  | "capture"
  | "result";

export type BlogShot = {
  id: BlogShotId;
  file: string;
  description: string;
  /**
   * Shots that share a flow run in one login/session. Independent shots omit this.
   */
  flow?: "patient-capture" | "patient-gallery";
};

export const BLOG_SHOT_CATALOG: readonly BlogShot[] = [
  {
    id: "role-select",
    file: "shot-role-select.png",
    description: "身份選擇：我是病患 / 我是醫護",
  },
  {
    id: "bind",
    file: "shot-bind.png",
    description: "病患身分註冊：填好病歷號與生日",
  },
  {
    id: "pending",
    file: "shot-pending.png",
    description: "等待護理師審核",
  },
  {
    id: "home",
    file: "shot-home.png",
    description: "已綁定病患首頁（顏色日曆與拍攝）",
  },
  {
    id: "home-photos",
    file: "shot-home-photos.png",
    description: "首頁相片模式與查看相簿",
  },
  {
    id: "gallery",
    file: "shot-gallery.png",
    description: "相簿九宮格（示範出口照）",
    flow: "patient-gallery",
  },
  {
    id: "gallery-calendar",
    file: "shot-gallery-calendar.png",
    description: "相簿日曆模式（示範出口照）",
    flow: "patient-gallery",
  },
  {
    id: "capture",
    file: "shot-capture.png",
    description: "出口拍攝觀景窗（對準圓圈）",
    flow: "patient-capture",
  },
  {
    id: "result",
    file: "shot-result.png",
    description: "送出後的輔助判讀結果頁",
    flow: "patient-capture",
  },
] as const;

export const BLOG_SHOT_IDS: readonly BlogShotId[] = BLOG_SHOT_CATALOG.map((shot) => shot.id);

export function getShotById(id: string): BlogShot | undefined {
  return BLOG_SHOT_CATALOG.find((shot) => shot.id === id);
}

export function formatCatalog(): string {
  const rows = BLOG_SHOT_CATALOG.map(
    (shot) => `  ${shot.id.padEnd(14)} ${shot.file.padEnd(24)} ${shot.description}`
  );
  return ["id             file                     description", ...rows].join("\n");
}
