import {
  ARTIFACT_ALLOWED_TOOLS,
  buildArtifactDocument,
  isAllowedArtifactTool,
  parseArtifactQuery,
  parseAssistantContent,
} from "@/app/admin/copilot/_components/artifact-bridge";

describe("isAllowedArtifactTool", () => {
  it("accepts every tool in the mirrored allowlist", () => {
    for (const tool of ARTIFACT_ALLOWED_TOOLS) {
      expect(isAllowedArtifactTool(tool)).toBe(true);
    }
  });

  it("rejects anything outside the allowlist", () => {
    expect(isAllowedArtifactTool("delete_patient")).toBe(false);
    expect(isAllowedArtifactTool("/v1/staff/admin/users")).toBe(false);
    expect(isAllowedArtifactTool("")).toBe(false);
    expect(isAllowedArtifactTool(undefined)).toBe(false);
    expect(isAllowedArtifactTool(42)).toBe(false);
  });
});

describe("parseArtifactQuery", () => {
  it("parses a well-formed query", () => {
    expect(
      parseArtifactQuery({ type: "pdcare:query", id: "q1", tool: "get_cohort_active_users", params: { interval: "week" } }),
    ).toEqual({ type: "pdcare:query", id: "q1", tool: "get_cohort_active_users", params: { interval: "week" } });
  });

  it("defaults params to an object when missing or not an object", () => {
    expect(parseArtifactQuery({ type: "pdcare:query", id: "q1", tool: "t" })?.params).toEqual({});
    expect(parseArtifactQuery({ type: "pdcare:query", id: "q1", tool: "t", params: [1, 2] })?.params).toEqual({});
  });

  it("ignores messages that are not queries", () => {
    expect(parseArtifactQuery(null)).toBeNull();
    expect(parseArtifactQuery("pdcare:query")).toBeNull();
    expect(parseArtifactQuery({ type: "pdcare:height", height: 10 })).toBeNull();
    expect(parseArtifactQuery({ type: "pdcare:query", tool: "t" })).toBeNull();
    expect(parseArtifactQuery({ type: "pdcare:query", id: "q1" })).toBeNull();
  });
});

describe("buildArtifactDocument", () => {
  const doc = buildArtifactDocument("<p>hi</p>");

  it("blocks all direct network access from the artifact", () => {
    expect(doc).toContain("connect-src 'none'");
    expect(doc).toContain("default-src 'none'");
    expect(doc).toContain("form-action 'none'");
    expect(doc).toContain("base-uri 'none'");
  });

  it("exposes only the postMessage bridge for data", () => {
    expect(doc).toContain("window.pdcare");
    expect(doc).toContain('parent.postMessage({ type: "pdcare:query"');
  });

  it("embeds the supplied markup", () => {
    expect(doc).toContain("<p>hi</p>");
  });
});

describe("parseAssistantContent", () => {
  it("splits prose from a fenced html artifact", () => {
    const { segments, hasHtml } = parseAssistantContent(
      "結論如下。\n\n```html\n<div>chart</div>\n```\n\n以上。",
    );
    expect(hasHtml).toBe(true);
    expect(segments).toEqual([
      { kind: "text", value: "結論如下。" },
      { kind: "html", value: "<div>chart</div>" },
      { kind: "text", value: "以上。" },
    ]);
  });

  it("handles an artifact that is still streaming without a closing fence", () => {
    const { segments, hasHtml } = parseAssistantContent("前言\n\n```html\n<div>partial");
    expect(hasHtml).toBe(true);
    expect(segments[1]).toEqual({ kind: "html", value: "<div>partial" });
  });

  it("returns plain prose untouched", () => {
    const { segments, hasHtml } = parseAssistantContent("只有文字");
    expect(hasHtml).toBe(false);
    expect(segments).toEqual([{ kind: "text", value: "只有文字" }]);
  });

  it("does not treat a non-html fence as an artifact", () => {
    const { hasHtml } = parseAssistantContent("```json\n{}\n```");
    expect(hasHtml).toBe(false);
  });
});
