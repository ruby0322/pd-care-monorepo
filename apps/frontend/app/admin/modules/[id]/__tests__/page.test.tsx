import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { buildArtifactDocument } from "@/app/admin/copilot/_components/artifact-bridge";
import ModulePage from "@/app/admin/modules/[id]/page";
import type { CopilotModuleDetail } from "@/lib/api/copilot";

jest.mock("@/lib/api/copilot", () => ({
  fetchCopilotModules: jest.fn(),
  fetchCopilotModule: jest.fn(),
  deleteCopilotModule: jest.fn(),
  queryCopilotProxy: jest.fn(),
}));

jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}));

const push = jest.fn();
let routeParams: { id: string } = { id: "1" };

jest.mock("next/navigation", () => ({
  useParams: () => routeParams,
  useRouter: () => ({ push }),
}));

const { fetchCopilotModule, deleteCopilotModule, queryCopilotProxy } = jest.requireMock("@/lib/api/copilot") as {
  fetchCopilotModule: jest.Mock;
  deleteCopilotModule: jest.Mock;
  queryCopilotProxy: jest.Mock;
};
const { toast } = jest.requireMock("sonner") as { toast: { error: jest.Mock } };

function makeDetail(overrides: Partial<CopilotModuleDetail> = {}): CopilotModuleDetail {
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
    html: "<p>chart</p>",
    ...overrides,
  };
}

async function flushTimers() {
  for (let round = 0; round < 3; round += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

describe("ModulePage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    routeParams = { id: "1" };
  });

  it("puts the module's name and a way back at the top", async () => {
    fetchCopilotModule.mockResolvedValue(makeDetail({ title: "上傳與標注明細" }));

    render(<ModulePage />);
    await flushTimers();

    expect(await screen.findByRole("heading", { name: "上傳與標注明細" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "返回模組列表" })).toHaveAttribute("href", "/admin/modules");
  });

  it("runs your own module through the same sandbox and CSP as a chat artifact", async () => {
    fetchCopilotModule.mockResolvedValue(makeDetail({ html: "<p>my chart</p>" }));

    const { container } = render(<ModulePage />);
    await flushTimers();

    const frame = (await screen.findByTitle("PD Copilot 報表")) as HTMLIFrameElement;
    // The posture, not the literal string: scripts and downloads granted, reach denied.
    const sandbox = (frame.getAttribute("sandbox") ?? "").split(" ").filter(Boolean);
    expect(sandbox.sort()).toEqual(["allow-downloads", "allow-scripts"]);
    expect(frame.srcdoc).toBe(buildArtifactDocument("<p>my chart</p>"));
    expect(frame.srcdoc).toContain("default-src 'none'");
    expect(frame.srcdoc).toContain("connect-src 'none'");
    // A module always runs live, so the 即時資料 toggle is not offered.
    expect(screen.queryByRole("button", { name: /即時資料/ })).not.toBeInTheDocument();
    expect(container.querySelectorAll("iframe")).toHaveLength(1);
  });

  /**
   * A module's HTML is code a colleague wrote, and the bridge answers its queries with the
   * viewer's own permissions — so it reads whatever the viewer can read, not what the author
   * could. That is granted by a click, never by arriving on the page.
   */
  it("holds someone else's module behind an explicit run control", async () => {
    fetchCopilotModule.mockResolvedValue(
      makeDetail({ is_owner: false, owner_name: "張小美", visibility: "staff", title: "同事的模組" }),
    );

    const { container } = render(<ModulePage />);
    await flushTimers();

    expect(await screen.findByText("這是 張小美 建立的模組")).toBeInTheDocument();
    expect(container.querySelector("iframe")).toBeNull();
    expect(queryCopilotProxy).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: /執行此模組/ }));

    expect(await screen.findByTitle("PD Copilot 報表")).toBeInTheDocument();
  });

  it("offers delete on your own module and not on anyone else's", async () => {
    fetchCopilotModule.mockResolvedValue(makeDetail({ is_owner: false, owner_name: "張小美", visibility: "staff" }));
    const { unmount } = render(<ModulePage />);
    await flushTimers();
    expect(screen.queryByRole("button", { name: "刪除模組" })).not.toBeInTheDocument();
    unmount();

    fetchCopilotModule.mockResolvedValue(makeDetail());
    render(<ModulePage />);
    await flushTimers();
    expect(await screen.findByRole("button", { name: "刪除模組" })).toBeInTheDocument();
  });

  it("returns to the list after deleting", async () => {
    fetchCopilotModule.mockResolvedValue(makeDetail({ module_id: 5 }));
    deleteCopilotModule.mockResolvedValue(undefined);
    jest.spyOn(window, "confirm").mockReturnValue(true);

    render(<ModulePage />);
    await flushTimers();

    await userEvent.click(await screen.findByRole("button", { name: "刪除模組" }));
    await waitFor(() => expect(deleteCopilotModule).toHaveBeenCalledWith(5));
    expect(push).toHaveBeenCalledWith("/admin/modules");
  });

  it("shows a way out when the module cannot be fetched", async () => {
    fetchCopilotModule.mockRejectedValue(new Error("gone"));

    render(<ModulePage />);
    await flushTimers();

    expect(await screen.findByText("無法開啟這個模組")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "返回模組列表" })).toBeInTheDocument();
    expect(toast.error).toHaveBeenCalled();
  });

  it("does not fetch at all for a non-numeric address", async () => {
    routeParams = { id: "not-a-number" };

    render(<ModulePage />);
    await flushTimers();

    expect(fetchCopilotModule).not.toHaveBeenCalled();
    expect(await screen.findByText("無法開啟這個模組")).toBeInTheDocument();
  });
});
