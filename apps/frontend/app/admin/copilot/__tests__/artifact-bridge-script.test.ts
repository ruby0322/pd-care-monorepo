import { buildArtifactDocument } from "@/app/admin/copilot/_components/artifact-bridge";

function bridgeScript(): string {
  const document_ = buildArtifactDocument("<p>報表</p>");
  const match = /<script>([\s\S]*?)<\/script>/.exec(document_);
  if (!match) {
    throw new Error("the built document carries no bridge script");
  }
  return match[1];
}

/**
 * The bridge is written as one JS string inside a TS template literal, so an escape that
 * looks right in the editor can collapse into something the browser cannot parse. A single
 * syntax error anywhere in it takes down the whole script — and with it `window.pdcare`,
 * the height reports and the runtime-error reports — in every artifact at once, which the
 * postMessage-level tests cannot see because they stub the frame instead of running it.
 */
describe("artifact bridge script", () => {
  it("parses as JavaScript", () => {
    expect(() => new Function(bridgeScript())).not.toThrow();
  });

  it("defines window.pdcare.query when it runs", () => {
    const frame = {
      pdcare: undefined as { query?: unknown } | undefined,
      addEventListener: () => {},
    };
    const run = new Function(
      "window",
      "parent",
      "document",
      "setInterval",
      "setTimeout",
      bridgeScript(),
    );
    run(
      frame,
      { postMessage: () => {} },
      { body: null, documentElement: null },
      () => 0,
      () => 0,
    );

    expect(typeof frame.pdcare?.query).toBe("function");
  });

  it("names the failing tool in a query failure report", () => {
    const reports: Array<Record<string, unknown>> = [];
    const listeners: Record<string, (event: unknown) => void> = {};
    const frame = {
      pdcare: undefined as { query?: (tool: string, params?: unknown) => Promise<unknown> } | undefined,
      addEventListener: (type: string, listener: (event: unknown) => void) => {
        listeners[type] = listener;
      },
    };
    const run = new Function(
      "window",
      "parent",
      "document",
      "setInterval",
      "setTimeout",
      bridgeScript(),
    );
    run(
      frame,
      { postMessage: (payload: Record<string, unknown>) => reports.push(payload) },
      { body: null, documentElement: null },
      () => 0,
      () => 0,
    );

    const query_ = frame.pdcare?.query;
    if (!query_) {
      throw new Error("the bridge did not define window.pdcare.query");
    }
    const pending = query_("get_today_attention");
    expect(pending).toBeInstanceOf(Promise);
    const query = reports.find((item) => item.type === "pdcare:query");
    expect(query).toMatchObject({ tool: "get_today_attention" });

    listeners.message?.({ data: { type: "pdcare:result", id: query?.id, ok: false, error: "權限不足" } });

    expect(reports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "pdcare:error",
          kind: "query",
          message: 'window.pdcare.query("get_today_attention") failed: 權限不足',
        }),
      ]),
    );
    return expect(pending).rejects.toThrow("權限不足");
  });
});
