import { ONBOARDING_GUIDE_SLUG, resolveMatchedHomeNews } from "@/lib/blog/home-discovery";

const onboardingPost = {
  slug: ONBOARDING_GUIDE_SLUG,
  title: "三分鐘學會拍照上傳",
  description: "d",
  publishedAt: "2026-08-20",
  author: "臺大醫院 PD Care 團隊",
};

const valuePost = {
  slug: "每天拍一張",
  title: "每天拍一張，護理師比較看得到你",
  description: "d",
  publishedAt: "2026-08-21",
  author: "臺大醫院 PD Care 團隊",
};

describe("resolveMatchedHomeNews", () => {
  test("hides 最新消息 when the latest post is the still-visible onboarding banner", () => {
    expect(
      resolveMatchedHomeNews({
        latestPost: onboardingPost,
        onboardingGuideVisible: true,
      })
    ).toBeNull();
  });

  test("shows a different latest post while the onboarding banner is visible", () => {
    expect(
      resolveMatchedHomeNews({
        latestPost: valuePost,
        onboardingGuideVisible: true,
      })
    ).toEqual(valuePost);
  });

  test("shows the onboarding post after the banner is dismissed", () => {
    expect(
      resolveMatchedHomeNews({
        latestPost: onboardingPost,
        onboardingGuideVisible: false,
      })
    ).toEqual(onboardingPost);
  });
});
