export const ONBOARDING_GUIDE_SLUG = "三分鐘學會拍照上傳";
export const VALUE_POST_SLUG = "每天拍一張";

export const BLOG_AUTHOR = "臺大醫院 PD Care 團隊";

export const ARTICLE_DISCLAIMER =
  "本系統為輔助照護工具，AI 結果不構成診斷；不適或緊急請聯絡透析室 / 原就醫團隊。";

export const UNBOUND_VALUE_LINK_LABEL = "為什麼每天拍一張有幫助？";
export const PENDING_ONBOARDING_BANNER = "審核通過後就能拍照，先看三步驟教學";
export const MATCHED_ONBOARDING_BANNER = "還沒拍過？三步驟學會上傳出口照";
export const MATCHED_ONBOARDING_CTA = "查看教學";

export type BlogPostSummary = {
  slug: string;
  title: string;
  description: string;
  publishedAt: string;
  author: string;
};

export function resolveMatchedHomeNews(args: {
  latestPost: BlogPostSummary | null;
  onboardingGuideVisible: boolean;
}): BlogPostSummary | null {
  if (!args.latestPost) {
    return null;
  }
  if (args.onboardingGuideVisible && args.latestPost.slug === ONBOARDING_GUIDE_SLUG) {
    return null;
  }
  return args.latestPost;
}
