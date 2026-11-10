import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CopilotMessage } from "@/app/admin/copilot/_components/copilot-message";
import { CopilotMarkdown } from "@/app/admin/copilot/_components/copilot-markdown";

jest.mock("@/lib/api/copilot", () => ({
  queryCopilotProxy: jest.fn(),
  createCopilotModule: jest.fn(),
}));

const { queryCopilotProxy } = jest.requireMock("@/lib/api/copilot") as { queryCopilotProxy: jest.Mock };
const { createCopilotModule } = jest.requireMock("@/lib/api/copilot") as { createCopilotModule: jest.Mock };

describe("CopilotMarkdown", () => {
  it("renders a GFM table", () => {
    render(<CopilotMarkdown content={"| 日期 | 疑似 |\n| --- | --- |\n| 11/01 | 3 |\n| 11/02 | 5 |"} />);
    expect(screen.getByText("日期")).toBeInTheDocument();
    expect(screen.getByText("11/02")).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(3);
  });

  it("renders bullets, headings and inline emphasis", () => {
    render(<CopilotMarkdown content={"## 結論\n\n- 第一點 **重要**\n- 第二點 `code`"} />);
    expect(screen.getByText("結論")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("重要").tagName).toBe("STRONG");
    expect(screen.getByText("code").tagName).toBe("CODE");
  });
});

describe("CopilotMessage", () => {
  it("renders a user message as plain text", () => {
    render(
      <CopilotMessage
        message={{ key: "u1", role: "user", content: "近三個月感染趨勢？", toolTrace: [] }}
      />,
    );
    expect(screen.getByText("近三個月感染趨勢？")).toBeInTheDocument();
  });

  it("renders an html artifact in a sandboxed frame alongside prose", () => {
    const { container } = render(
      <CopilotMessage
        message={{
          key: "a1",
          role: "assistant",
          content: "結論在圖中。\n\n```html\n<p>chart</p>\n```",
          toolTrace: [],
        }}
      />,
    );
    expect(screen.getByText("結論在圖中。")).toBeInTheDocument();
    const iframe = container.querySelector("iframe");
    expect(iframe?.getAttribute("sandbox")).toBe("allow-scripts");
  });

  it("shows query steps with a permission-denied label", async () => {
    render(
      <CopilotMessage
        message={{
          key: "a2",
          role: "assistant",
          content: "這位病患未分配給你。",
          toolTrace: [
            { tool: "list_patient_uploads", params: { patient_id: 7 }, ok: false, status: 403, duration_ms: 12 },
          ],
        }}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /查詢步驟/ }));
    expect(screen.getByText("查詢病患上傳歷程")).toBeInTheDocument();
    expect(screen.getByText("權限不足")).toBeInTheDocument();
  });

  it("marks truncated tool results so the reader does not mistake them for a full dataset", async () => {
    render(
      <CopilotMessage
        message={{
          key: "a3",
          role: "assistant",
          content: "資料量過大。",
          toolTrace: [{ tool: "list_patients", ok: true, status: 200, truncated: true, duration_ms: 30 }],
        }}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /查詢步驟/ }));
    expect(screen.getByText("資料已截斷")).toBeInTheDocument();
  });

  it("shows a streaming caret while a turn has produced no text yet", () => {
    render(
      <CopilotMessage
        message={{ key: "s", role: "assistant", content: "", toolTrace: [], isStreaming: true }}
      />,
    );
    expect(screen.getByRole("status", { name: "正在產生回覆" })).toBeInTheDocument();
  });

  it("enables live data by default for a report that uses the bridge", async () => {
    (queryCopilotProxy as jest.Mock).mockResolvedValue({ tool: "get_today_attention", ok: true, status: 200, data: {} });
    const html = '<script>window.pdcare.query("get_today_attention", {}).then(function(){});</script>';
    const { container } = render(
      <CopilotMessage
        message={{ key: "live", role: "assistant", content: `圖表\n\n\`\`\`html\n${html}\n\`\`\``, toolTrace: [] }}
      />,
    );
    const iframe = container.querySelector("iframe") as HTMLIFrameElement;
    const event = new MessageEvent("message", {
      data: { type: "pdcare:query", id: "q1", tool: "get_today_attention", params: {} },
    });
    Object.defineProperty(event, "source", { value: iframe.contentWindow, enumerable: true });
    window.dispatchEvent(event);

    await new Promise((resolve) => setTimeout(resolve, 0));
    // Previously this defaulted to off, so a live report rendered an empty shell.
    expect(queryCopilotProxy).toHaveBeenCalledWith("get_today_attention", {});
  });

  it("leaves live data off for a static report", async () => {
    const { container } = render(
      <CopilotMessage
        message={{ key: "static", role: "assistant", content: "圖表\n\n```html\n<p>42</p>\n```", toolTrace: [] }}
      />,
    );
    const iframe = container.querySelector("iframe") as HTMLIFrameElement;
    const event = new MessageEvent("message", {
      data: { type: "pdcare:query", id: "q1", tool: "get_today_attention", params: {} },
    });
    Object.defineProperty(event, "source", { value: iframe.contentWindow, enumerable: true });
    window.dispatchEvent(event);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(queryCopilotProxy).not.toHaveBeenCalled();
    expect(await screen.findByText(/需要即時資料才能顯示內容/)).toBeInTheDocument();
  });

  function emitArtifactError(iframe: HTMLIFrameElement, kind: string, message: string) {
    const event = new MessageEvent("message", {
      data: { type: "pdcare:error", kind, message, detail: "stack" },
    });
    Object.defineProperty(event, "source", { value: iframe.contentWindow, enumerable: true });
    // act() so the resulting state update is flushed before timers are advanced.
    act(() => {
      window.dispatchEvent(event);
    });
  }

  it("auto-repairs a script error without the reader clicking", async () => {
    jest.useFakeTimers();
    try {
      const onAutoRepair = jest.fn().mockReturnValue(true);
      const { container } = render(
        <CopilotMessage
          message={{ key: "auto", role: "assistant", content: "圖\n\n```html\n<p>c</p>\n```", toolTrace: [] }}
          onAutoRepair={onAutoRepair}
        />,
      );
      const iframe = container.querySelector("iframe") as HTMLIFrameElement;
      emitArtifactError(iframe, "script", "x is not defined");

      expect(onAutoRepair).not.toHaveBeenCalled(); // debounced, so repeated throws batch
      act(() => {
        jest.advanceTimersByTime(800);
      });
      expect(onAutoRepair).toHaveBeenCalledTimes(1);
      expect(onAutoRepair.mock.calls[0][0]).toEqual([
        expect.objectContaining({ kind: "script", message: "x is not defined" }),
      ]);
    } finally {
      jest.useRealTimers();
    }
  });

  it("does not auto-repair a failed data query", async () => {
    jest.useFakeTimers();
    try {
      const onAutoRepair = jest.fn().mockReturnValue(true);
      const { container } = render(
        <CopilotMessage
          message={{ key: "q", role: "assistant", content: "圖\n\n```html\n<p>c</p>\n```", toolTrace: [] }}
          onAutoRepair={onAutoRepair}
        />,
      );
      const iframe = container.querySelector("iframe") as HTMLIFrameElement;
      // Rate limiting or a permission denial is not something regenerating HTML can fix.
      emitArtifactError(iframe, "query", "查詢過於頻繁，請稍後再試。");
      act(() => {
        jest.advanceTimersByTime(2000);
      });
      expect(onAutoRepair).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it("falls back to the manual button when the thread declines auto-repair", async () => {
    jest.useFakeTimers();
    try {
      const onAutoRepair = jest.fn().mockReturnValue(false);
      const { container } = render(
        <CopilotMessage
          message={{ key: "declined", role: "assistant", content: "圖\n\n```html\n<p>c</p>\n```", toolTrace: [] }}
          onAutoRepair={onAutoRepair}
          onRequestRepair={jest.fn()}
        />,
      );
      const iframe = container.querySelector("iframe") as HTMLIFrameElement;
      emitArtifactError(iframe, "script", "boom");
      act(() => {
        jest.advanceTimersByTime(800);
      });
      expect(onAutoRepair).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("button", { name: /請 Copilot 修正/ })).toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });

  it("substitutes a handle for its resolved label in assistant prose", () => {
    render(
      <CopilotMessage
        message={{ key: "h1", role: "assistant", content: "P#3 近一個月上傳 5 次", toolTrace: [] }}
        handles={{ "P#3": { entity_type: "patient", label: "王小明 (P123456)" } }}
      />,
    );
    expect(screen.getByText("王小明 (P123456) 近一個月上傳 5 次")).toBeInTheDocument();
  });

  it("renders the bare handle when the viewer may not see that label", () => {
    render(
      <CopilotMessage
        message={{ key: "h2", role: "assistant", content: "P#3 需追蹤", toolTrace: [] }}
        handles={{ "P#3": { entity_type: "patient", label: null } }}
      />,
    );
    expect(screen.getByText("P#3 需追蹤")).toBeInTheDocument();
  });

  it("leaves a handle-shaped string inside an html artifact untouched", () => {
    const { container } = render(
      <CopilotMessage
        message={{ key: "h3", role: "assistant", content: "見下表\n\n```html\n<p>P#3</p>\n```", toolTrace: [] }}
        handles={{ "P#3": { entity_type: "patient", label: "王小明" } }}
      />,
    );
    expect(screen.getByText("見下表")).toBeInTheDocument();
    const iframe = container.querySelector("iframe") as HTMLIFrameElement;
    expect(iframe.srcdoc).toContain("<p>P#3</p>");
  });

  it("offers to save a rendered report as a module", async () => {
    createCopilotModule.mockReset();
    createCopilotModule.mockResolvedValue({
      module_id: 1,
      title: "感染趨勢",
      description: null,
      visibility: "private",
      owner_identity_id: 1,
      owner_name: null,
      is_owner: true,
      can_write: true,
      source_session_id: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      html: "<p>chart</p>",
    });

    render(
      <CopilotMessage
        message={{
          key: "save1",
          role: "assistant",
          content: "結論在圖中。\n\n```html\n<p>chart</p>\n```",
          toolTrace: [],
        }}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "儲存為模組" }));
    await userEvent.type(screen.getByPlaceholderText("例如：三月感染趨勢分析"), "感染趨勢");
    await userEvent.click(screen.getByRole("button", { name: "儲存" }));

    expect(createCopilotModule).toHaveBeenCalledWith(
      expect.objectContaining({ title: "感染趨勢", html: "<p>chart</p>", visibility: "private" }),
    );
  });

  it("offers to send artifact runtime errors back for repair", async () => {
    const onRequestRepair = jest.fn();
    const { container } = render(
      <CopilotMessage
        message={{ key: "a4", role: "assistant", content: "圖表如下。\n\n```html\n<p>c</p>\n```", toolTrace: [] }}
        onRequestRepair={onRequestRepair}
      />,
    );
    const iframe = container.querySelector("iframe") as HTMLIFrameElement;

    const event = new MessageEvent("message", {
      data: { type: "pdcare:error", kind: "script", message: "x is not defined (line 3:1)", detail: "stack" },
    });
    Object.defineProperty(event, "source", { value: iframe.contentWindow, enumerable: true });
    window.dispatchEvent(event);

    expect(await screen.findByText(/執行時發生錯誤/)).toBeInTheDocument();
    expect(screen.getByText("x is not defined (line 3:1)")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /請 Copilot 修正/ }));
    expect(onRequestRepair).toHaveBeenCalledWith(
      [expect.objectContaining({ kind: "script", message: "x is not defined (line 3:1)" })],
      // The report's own source goes with it, so the prompt can quote the code at the fault.
      expect.stringContaining("<p>c</p>"),
    );
  });
});

/**
 * The `&&` between the two layers: `parseAssistantContent` knows whether a fence closed and
 * the viewer knows not to mount an open block, but only this mapping decides which state a
 * streaming message is in -- and getting it wrong brings back the per-token reload.
 */
describe("CopilotMessage artifact state while streaming", () => {
  function renderMessage(content: string, isStreaming: boolean) {
    return render(
      <CopilotMessage
        message={{ key: "streaming", role: "assistant", content, toolTrace: [], isStreaming }}
      />,
    );
  }

  it("mounts no frame for a fence the model has not closed yet", () => {
    const { container } = renderMessage("先看趨勢：\n\n```html\n<div id=\"root\"></div>\n<script>\nconst d = await pdcare", true);
    expect(container.querySelector("iframe")).toBeNull();
    expect(screen.getByText("報表編輯中")).toBeInTheDocument();
  });

  it("mounts a frame for a closed fence even while prose is still streaming", () => {
    const { container } = renderMessage("```html\n<p>chart</p>\n```\n\n結論：這份報表", true);
    expect(container.querySelector("iframe")).not.toBeNull();
    expect(screen.queryByText("報表編輯中")).not.toBeInTheDocument();
  });

  it("marks a block the stopped turn never closed as unfinished rather than running it", () => {
    const { container } = renderMessage("```html\n<div>partial", false);
    expect(container.querySelector("iframe")).toBeNull();
    expect(screen.getByText("報表未完成")).toBeInTheDocument();
  });

  it("mounts a finished report from a persisted message", () => {
    const { container } = renderMessage("```html\n<p>chart</p>\n```", false);
    expect(container.querySelector("iframe")).not.toBeNull();
  });
});
