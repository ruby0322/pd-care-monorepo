import {
  usesLiveBridge,
  ARTIFACT_ALLOWED_TOOLS,
  buildArtifactDocument,
  isAllowedArtifactTool,
  parseArtifactError,
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

describe("usesLiveBridge", () => {
  it("detects reports that call the bridge", () => {
    expect(usesLiveBridge('const d = await window.pdcare.query("get_today_attention", {});')).toBe(true);
    expect(usesLiveBridge("pdcare.query('x')")).toBe(true);
    expect(usesLiveBridge("pdcare . query ( 'x' )")).toBe(true);
  });

  it("leaves static reports alone", () => {
    expect(usesLiveBridge("<p>靜態數字 42</p>")).toBe(false);
    expect(usesLiveBridge("<script>const pdcareNote = 1;</script>")).toBe(false);
  });
});

describe("parseArtifactError", () => {
  it("parses a reported runtime error", () => {
    expect(
      parseArtifactError({ type: "pdcare:error", kind: "script", message: "boom", detail: "stack" }),
    ).toEqual({ type: "pdcare:error", kind: "script", message: "boom", detail: "stack" });
  });

  it("defaults kind and detail when absent", () => {
    const parsed = parseArtifactError({ type: "pdcare:error", message: "boom" });
    expect(parsed).toEqual({ type: "pdcare:error", kind: "script", message: "boom", detail: "" });
  });

  it("truncates very long payloads", () => {
    const parsed = parseArtifactError({
      type: "pdcare:error",
      message: "m".repeat(5000),
      detail: "d".repeat(5000),
    });
    expect(parsed?.message.length).toBe(500);
    expect(parsed?.detail.length).toBe(2000);
  });

  it("ignores unrelated messages", () => {
    expect(parseArtifactError(null)).toBeNull();
    expect(parseArtifactError({ type: "pdcare:query", id: "q1", tool: "t" })).toBeNull();
    expect(parseArtifactError({ type: "pdcare:error" })).toBeNull();
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

  it("reports runtime errors out of the frame so the assistant can repair its own HTML", () => {
    expect(doc).toContain('addEventListener("error"');
    expect(doc).toContain('addEventListener("unhandledrejection"');
    expect(doc).toContain('type: "pdcare:error"');
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
