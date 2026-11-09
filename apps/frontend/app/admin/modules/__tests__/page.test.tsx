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
  toast: {
    success: jest.fn(),
    error: jest.fn(),
  },
}));

const { fetchCopilotModules, fetchCopilotModule, queryCopilotProxy } = jest.requireMock("@/lib/api/copilot") as {
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
  return {
    ...makeSummary(overrides),
    html: "<p>chart</p>",
    ...overrides,
  };
}

/**
 * Runs every `setTimeout(..., 0)` the page has scheduled, and the ones those schedule in
 * turn, flushing the React updates each causes. A "nothing ran" assertion needs this:
 * otherwise it can pass merely because the selection had not happened *yet*, which is the
 * same way an assertion made before React flushes passes against the code it should catch.
 */
async function flushTimers() {
  for (let round = 0; round < 3; round += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

describe("ModulesPage", () => {
  it("lists modules the viewer can see, with an owner badge on shared ones", async () => {
    fetchCopilotModules.mockResolvedValue([
      makeSummary({ module_id: 1, title: "我的模組", is_owner: true, owner_name: null }),
      makeSummary({ module_id: 2, title: "同事的模組", is_owner: false, owner_name: "陳護理師", visibility: "staff" }),
    ]);
    fetchCopilotModule.mockResolvedValue(makeDetail({ module_id: 1, title: "我的模組" }));

    render(<ModulesPage />);

    expect(await screen.findByText("我的模組")).toBeInTheDocument();
    expect(screen.getByText("同事的模組")).toBeInTheDocument();
    expect(screen.getByText("陳護理師")).toBeInTheDocument();
  });

  // A module is code someone else wrote, run in this viewer's browser behind a bridge that
  // answers `pdcare.query` with the viewer's own token. So nothing another user wrote may
  // execute until the viewer asks for it by name.
  it("does not auto-select a colleague's module, so opening the page runs nobody's code unasked", async () => {
    fetchCopilotModules.mockResolvedValue([
      makeSummary({
        module_id: 2,
        title: "同事的模組",
        is_owner: false,
        owner_name: "陳護理師",
        visibility: "staff",
      }),
    ]);
    fetchCopilotModule.mockResolvedValue(
      makeDetail({ module_id: 2, title: "同事的模組", is_owner: false, html: "<script>boom()</script>" }),
    );

    render(<ModulesPage />);

    expect(await screen.findByText("同事的模組")).toBeInTheDocument();
    await flushTimers();

    expect(fetchCopilotModule).not.toHaveBeenCalled();
    expect(screen.queryByTitle("PD Copilot 報表")).not.toBeInTheDocument();
    expect(screen.getByText(/請從左側選擇/)).toBeInTheDocument();
  });

  it("auto-selects the newest module the viewer owns, skipping a newer shared one", async () => {
    fetchCopilotModules.mockResolvedValue([
      makeSummary({
        module_id: 2,
        title: "同事的模組",
        is_owner: false,
        owner_name: "陳護理師",
        visibility: "staff",
      }),
      makeSummary({ module_id: 1, title: "我的模組", is_owner: true }),
    ]);
    fetchCopilotModule.mockResolvedValue(makeDetail({ module_id: 1, title: "我的模組", is_owner: true }));

    render(<ModulesPage />);

    // A module the viewer owns keeps today's behaviour: it renders immediately, live on.
    expect(await screen.findByTitle("PD Copilot 報表")).toBeInTheDocument();
    expect(fetchCopilotModule).toHaveBeenCalledWith(1);
    expect(fetchCopilotModule).not.toHaveBeenCalledWith(2);
  });

  it("holds a module the viewer does not own behind an explicit run control", async () => {
    fetchCopilotModules.mockResolvedValue([
      makeSummary({
        module_id: 2,
        title: "同事的模組",
        description: "本週交班表",
        is_owner: false,
        owner_name: "陳護理師",
        visibility: "staff",
      }),
    ]);
    fetchCopilotModule.mockResolvedValue(
      makeDetail({
        module_id: 2,
        title: "同事的模組",
        description: "本週交班表",
        is_owner: false,
        owner_name: "陳護理師",
        html: "<p>chart</p>",
      }),
    );

    render(<ModulesPage />);

    await userEvent.click(await screen.findByText("同事的模組"));

    // Title, description and author are readable before anything runs, so the viewer can
    // decide; the warning says whose code it is and whose data access it will use.
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("同事的模組");
    expect(screen.getByText("本週交班表")).toBeInTheDocument();
    expect(screen.getByText(/由 陳護理師 分享/)).toBeInTheDocument();
    expect(screen.getByText(/由其他使用者撰寫/)).toBeInTheDocument();
    expect(screen.queryByTitle("PD Copilot 報表")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /執行此模組/ }));

    expect(await screen.findByTitle("PD Copilot 報表")).toBeInTheDocument();
  });

  it("re-arms the run control when the viewer switches to another module they do not own", async () => {
    fetchCopilotModules.mockResolvedValue([
      makeSummary({ module_id: 2, title: "同事 A 的模組", is_owner: false, owner_name: "A", visibility: "staff" }),
      makeSummary({ module_id: 3, title: "同事 B 的模組", is_owner: false, owner_name: "B", visibility: "staff" }),
    ]);
    fetchCopilotModule.mockImplementation(async (moduleId: number) =>
      makeDetail({
        module_id: moduleId,
        title: moduleId === 2 ? "同事 A 的模組" : "同事 B 的模組",
        is_owner: false,
        owner_name: moduleId === 2 ? "A" : "B",
        html: "<p>chart</p>",
      }),
    );

    render(<ModulesPage />);

    await userEvent.click(await screen.findByText("同事 A 的模組"));
    await userEvent.click(await screen.findByRole("button", { name: /執行此模組/ }));
    expect(await screen.findByTitle("PD Copilot 報表")).toBeInTheDocument();

    // One consent arms one module. Switching selection must not carry it over.
    await userEvent.click(screen.getByText("同事 B 的模組"));

    expect(await screen.findByRole("button", { name: /執行此模組/ })).toBeInTheDocument();
    expect(screen.queryByTitle("PD Copilot 報表")).not.toBeInTheDocument();
  });

  it("renders a chosen module in the sandboxed frame with live data on", async () => {
    fetchCopilotModules.mockResolvedValue([makeSummary({ module_id: 1, title: "體液趨勢" })]);
    fetchCopilotModule.mockResolvedValue(makeDetail({ module_id: 1, title: "體液趨勢", html: "<p>chart</p>" }));
    queryCopilotProxy.mockResolvedValue({ tool: "list_patients", ok: true, status: 200, data: { items: [] } });

    render(<ModulesPage />);

    await userEvent.click(await screen.findByText("體液趨勢"));
    const iframe = (await screen.findByTitle("PD Copilot 報表")) as HTMLIFrameElement;

    const event = new MessageEvent("message", {
      data: { type: "pdcare:query", id: "q1", tool: "list_patients", params: {} },
    });
    Object.defineProperty(event, "source", { value: iframe.contentWindow, enumerable: true });
    window.dispatchEvent(event);

    await waitFor(() => expect(queryCopilotProxy).toHaveBeenCalledWith("list_patients", {}));
  });

  it("ignores a stale detail response so a faster, more recent selection is never overwritten", async () => {
    fetchCopilotModules.mockResolvedValue([
      makeSummary({ module_id: 1, title: "模組 A" }),
      makeSummary({ module_id: 2, title: "模組 B" }),
    ]);
    const resolvers = new Map<number, (detail: CopilotModuleDetail) => void>();
    fetchCopilotModule.mockImplementation(
      (moduleId: number) =>
        new Promise<CopilotModuleDetail>((resolve) => {
          resolvers.set(moduleId, resolve);
        }),
    );

    render(<ModulesPage />);

    // Module A is auto-selected as soon as the list loads, kicking off its (slow) detail fetch.
    await waitFor(() => expect(fetchCopilotModule).toHaveBeenCalledWith(1));

    // The viewer clicks away to B before A resolves, kicking off a second (fast) fetch.
    await userEvent.click(await screen.findByText("模組 B"));
    await waitFor(() => expect(fetchCopilotModule).toHaveBeenCalledWith(2));

    // B resolves first. Resolving inside `act` (rather than a bare call plus a timeout) is
    // what makes this deterministic: it flushes the resulting state update and re-render
    // before the assertion runs, instead of racing an arbitrary wait against the scheduler.
    await act(async () => {
      resolvers.get(2)!(makeDetail({ module_id: 2, title: "模組 B", html: "<p>B</p>" }));
    });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("模組 B");

    // A's stale response lands after B is already showing. It must not overwrite B, and it
    // must not leave the pane blank (every render branch falling through to `null`).
    await act(async () => {
      resolvers.get(1)!(makeDetail({ module_id: 1, title: "模組 A", html: "<p>A</p>" }));
    });

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("模組 B");
    expect(screen.queryByText(/請從左側選擇/)).not.toBeInTheDocument();
  });

  it("shows an invitation rather than an error when the list is empty", async () => {
    fetchCopilotModules.mockResolvedValue([]);

    render(<ModulesPage />);

    expect(await screen.findByText(/還沒有任何模組/)).toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("says the list failed to load rather than showing the new-user invitation", async () => {
    fetchCopilotModules.mockRejectedValue(new Error("boom"));

    render(<ModulesPage />);

    // A nurse with twenty saved modules must not be told she has none.
    expect(await screen.findByText(/無法載入模組列表/)).toBeInTheDocument();
    expect(screen.queryByText(/還沒有任何模組/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /重新載入/ })).toBeInTheDocument();
  });

  it("shows a way out when a selected module cannot be fetched, and refreshes the list", async () => {
    fetchCopilotModules.mockResolvedValue([makeSummary({ module_id: 1, title: "已刪除的模組" })]);
    fetchCopilotModule.mockRejectedValue(new Error("Request failed with status code 404"));

    render(<ModulesPage />);

    // Previously this left a blank pane behind a toast that had already gone, with the
    // dead entry still in a list that was never re-fetched.
    expect(await screen.findByText(/無法開啟這個模組/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /重試/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /返回列表/ })).toBeInTheDocument();
    await waitFor(() => expect(fetchCopilotModules).toHaveBeenCalledTimes(2));
  });

  it("runs a module through the same sandbox and CSP as a chat artifact", async () => {
    const html = "<p>chart</p>";
    fetchCopilotModules.mockResolvedValue([makeSummary({ module_id: 1, title: "體液趨勢" })]);
    fetchCopilotModule.mockResolvedValue(makeDetail({ module_id: 1, title: "體液趨勢", html }));

    render(<ModulesPage />);

    const iframe = (await screen.findByTitle("PD Copilot 報表")) as HTMLIFrameElement;

    // The spec's requirement is "no divergent rendering path", so this pins the posture
    // itself, not merely that the shared component was used: opaque origin, and the same
    // document -- injected CSP included -- that the chat path builds.
    expect(iframe.getAttribute("sandbox")).toBe("allow-scripts");
    expect(iframe.srcdoc).toBe(buildArtifactDocument(html));
    expect(iframe.srcdoc).toContain("default-src 'none'");
    expect(iframe.srcdoc).toContain("connect-src 'none'");

    // The 即時資料 control is not rendered here: a module always runs live, and the button
    // had no handler behind it.
    expect(screen.queryByRole("button", { name: /即時資料/ })).not.toBeInTheDocument();
  });

  it("keeps auto-repair off, since a saved module has no live session", async () => {
    fetchCopilotModules.mockResolvedValue([makeSummary({ module_id: 1, title: "壞掉的模組" })]);
    fetchCopilotModule.mockResolvedValue(
      makeDetail({ module_id: 1, title: "壞掉的模組", html: "<script>boom()</script>" }),
    );

    render(<ModulesPage />);

    await userEvent.click(await screen.findByText("壞掉的模組"));
    const iframe = (await screen.findByTitle("PD Copilot 報表")) as HTMLIFrameElement;

    const event = new MessageEvent("message", {
      data: { type: "pdcare:error", kind: "script", message: "boom is not defined" },
    });
    Object.defineProperty(event, "source", { value: iframe.contentWindow, enumerable: true });
    window.dispatchEvent(event);

    expect(await screen.findByText(/執行時發生錯誤/)).toBeInTheDocument();

    // 「已回報，Copilot 修正中」 can only appear once the artifact's 700 ms auto-repair
    // debounce has elapsed, and `findByText` above resolves well inside it -- so asserting
    // immediately would pass even against a page that *did* wire `onAutoRepair`, which is
    // the regression this test is named for. A real wait rather than fake timers because
    // the debounce timer, in that regression, is created by the component before the test
    // could install them.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 900));
    });

    // No live session exists for a saved module, so neither auto-repair nor the
    // chat-bound manual button should ever appear here.
    expect(screen.queryByText(/Copilot 修正中/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /請 Copilot 修正/ })).not.toBeInTheDocument();
    const repairLink = screen.getByRole("link", { name: /在 Copilot 中開啟修正/ });
    expect(repairLink).toHaveAttribute("href", "/admin/copilot");
  });
});
