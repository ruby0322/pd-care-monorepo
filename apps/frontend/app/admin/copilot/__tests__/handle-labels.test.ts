import { applyHandleLabels } from "@/app/admin/copilot/_components/handle-labels";

describe("applyHandleLabels", () => {
  it("replaces a handle with its label", () => {
    expect(applyHandleLabels("P#3 近一個月上傳 5 次", { "P#3": { label: "王小明 (P123456)" } })).toBe(
      "王小明 (P123456) 近一個月上傳 5 次",
    );
  });

  it("leaves a handle alone when no label is permitted", () => {
    expect(applyHandleLabels("P#3 需追蹤", { "P#3": { label: null } })).toBe("P#3 需追蹤");
  });

  it("does not partially match a longer handle", () => {
    expect(applyHandleLabels("P#1 and P#12", { "P#1": { label: "A" }, "P#12": { label: "B" } })).toBe(
      "A and B",
    );
  });

  it("labels a handle that only arrives later in the stream", () => {
    // tokens render before the handle event lands; the map updates and the text re-renders
    expect(applyHandleLabels("P#3 需追蹤", {})).toBe("P#3 需追蹤");
    expect(applyHandleLabels("P#3 需追蹤", { "P#3": { label: "王小明" } })).toBe("王小明 需追蹤");
  });

  it("leaves handle-shaped text inside an html block alone", () => {
    const src = "見下表\n\n```html\n<p>P#3</p>\n```";
    expect(applyHandleLabels(src, { "P#3": { label: "王小明" } })).toBe(src);
  });

  it("behaves the same on a second consecutive call with the same input", () => {
    // The fence pattern is shared from artifact-bridge.ts; if that regex were reused
    // as one global instance instead of a fresh one per call, a prior call's
    // mutated `lastIndex` could make this second call silently skip the match.
    const src = "見下表\n\n```html\n<p>P#3</p>\n```";
    const handles = { "P#3": { label: "王小明" } };
    expect(applyHandleLabels(src, handles)).toBe(src);
    expect(applyHandleLabels(src, handles)).toBe(src);
  });

  it("substitutes every occurrence across repeated calls on prose with a handle", () => {
    const text = "P#3 需追蹤，另見 P#3 的上傳紀錄";
    const handles = { "P#3": { label: "王小明" } };
    const expected = "王小明 需追蹤，另見 王小明 的上傳紀錄";
    expect(applyHandleLabels(text, handles)).toBe(expected);
    expect(applyHandleLabels(text, handles)).toBe(expected);
  });
});
