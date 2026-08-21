export const BLOG_ROBOTS_DISALLOW = [
  "/patient",
  "/admin",
  "/login",
  "/onboarding",
  "/apps",
  "/dev",
  "/api",
  "/role-select",
] as const;

export function getSiteUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  if (fromEnv) {
    return fromEnv;
  }
  if (process.env.NODE_ENV === "development") {
    return "http://localhost:3000";
  }
  return "https://pd.lu.im.ntu.edu.tw";
}
