import { streakEmoji } from "@/lib/utils/streak-emoji";

describe("streakEmoji", () => {
  test("maps each streak band", () => {
    expect(streakEmoji(0)).toBe("😐");
    expect(streakEmoji(1)).toBe("😶");
    expect(streakEmoji(2)).toBe("😄");
    expect(streakEmoji(6)).toBe("😄");
    expect(streakEmoji(7)).toBe("😯");
    expect(streakEmoji(13)).toBe("😯");
    expect(streakEmoji(14)).toBe("⚡");
    expect(streakEmoji(20)).toBe("⚡");
    expect(streakEmoji(21)).toBe("🔥");
    expect(streakEmoji(27)).toBe("🔥");
    expect(streakEmoji(28)).toBe("🙇");
    expect(streakEmoji(40)).toBe("🙇");
  });
});
