import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import CopilotPage from "@/app/admin/copilot/page";
import type { CopilotSessionDetail, CopilotSessionSummary, CopilotStreamEvent } from "@/lib/api/copilot";

jest.mock("@/lib/api/copilot", () => ({
  createCopilotSession: jest.fn(),
  deleteCopilotSession: jest.fn(),
  fetchCopilotModels: jest.fn(),
  fetchCopilotSession: jest.fn(),
  fetchCopilotSessions: jest.fn(),
  streamCopilotMessage: jest.fn(),
}));

jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("@/lib/auth/staff-session", () => ({ getStaffRole: jest.fn(() => "staff") }));

const {
  createCopilotSession,
  fetchCopilotModels,
  fetchCopilotSession,
  fetchCopilotSessions,
  streamCopilotMessage,
} = jest.requireMock("@/lib/api/copilot") as Record<string, jest.Mock>;

function summary(overrides: Partial<CopilotSessionSummary> = {}): CopilotSessionSummary {
  return {
    session_id: 7,
    title: "新對話",
    model: "gpt-6.1-terra",
    visibility: "private",
    owner_identity_id: 1,
    owner_name: null,
    is_owner: true,
    can_write: true,
    message_count: 0,
    created_at: "2026-11-11T08:00:00+08:00",
    updated_at: "2026-11-11T08:00:00+08:00",
    ...overrides,
  };
}

function detail(session: CopilotSessionSummary): CopilotSessionDetail {
  return { session, messages: [], handles: {} };
}

async function flushTimers(): Promise<void> {
  for (let i = 0; i < 3; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

describe("copilot new-chat screen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fetchCopilotModels.mockResolvedValue({
      enabled: true,
      models: ["gpt-6.1-terra", "gpt-6-luna"],
      default_model: "gpt-6.1-terra",
    });
    fetchCopilotSessions.mockResolvedValue([]);
    fetchCopilotSession.mockImplementation(async (id: number) => detail(summary({ session_id: id })));
    streamCopilotMessage.mockResolvedValue(undefined);
    createCopilotSession.mockResolvedValue(summary());
  });

  /**
   * A thread is opened by asking something, the way ChatGPT does it -- there is no dialog to
   * fill in first, so the composer on this screen is the create action.
   */
  it("creates the session from the first question, then sends it", async () => {
    render(<CopilotPage />);
    await flushTimers();

    const textarea = await screen.findByPlaceholderText("問 PD Copilot…");
    await userEvent.type(textarea, "最近出口感染有變多嗎？");
    await userEvent.click(screen.getByRole("button", { name: "送出" }));
    await flushTimers();

    expect(createCopilotSession).toHaveBeenCalledWith({ model: "gpt-6.1-terra", visibility: "private" });
    expect(streamCopilotMessage).toHaveBeenCalledWith(
      7,
      "最近出口感染有變多嗎？",
      expect.any(Function),
      expect.anything(),
    );
  });

  it("opens the thread with the model and scope chosen next to the input", async () => {
    render(<CopilotPage />);
    await flushTimers();

    await userEvent.selectOptions(screen.getByLabelText("模型"), "gpt-6-luna");
    await userEvent.selectOptions(screen.getByLabelText("可見範圍"), "staff");
    await userEvent.type(screen.getByPlaceholderText("問 PD Copilot…"), "請分析上傳頻率");
    await userEvent.click(screen.getByRole("button", { name: "送出" }));
    await flushTimers();

    expect(createCopilotSession).toHaveBeenCalledWith({ model: "gpt-6-luna", visibility: "staff" });
  });

  it("offers a staff user no admin-only scope", async () => {
    render(<CopilotPage />);
    await flushTimers();

    const values = Array.from(screen.getByLabelText("可見範圍").querySelectorAll("option")).map(
      (option) => (option as HTMLOptionElement).value,
    );
    expect(values).toEqual(["private", "staff"]);
  });

  /** A refused creation must not eat what the nurse typed. */
  it("keeps the question in the composer when the session cannot be created", async () => {
    createCopilotSession.mockRejectedValue(new Error("500"));
    render(<CopilotPage />);
    await flushTimers();

    const textarea = await screen.findByPlaceholderText("問 PD Copilot…");
    await userEvent.type(textarea, "請分析上傳頻率");
    await userEvent.click(screen.getByRole("button", { name: "送出" }));
    await flushTimers();

    expect(streamCopilotMessage).not.toHaveBeenCalled();
    expect(textarea).toHaveValue("請分析上傳頻率");
  });

  it("names the thread in place when the model's title arrives on the stream", async () => {
    let emit: ((event: CopilotStreamEvent) => void) | null = null;
    // Held open, because the title lands *during* the turn: letting the stream resolve would
    // run the end-of-turn refetch, and then the row's title would be the server's, not the
    // in-place update this test is about.
    streamCopilotMessage.mockImplementation(async (_id, _content, onEvent) => {
      emit = onEvent;
      await new Promise(() => {});
    });

    render(<CopilotPage />);
    await flushTimers();
    await userEvent.type(screen.getByPlaceholderText("問 PD Copilot…"), "最近出口感染有變多嗎？");
    await userEvent.click(screen.getByRole("button", { name: "送出" }));
    await flushTimers();
    await waitFor(() => expect(emit).not.toBeNull());

    await act(async () => {
      emit?.({ type: "session_title", title: "出口感染趨勢分析" });
    });

    // The rail row and the thread header both stop showing the placeholder title.
    expect(await screen.findByRole("button", { name: "出口感染趨勢分析" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("出口感染趨勢分析");
  });

  it("returns to the new-chat screen from the rail", async () => {
    fetchCopilotSessions.mockResolvedValue([summary({ session_id: 7, title: "既有對話" })]);
    render(<CopilotPage />);
    await flushTimers();
    // A thread is open, so the create screen's own controls are not on the page.
    expect(screen.queryByLabelText("可見範圍")).not.toBeInTheDocument();

    await userEvent.click(screen.getAllByRole("button", { name: "新對話" })[0]);
    await flushTimers();

    expect(screen.getByText("有什麼需要分析的？")).toBeInTheDocument();
    expect(screen.getByLabelText("可見範圍")).toBeInTheDocument();
    // Returning to the screen is a local move; nothing is created until a question is asked.
    expect(createCopilotSession).not.toHaveBeenCalled();
  });

  it("groups the rail by when a thread was last used", async () => {
    const now = new Date();
    const earlier = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    fetchCopilotSessions.mockResolvedValue([
      summary({ session_id: 1, title: "今天的對話", updated_at: now.toISOString() }),
      summary({ session_id: 2, title: "上個月的對話", updated_at: earlier }),
    ]);

    render(<CopilotPage />);
    await flushTimers();

    expect(screen.getByText("今天")).toBeInTheDocument();
    expect(screen.getByText("更早")).toBeInTheDocument();
  });
});
