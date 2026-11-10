import {
  usesLiveBridge,
  ARTIFACT_ALLOWED_TOOLS,
  buildArtifactDocument,
  buildAutoRepairPrompt,
  buildManualRepairPrompt,
  describeErrorLocation,
  isAllowedArtifactTool,
  parseArtifactError,
  parseArtifactQuery,
  parseAssistantContent,
  formatProxyRejection,
  toReportLine,
  type ArtifactErrorMessage,
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
      parseArtifactError({
        type: "pdcare:error",
        kind: "script",
        message: "boom",
        detail: "stack",
        line: 12,
        column: 5,
      }),
    ).toEqual({
      type: "pdcare:error",
      kind: "script",
      message: "boom",
      detail: "stack",
      line: 12,
      column: 5,
    });
  });

  it("defaults kind, detail and location when absent", () => {
    const parsed = parseArtifactError({ type: "pdcare:error", message: "boom" });
    expect(parsed).toEqual({
      type: "pdcare:error",
      kind: "script",
      message: "boom",
      detail: "",
      line: null,
      column: null,
    });
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

  it("ignores a non-numeric location", () => {
    const parsed = parseArtifactError({ type: "pdcare:error", message: "boom", line: "12", column: NaN });
    expect(parsed?.line).toBeNull();
    expect(parsed?.column).toBeNull();
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
      { kind: "html", value: "<div>chart</div>", closed: true },
      { kind: "text", value: "以上。" },
    ]);
  });

  it("handles an artifact that is still streaming without a closing fence", () => {
    const { segments, hasHtml } = parseAssistantContent("前言\n\n```html\n<div>partial");
    expect(hasHtml).toBe(true);
    expect(segments[1]).toEqual({ kind: "html", value: "<div>partial", closed: false });
  });

  // `closed` is what the viewer waits for before it renders anything, so a block that the
  // model has finished must not stay marked open just because prose is still arriving.
  it("marks a finished block closed even when prose is still streaming after it", () => {
    const { segments } = parseAssistantContent("```html\n<div>chart</div>\n```\n\n結論：這份報表");
    expect(segments[0]).toEqual({ kind: "html", value: "<div>chart</div>", closed: true });
    expect(segments[1]).toEqual({ kind: "text", value: "結論：這份報表" });
  });

  it("marks a block open while its script is only half written", () => {
    const { segments } = parseAssistantContent("```html\n<div id=\"a\"></div>\n<script>\nconst x = await pdcare");
    expect(segments[0]).toMatchObject({ kind: "html", closed: false });
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

describe("repair prompts", () => {
  /**
   * A browser reports the line of the *wrapped document*, which carries ~100 lines of
   * injected head before the report's first line, so a fixture that uses a bare number is
   * testing a location the model could never act on. Derived from the builder so that
   * editing the head moves the fixtures with it.
   */
  function documentLineFor(reportLine: number): number {
    const marker = "__fixture_marker__";
    const lines = buildArtifactDocument(marker).split("\n");
    return lines.findIndex((line) => line.includes(marker)) + reportLine;
  }

  // The iframe runs with fully identified data, and the system prompt encourages reports
  // that throw explanatory errors -- so this is the shape of error a real report produces.
  const identifying: ArtifactErrorMessage = {
    type: "pdcare:error",
    kind: "script",
    message: "找不到 王小明 的資料 (line 12:5)",
    detail: "Error: 找不到 王小明 的資料\n    at render (about:srcdoc:12:5)",
    line: documentLineFor(12),
    column: 5,
  };

  it("sends no error text on the automatic path, only type and location", () => {
    const prompt = buildAutoRepairPrompt([identifying]);
    expect(prompt).not.toContain("王小明");
    expect(prompt).not.toContain(identifying.message);
    expect(prompt).not.toContain(identifying.detail);
    expect(prompt).toContain("script");
    expect(prompt).toContain("你的 HTML 第 12 行第 5 欄");
  });

  it("keeps the full error text on the manual path", () => {
    const prompt = buildManualRepairPrompt([identifying]);
    expect(prompt).toContain(identifying.message);
    expect(prompt).toContain(identifying.detail);
  });

  it("quotes the report's own code at the fault when it has the source", () => {
    const html = ["<div id=\"root\"></div>", "<script>", "const rows = [];", "render(rows);", "</script>"].join("\n");
    const prompt = buildManualRepairPrompt(
      [{ ...identifying, line: documentLineFor(4), column: 1, message: "render is not defined" }],
      html,
    );

    expect(prompt).toContain("你的 HTML 第 4 行");
    expect(prompt).toContain("4| render(rows);   <-- 錯誤發生在這一行");
    // Context around it, so the model can see what it was writing.
    expect(prompt).toContain("3| const rows = [];");
  });

  it("tells the model what a rejected query means, so it does not guess", () => {
    const prompt = buildManualRepairPrompt([
      { ...identifying, kind: "query", message: '查詢被拒絕（HTTP 422）：參數 query：String should have at least 1 character（收到 ""）' },
    ]);

    expect(prompt).toContain("422");
    expect(prompt).toContain("空字串請直接不要傳");
  });

  it("reports a location in its own injected code as not being the report's", () => {
    expect(describeErrorLocation({ ...identifying, line: null, column: null })).toBe("位置不明");
    expect(describeErrorLocation({ ...identifying, column: null })).toBe("你的 HTML 第 12 行");
    // A line inside the wrapper's head belongs to the bridge, not to anything the model wrote.
    expect(describeErrorLocation({ ...identifying, line: 12, column: null })).toBe(
      "位置在系統注入的程式碼，不在你的 HTML 內",
    );
  });

  it("translates a document line into the report's own line", () => {
    expect(toReportLine(documentLineFor(1))).toBe(1);
    expect(toReportLine(documentLineFor(40))).toBe(40);
    expect(toReportLine(12)).toBeNull();
    expect(toReportLine(null)).toBeNull();
  });

  it("caps how many faults it forwards automatically", () => {
    const many = Array.from({ length: 9 }, (_item, index) => ({ ...identifying, line: index + 1 }));
    const prompt = buildAutoRepairPrompt(many);
    expect(prompt.split("- [script]").length - 1).toBe(5);
  });
});

/**
 * The upstream endpoint's own words. The viewer used to collapse a rejection to its status,
 * which left the model repairing a report from 「HTTP 422」 alone: in dev it responded by
 * sending *more* parameters each turn, keeping the empty one that caused the 422.
 */
describe("formatProxyRejection", () => {
  it("names the refused field and the value that refused it", () => {
    const message = formatProxyRejection(422, {
      error: true,
      status: 422,
      detail: {
        detail: [
          {
            type: "string_too_short",
            loc: ["query", "query"],
            msg: "String should have at least 1 character",
            input: "",
          },
        ],
      },
    });

    expect(message).toContain("HTTP 422");
    expect(message).toContain("參數 query");
    expect(message).toContain("String should have at least 1 character");
    expect(message).toContain('收到 ""');
  });

  // `loc[0]` is the wrapper and the rest is the field -- and here they are the same word.
  it("keeps a field whose name matches its own wrapper", () => {
    expect(formatProxyRejection(422, { detail: { detail: [{ loc: ["query", "query"], msg: "bad" }] } })).toContain(
      "參數 query",
    );
    expect(formatProxyRejection(422, { detail: { detail: [{ loc: ["query", "limit"], msg: "bad" }] } })).toContain(
      "參數 limit",
    );
  });

  it("lists several refused fields, bounded", () => {
    const items = Array.from({ length: 6 }, (_item, index) => ({
      loc: ["query", `field${index}`],
      msg: "nope",
    }));
    const message = formatProxyRejection(422, { detail: { detail: items } });

    expect(message).toContain("參數 field0");
    expect(message).toContain("參數 field2");
    expect(message).not.toContain("參數 field3");
  });

  it("passes a plain string detail through", () => {
    expect(formatProxyRejection(403, { detail: "此病患未分配給你" })).toContain("此病患未分配給你");
  });

  it("still says something useful when there is no detail at all", () => {
    expect(formatProxyRejection(500, null)).toBe("查詢被拒絕（HTTP 500）。");
    expect(formatProxyRejection(null, {})).toBe("查詢被拒絕（HTTP ?）。");
  });
});
