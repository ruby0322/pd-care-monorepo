import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AxiosError } from "axios";

import { CopilotHtmlArtifact } from "@/app/admin/copilot/_components/copilot-html-artifact";

jest.mock("@/lib/api/copilot", () => ({
  queryCopilotProxy: jest.fn(),
}));

const { queryCopilotProxy } = jest.requireMock("@/lib/api/copilot") as {
  queryCopilotProxy: jest.Mock;
};

function renderArtifact(liveEnabled = true) {
  const onToggleLive = jest.fn();
  const utils = render(
    <CopilotHtmlArtifact html="<p>chart</p>" liveEnabled={liveEnabled} onToggleLive={onToggleLive} />,
  );
  const iframe = utils.container.querySelector("iframe") as HTMLIFrameElement;
  return { ...utils, iframe, onToggleLive };
}

/** Dispatches a message that appears to originate from the artifact frame. */
function postFromFrame(iframe: HTMLIFrameElement, data: unknown) {
  const event = new MessageEvent("message", { data });
  Object.defineProperty(event, "source", { value: iframe.contentWindow, enumerable: true });
  window.dispatchEvent(event);
}

describe("CopilotHtmlArtifact sandbox", () => {
  it("renders the frame without same-origin access", () => {
    const { iframe } = renderArtifact();
    expect(iframe.getAttribute("sandbox")).toBe("allow-scripts");
    expect(iframe.getAttribute("sandbox")).not.toContain("allow-same-origin");
    expect(iframe.getAttribute("srcDoc") ?? iframe.srcdoc).toContain("connect-src 'none'");
  });

  it("never passes a token into the frame", () => {
    const { iframe } = renderArtifact();
    const doc = iframe.srcdoc;
    expect(doc).not.toMatch(/Bearer/i);
    expect(doc).not.toMatch(/authorization/i);
  });
});

describe("CopilotHtmlArtifact bridge", () => {
  beforeEach(() => {
    queryCopilotProxy.mockReset();
  });

  it("forwards an allowlisted query to the proxy", async () => {
    queryCopilotProxy.mockResolvedValue({ tool: "get_cohort_gender_distribution", ok: true, status: 200, data: { total_patients: 3 } });
    const { iframe } = renderArtifact();

    postFromFrame(iframe, {
      type: "pdcare:query",
      id: "q1",
      tool: "get_cohort_gender_distribution",
      params: {},
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(queryCopilotProxy).toHaveBeenCalledWith("get_cohort_gender_distribution", {});
  });

  it("blocks a query for a tool outside the allowlist and surfaces a warning", async () => {
    const { iframe } = renderArtifact();

    postFromFrame(iframe, { type: "pdcare:query", id: "q1", tool: "delete_all_patients", params: {} });

    expect(queryCopilotProxy).not.toHaveBeenCalled();
    expect(await screen.findByText(/未授權的查詢/)).toBeInTheDocument();
  });

  it("refuses queries while live data is off", () => {
    const { iframe } = renderArtifact(false);

    postFromFrame(iframe, { type: "pdcare:query", id: "q1", tool: "get_cohort_gender_distribution", params: {} });

    expect(queryCopilotProxy).not.toHaveBeenCalled();
  });

  it("ignores a message that did not come from its own frame", () => {
    renderArtifact();

    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "pdcare:query", id: "q1", tool: "get_cohort_gender_distribution", params: {} },
      }),
    );

    expect(queryCopilotProxy).not.toHaveBeenCalled();
  });

  it("lets the user toggle live data", async () => {
    const { onToggleLive } = renderArtifact(false);
    await userEvent.click(screen.getByRole("button", { name: /即時資料/ }));
    expect(onToggleLive).toHaveBeenCalledWith(true);
  });
});

describe("CopilotHtmlArtifact query pacing", () => {
  beforeEach(() => {
    queryCopilotProxy.mockReset();
    queryCopilotProxy.mockResolvedValue({ tool: "list_patients", ok: true, status: 200, data: { items: [] } });
  });

  function query(id: string, tool = "list_patients") {
    return { type: "pdcare:query", id, tool, params: {} };
  }

  /**
   * A dashboard asks for several things as it loads. The interval cap used to *refuse* the
   * ones that arrived too soon -- a report doing two queries on startup got
   * 「查詢過於頻繁」 for the second one on its very first render, which is not a rate problem
   * but a load order. The caps now pace the queue instead.
   */
  it("paces a burst instead of refusing it", async () => {
    jest.useFakeTimers();
    try {
      const { iframe } = renderArtifact();

      act(() => {
        postFromFrame(iframe, query("q1"));
        postFromFrame(iframe, query("q2"));
        postFromFrame(iframe, query("q3"));
      });

      expect(queryCopilotProxy).toHaveBeenCalledTimes(1);

      await act(async () => {
        jest.advanceTimersByTime(400);
      });
      expect(queryCopilotProxy).toHaveBeenCalledTimes(2);

      await act(async () => {
        jest.advanceTimersByTime(400);
      });
      expect(queryCopilotProxy).toHaveBeenCalledTimes(3);
    } finally {
      jest.useRealTimers();
    }
  });

  it("refuses only once the queue itself is runaway", () => {
    const { iframe } = renderArtifact();
    const replies: unknown[] = [];
    const target = iframe.contentWindow;
    if (target) {
      jest.spyOn(target, "postMessage").mockImplementation((payload: unknown) => replies.push(payload));
    }

    act(() => {
      for (let index = 0; index < 40; index += 1) {
        postFromFrame(iframe, query(`q${index}`));
      }
    });

    const refusals = replies.filter(
      (item) => typeof item === "object" && item !== null && (item as { ok?: boolean }).ok === false,
    );
    expect(refusals.length).toBeGreaterThan(0);
    expect(JSON.stringify(refusals[0])).toContain("等待中的查詢已達上限");
  });

  it("hands the frame the backend's words when the proxy itself refuses the request", async () => {
    // The proxy's rate limit is an HTTP error on the POST, not an `ok: false` body.
    const rejection = new AxiosError("Request failed with status code 429");
    rejection.response = {
      status: 429,
      data: { detail: "Too many live-data refreshes; slow down and retry shortly" },
    } as never;
    queryCopilotProxy.mockRejectedValue(rejection);

    const { iframe } = renderArtifact();
    const replies: unknown[] = [];
    const target = iframe.contentWindow;
    if (target) {
      jest.spyOn(target, "postMessage").mockImplementation((payload: unknown) => replies.push(payload));
    }

    act(() => postFromFrame(iframe, query("q1")));
    await act(async () => {
      await Promise.resolve();
    });

    expect(JSON.stringify(replies)).toContain("Too many live-data refreshes");
  });

  it("hands the frame the reason the proxy refused, not just the status", async () => {
    queryCopilotProxy.mockResolvedValue({
      tool: "list_patients",
      ok: false,
      status: 422,
      data: {
        error: true,
        status: 422,
        detail: { detail: [{ loc: ["query", "query"], msg: "String should have at least 1 character", input: "" }] },
      },
    });
    const { iframe } = renderArtifact();
    const replies: unknown[] = [];
    const target = iframe.contentWindow;
    if (target) {
      jest.spyOn(target, "postMessage").mockImplementation((payload: unknown) => replies.push(payload));
    }

    act(() => postFromFrame(iframe, query("q1")));
    await act(async () => {
      await Promise.resolve();
    });

    expect(JSON.stringify(replies)).toContain("參數 query");
    expect(JSON.stringify(replies)).toContain("HTTP 422");
  });
});

describe("CopilotHtmlArtifact height", () => {
  /**
   * The frame measures, the parent applies, the frame measures again -- so the applied height
   * has to be a fixed point. It was not: the parent added a margin to whatever arrived, the
   * frame reported the viewport floor (its own, now taller, height) on the next tick, and the
   * pair climbed 8px every 500ms until the 2400px cap. Every report grew, whatever was in it.
   */
  it("does not climb when the frame reports back the height it was given", () => {
    const { iframe } = renderArtifact();

    act(() => postFromFrame(iframe, { type: "pdcare:height", height: 320 }));
    const applied = iframe.style.height;
    expect(applied).toBe("320px");

    // What the frame measures next: a viewport-floored read is exactly what it was given.
    for (let tick = 0; tick < 5; tick += 1) {
      act(() => postFromFrame(iframe, { type: "pdcare:height", height: parseInt(iframe.style.height, 10) }));
    }

    expect(iframe.style.height).toBe(applied);
  });

  it("follows the content when it genuinely changes size", () => {
    const { iframe } = renderArtifact();

    act(() => postFromFrame(iframe, { type: "pdcare:height", height: 700 }));
    expect(iframe.style.height).toBe("700px");

    act(() => postFromFrame(iframe, { type: "pdcare:height", height: 240 }));
    expect(iframe.style.height).toBe("240px");
  });

  it("keeps a floor and a ceiling", () => {
    const { iframe } = renderArtifact();

    act(() => postFromFrame(iframe, { type: "pdcare:height", height: 10 }));
    expect(iframe.style.height).toBe("160px");

    act(() => postFromFrame(iframe, { type: "pdcare:height", height: 99999 }));
    expect(iframe.style.height).toBe("2400px");
  });
});

describe("CopilotHtmlArtifact while the report is being written", () => {
  function renderGenerating(html: string) {
    const utils = render(
      <CopilotHtmlArtifact
        html={html}
        liveEnabled
        incomplete="writing"
        onToggleLive={jest.fn()}
        onSaveAsModule={jest.fn()}
      />,
    );
    return { ...utils, iframe: utils.container.querySelector("iframe") };
  }

  /**
   * A half-written report must not run. The browser executes an unterminated `<script>` at
   * end of document, so mounting the frame per streamed token re-runs a truncated copy of
   * the report in a frame that reloads under the reader's cursor -- the flicker, and the
   * stream of bogus runtime errors that came with it.
   */
  it("does not mount a frame for a half-written report", () => {
    const { iframe } = renderGenerating("<div id=\"root\"></div>\n<script>\nconst d = await pdcare");
    expect(iframe).toBeNull();
  });

  it("says the report is still being written", () => {
    renderGenerating("<div>partial");
    expect(screen.getByText("報表編輯中")).toBeInTheDocument();
    expect(screen.getByText(/只能預覽內容/)).toBeInTheDocument();
  });

  it("shows the source as it arrives, so the write is still visible", () => {
    const { rerender, container } = render(
      <CopilotHtmlArtifact html="<div>partial" liveEnabled incomplete="writing" onToggleLive={jest.fn()} />,
    );
    expect(screen.getByLabelText("報表產生中的原始碼")).toHaveTextContent("<div>partial");

    rerender(
      <CopilotHtmlArtifact
        html="<div>partial</div><p>更多"
        liveEnabled
        incomplete="writing"
        onToggleLive={jest.fn()}
      />,
    );
    expect(screen.getByLabelText("報表產生中的原始碼")).toHaveTextContent("<div>partial</div><p>更多");
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("offers no action a half-written report cannot honour", () => {
    renderGenerating("<div>partial");
    for (const name of [/即時資料/, /重新整理報表/, /檢視 HTML 原始碼/, /下載 HTML/, /儲存為模組/, /全螢幕檢視/]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });

  /**
   * A stopped or cut-off turn leaves a block whose fence never closed. Mounting it would run
   * half a report and report faults against code the model never finished, which the frame
   * would then ask the model to "repair".
   */
  it("leaves a turn that stopped mid-block unmounted, and says it is unfinished", () => {
    const { container } = render(
      <CopilotHtmlArtifact html="<div>partial" liveEnabled incomplete="truncated" onToggleLive={jest.fn()} />,
    );
    expect(container.querySelector("iframe")).toBeNull();
    expect(screen.getByText("報表未完成")).toBeInTheDocument();
    expect(screen.getByText(/沒有寫完就停下了/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /儲存為模組/ })).not.toBeInTheDocument();
  });

  it("renders and becomes operable once the block is complete", () => {
    const { container } = render(
      <CopilotHtmlArtifact html="<p>chart</p>" liveEnabled onToggleLive={jest.fn()} onSaveAsModule={jest.fn()} />,
    );
    expect(container.querySelector("iframe")).not.toBeNull();
    expect(screen.queryByText("報表編輯中")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /儲存為模組/ })).toBeInTheDocument();
  });

  /** The frame is fed one complete document, not one per token, so it loads once. */
  it("keeps the same document across re-renders of a finished report", () => {
    const { container, rerender } = render(
      <CopilotHtmlArtifact html="<p>chart</p>" liveEnabled onToggleLive={jest.fn()} />,
    );
    const before = (container.querySelector("iframe") as HTMLIFrameElement).srcdoc;
    rerender(<CopilotHtmlArtifact html="<p>chart</p>" liveEnabled onToggleLive={jest.fn()} />);
    expect((container.querySelector("iframe") as HTMLIFrameElement).srcdoc).toBe(before);
  });
});
