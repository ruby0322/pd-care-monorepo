import { buildArtifactDocument } from "@/app/admin/copilot/_components/artifact-bridge";

function bridgeScript(): string {
  const document_ = buildArtifactDocument("<p>報表</p>");
  const match = /<script>([\s\S]*?)<\/script>/.exec(document_);
  if (!match) {
    throw new Error("the built document carries no bridge script");
  }
  return match[1];
}

type FrameWindow = {
  pdcare?: { query?: (tool: string, params?: unknown) => Promise<unknown> };
  innerHeight: number;
  addEventListener: (type: string, listener: (event: unknown) => void) => void;
};

type Box = { scrollHeight: number; offsetHeight: number };

type RunningBridge = {
  /** Everything the frame has posted to the parent. */
  posted: Array<Record<string, unknown>>;
  /** Listeners the frame registered, by event type, so a test can drive one. */
  listeners: Record<string, (event: unknown) => void>;
  /** The repeating height callback, which the frame schedules once on startup. */
  timers: Array<() => void>;
  frame: FrameWindow;
};

/** Runs the real bridge script against a fake frame, the way a browser would. */
function runBridge(layout?: { body: Box; documentElement: Box; innerHeight: number }): RunningBridge {
  const posted: Array<Record<string, unknown>> = [];
  const listeners: Record<string, (event: unknown) => void> = {};
  const timers: Array<() => void> = [];
  const frame: FrameWindow = {
    pdcare: undefined,
    innerHeight: layout?.innerHeight ?? 0,
    addEventListener: (type, listener) => {
      listeners[type] = listener;
    },
  };

  const run = new Function("window", "parent", "document", "setInterval", "setTimeout", bridgeScript());
  run(
    frame,
    { postMessage: (payload: Record<string, unknown>) => posted.push(payload) },
    layout
      ? { body: layout.body, documentElement: layout.documentElement }
      : { body: null, documentElement: null },
    (callback: () => void) => {
      timers.push(callback);
      return 0;
    },
    () => 0,
  );

  return { posted, listeners, timers, frame };
}

function reportedHeights(bridge: RunningBridge): unknown[] {
  return bridge.posted.filter((item) => item.type === "pdcare:height").map((item) => item.height);
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
    expect(typeof runBridge().frame.pdcare?.query).toBe("function");
  });

  it("names the failing tool in a query failure report", async () => {
    const bridge = runBridge();
    const query_ = bridge.frame.pdcare?.query;
    if (!query_) {
      throw new Error("the bridge did not define window.pdcare.query");
    }

    const pending = query_("get_today_attention");
    expect(pending).toBeInstanceOf(Promise);
    const query = bridge.posted.find((item) => item.type === "pdcare:query");
    expect(query).toMatchObject({ tool: "get_today_attention" });

    bridge.listeners.message?.({
      data: { type: "pdcare:result", id: query?.id, ok: false, error: "權限不足" },
    });

    expect(bridge.posted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "pdcare:error",
          kind: "query",
          message: 'window.pdcare.query("get_today_attention") failed: 權限不足',
        }),
      ]),
    );
    await expect(pending).rejects.toThrow("權限不足");
  });
});

describe("artifact bridge height reports", () => {
  /**
   * `documentElement.scrollHeight` is floored at the viewport, which is the height the parent
   * has just applied to this frame — so reporting it handed the parent back its own number,
   * and the two polling sides climbed to the parent's ceiling. The body's box does not move
   * when the frame gets taller.
   */
  it("measures the body, not the viewport the parent just resized", () => {
    const bridge = runBridge({
      body: { scrollHeight: 240, offsetHeight: 240 },
      // Floored at the viewport, so it reports the frame's own height, not the report's.
      documentElement: { scrollHeight: 900, offsetHeight: 900 },
      innerHeight: 900,
    });

    expect(bridge.timers).toHaveLength(1);
    bridge.timers[0]();

    expect(reportedHeights(bridge)).toEqual([240]);
  });

  /**
   * The one thing the body's box cannot see: content that escapes it (absolutely positioned
   * or floated children) in a frame too short to show it. `documentElement.scrollHeight`
   * exceeding the viewport means exactly that, so it is trusted there.
   */
  it("reports content that overflows a frame too short for it", () => {
    const bridge = runBridge({
      // The body's box collapsed around escaping children; the real content is 880px.
      body: { scrollHeight: 120, offsetHeight: 120 },
      documentElement: { scrollHeight: 880, offsetHeight: 880 },
      innerHeight: 320,
    });

    bridge.timers[0]();

    expect(reportedHeights(bridge)).toEqual([880]);
  });

  it("reports the same height every tick while the content holds still", () => {
    const bridge = runBridge({
      body: { scrollHeight: 240, offsetHeight: 240 },
      documentElement: { scrollHeight: 240, offsetHeight: 240 },
      innerHeight: 240,
    });

    bridge.timers[0]();
    bridge.timers[0]();
    bridge.timers[0]();

    expect(reportedHeights(bridge)).toEqual([240, 240, 240]);
  });

  it("says nothing before there is a body to measure", () => {
    const bridge = runBridge();
    bridge.timers[0]();
    expect(reportedHeights(bridge)).toEqual([]);
  });
});
