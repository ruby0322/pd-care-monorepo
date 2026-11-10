import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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
