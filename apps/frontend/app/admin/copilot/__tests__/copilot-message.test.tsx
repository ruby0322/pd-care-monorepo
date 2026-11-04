import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CopilotMessage } from "@/app/admin/copilot/_components/copilot-message";
import { CopilotMarkdown } from "@/app/admin/copilot/_components/copilot-markdown";

jest.mock("@/lib/api/copilot", () => ({
  queryCopilotProxy: jest.fn(),
}));

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
    expect(onRequestRepair).toHaveBeenCalledWith([
      expect.objectContaining({ kind: "script", message: "x is not defined (line 3:1)" }),
    ]);
  });
});
