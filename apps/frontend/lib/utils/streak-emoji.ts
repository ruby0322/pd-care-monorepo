export function streakEmoji(days: number): string {
  if (days <= 0) {
    return "😐";
  }
  if (days === 1) {
    return "😶";
  }
  if (days <= 6) {
    return "😄";
  }
  if (days <= 13) {
    return "😯";
  }
  if (days <= 20) {
    return "⚡";
  }
  if (days <= 27) {
    return "🔥";
  }
  return "🙇";
}
