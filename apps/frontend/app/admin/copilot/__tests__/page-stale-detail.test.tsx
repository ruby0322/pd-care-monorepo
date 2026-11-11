import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import CopilotPage from "@/app/admin/copilot/page";
import type { CopilotSessionDetail, CopilotSessionSummary } from "@/lib/api/copilot";

jest.mock("@/lib/api/copilot", () => ({
  createCopilotSession: jest.fn(),
  deleteCopilotSession: jest.fn(),
  fetchCopilotModels: jest.fn(),
  fetchCopilotSession: jest.fn(),
  fetchCopilotSessions: jest.fn(),
  streamCopilotMessage: jest.fn(),
}));

jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}));

jest.mock("@/lib/auth/staff-session", () => ({
  getStaffRole: jest.fn(() => "staff"),
}));

const { fetchCopilotModels, fetchCopilotSession, fetchCopilotSessions } = jest.requireMock(
  "@/lib/api/copilot",
) as {
  fetchCopilotModels: jest.Mock;
  fetchCopilotSession: jest.Mock;
  fetchCopilotSessions: jest.Mock;
};

function makeSummary(overrides: Partial<CopilotSessionSummary> = {}): CopilotSessionSummary {
  return {
    session_id: 1,
    title: "第一個對話",
    model: "gpt-6.1-terra",
    visibility: "private",
    owner_identity_id: 1,
    owner_name: null,
    is_owner: true,
    can_write: true,
    message_count: 1,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeDetail(sessionId: number, text: string): CopilotSessionDetail {
  return {
    session: makeSummary({ session_id: sessionId, title: `對話 ${sessionId}` }),
    messages: [
      {
        message_id: sessionId * 100,
        role: "assistant",
        content: text,
        model: "gpt-6.1-terra",
        tool_trace: [],
        created_at: "2026-01-01T00:00:00Z",
      },
    ],
    handles: {},
  };
}

/** Runs the page's `setTimeout(..., 0)` hops and flushes the React updates they cause. */
async function flushTimers(): Promise<void> {
  for (let i = 0; i < 3; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

describe("copilot page transcript loading", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fetchCopilotModels.mockResolvedValue({
      enabled: true,
      models: [{ id: "gpt-6.1-terra", label: "6.1 Terra" }],
      default_model: "gpt-6.1-terra",
    });
  });

  /**
   * The regression the branch review flagged: `activeDetail` hides a mismatched payload but
   * does not stop it being stored. Before the guard, a slow fetch for session 1 resolving
   * after session 2 still wrote `detail = 1` and flipped `isLoadingDetail` off, leaving
   * `activeDetail === null` with nothing in flight — a transcript stuck as a skeleton until
   * the nurse clicked the session again.
   */
  it("ignores a detail response for a session the nurse has already left", async () => {
    fetchCopilotSessions.mockResolvedValue([
      makeSummary({ session_id: 1, title: "對話 1" }),
      makeSummary({ session_id: 2, title: "對話 2" }),
    ]);

    let resolveFirst: ((value: CopilotSessionDetail) => void) | null = null;
    fetchCopilotSession.mockImplementation((sessionId: number) => {
      if (sessionId === 1) {
        return new Promise<CopilotSessionDetail>((resolve) => {
          resolveFirst = resolve;
        });
      }
      return Promise.resolve(makeDetail(2, "第二個對話的結論"));
    });

    render(<CopilotPage />);
    await flushTimers();
    await waitFor(() => expect(resolveFirst).not.toBeNull());

    // Switch away while session 1 is still in flight; session 2 resolves immediately.
    await userEvent.click(screen.getByRole("button", { name: "對話 2" }));
    await flushTimers();
    expect(await screen.findByText("第二個對話的結論")).toBeInTheDocument();

    // Session 1's response lands late. It must be dropped, not stored.
    await act(async () => {
      resolveFirst?.(makeDetail(1, "第一個對話的結論"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flushTimers();

    expect(screen.getByText("第二個對話的結論")).toBeInTheDocument();
    expect(screen.queryByText("第一個對話的結論")).not.toBeInTheDocument();
  });
});
