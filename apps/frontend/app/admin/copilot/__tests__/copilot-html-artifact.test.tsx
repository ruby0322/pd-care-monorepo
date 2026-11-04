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
