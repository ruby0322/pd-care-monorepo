import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { buildArtifactDocument } from "@/app/admin/copilot/_components/artifact-bridge";
import ModulesPage from "@/app/admin/modules/page";
import type { CopilotModuleDetail, CopilotModuleSummary } from "@/lib/api/copilot";

jest.mock("@/lib/api/copilot", () => ({
  fetchCopilotModules: jest.fn(),
  fetchCopilotModule: jest.fn(),
  deleteCopilotModule: jest.fn(),
  queryCopilotProxy: jest.fn(),
}));

jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}));

const { fetchCopilotModules, fetchCopilotModule, deleteCopilotModule, queryCopilotProxy } = jest.requireMock(
  "@/lib/api/copilot",
) as {
  fetchCopilotModules: jest.Mock;
  fetchCopilotModule: jest.Mock;
  deleteCopilotModule: jest.Mock;
  queryCopilotProxy: jest.Mock;
};
const { toast } = jest.requireMock("sonner") as { toast: { error: jest.Mock; success: jest.Mock } };

function makeSummary(overrides: Partial<CopilotModuleSummary> = {}): CopilotModuleSummary {
  return {
    module_id: 1,
    title: "感染趨勢模組",
    description: null,
    visibility: "private",
    owner_identity_id: 1,
    owner_name: null,
    is_owner: true,
    can_write: true,
    source_session_id: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeDetail(overrides: Partial<CopilotModuleDetail> = {}): CopilotModuleDetail {
  return { ...makeSummary(overrides), html: "<p>chart</p>", ...overrides };
}

async function flushTimers() {
  for (let round = 0; round < 3; round += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

describe("ModulesPage selection grid", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fetchCopilotModule.mockImplementation(async (id: number) => makeDetail({ module_id: id }));
  });

  it("shows a card per module, with scope, author and date", async () => {
    fetchCopilotModules.mockResolvedValue([
      makeSummary({ module_id: 1, title: "我的模組", description: "我自己存的" }),
      makeSummary({
        module_id: 2,
        title: "同事的模組",
        description: "張小美存的",
        visibility: "staff",
        is_owner: false,
        owner_name: "張小美",
        updated_at: "2026-11-11T00:00:00Z",
      }),
    ]);

    render(<ModulesPage />);
    await flushTimers();

    expect(await screen.findByText("我的模組")).toBeInTheDocument();
    expect(screen.getByText("同事的模組")).toBeInTheDocument();
    expect(screen.getByText("我自己存的")).toBeInTheDocument();
    expect(screen.getByText("護理師可見")).toBeInTheDocument();
    // The author is named only where it is not you.
    expect(screen.getByText("張小美")).toBeInTheDocument();
  });

  it("opens a module through its own address, so it can be linked and gone back from", async () => {
    fetchCopilotModules.mockResolvedValue([makeSummary({ module_id: 7, title: "上傳與標注明細" })]);

    render(<ModulesPage />);
    await flushTimers();

    const link = await screen.findByRole("link", { name: /開啟模組「上傳與標注明細」/ });
    expect(link).toHaveAttribute("href", "/admin/modules/7");
  });

  /**
   * The preview renders a colleague's markup, but a card must not become a way to spend the
   * viewer's permissions on it: no card, visible or not, may reach the proxy.
   */
  it("previews without querying anything", async () => {
    fetchCopilotModules.mockResolvedValue([
      makeSummary({ module_id: 1 }),
      makeSummary({ module_id: 2, is_owner: false, owner_name: "張小美", visibility: "staff" }),
    ]);

    const { container } = render(<ModulesPage />);
    await flushTimers();

    expect(queryCopilotProxy).not.toHaveBeenCalled();

    // The preview is a frame, but an inert one: not focusable, hidden from assistive tech,
    // and the same sandboxed document the chat path builds.
    const frames = Array.from(container.querySelectorAll("iframe"));
    expect(frames.length).toBeGreaterThan(0);
    for (const frame of frames) {
      expect(frame).toHaveAttribute("aria-hidden", "true");
      expect(frame).toHaveAttribute("tabindex", "-1");
      expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
      expect(frame.srcdoc).toBe(buildArtifactDocument("<p>chart</p>"));
    }
  });

  it("answers a preview's query itself instead of leaving it to time out", async () => {
    fetchCopilotModules.mockResolvedValue([makeSummary({ module_id: 1 })]);
    const { container } = render(<ModulesPage />);
    await flushTimers();

    const frame = container.querySelector("iframe") as HTMLIFrameElement;
    const replies: unknown[] = [];
    if (frame.contentWindow) {
      jest.spyOn(frame.contentWindow, "postMessage").mockImplementation((payload: unknown) => replies.push(payload));
    }

    const event = new MessageEvent("message", {
      data: { type: "pdcare:query", id: "q1", tool: "list_patients", params: {} },
    });
    Object.defineProperty(event, "source", { value: frame.contentWindow, enumerable: true });
    act(() => {
      window.dispatchEvent(event);
    });

    expect(queryCopilotProxy).not.toHaveBeenCalled();
    expect(JSON.stringify(replies)).toContain("預覽不連線即時資料");
  });

  it("deletes a module of your own from its card", async () => {
    fetchCopilotModules.mockResolvedValue([makeSummary({ module_id: 3, title: "舊模組" })]);
    deleteCopilotModule.mockResolvedValue(undefined);
    jest.spyOn(window, "confirm").mockReturnValue(true);

    render(<ModulesPage />);
    await flushTimers();

    await userEvent.click(await screen.findByRole("button", { name: /刪除模組「舊模組」/ }));
    await waitFor(() => expect(deleteCopilotModule).toHaveBeenCalledWith(3));
    await waitFor(() => expect(screen.queryByText("舊模組")).not.toBeInTheDocument());
  });

  it("offers no delete control on someone else's module", async () => {
    fetchCopilotModules.mockResolvedValue([
      makeSummary({ module_id: 4, title: "同事的模組", is_owner: false, owner_name: "張小美", visibility: "staff" }),
    ]);

    render(<ModulesPage />);
    await flushTimers();

    expect(await screen.findByText("同事的模組")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /刪除模組/ })).not.toBeInTheDocument();
  });

  it("shows an invitation rather than an error when the list is empty", async () => {
    fetchCopilotModules.mockResolvedValue([]);
    render(<ModulesPage />);
    await flushTimers();

    expect(await screen.findByText("還沒有任何模組")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /去 PD Copilot/ })).toBeInTheDocument();
  });

  it("says the list failed to load rather than showing the new-user invitation", async () => {
    fetchCopilotModules.mockRejectedValue(new Error("boom"));
    render(<ModulesPage />);
    await flushTimers();

    expect(await screen.findByText("無法載入模組列表")).toBeInTheDocument();
    expect(screen.queryByText("還沒有任何模組")).not.toBeInTheDocument();
    expect(toast.error).toHaveBeenCalled();
  });
});
