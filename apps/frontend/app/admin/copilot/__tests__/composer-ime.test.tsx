import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

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

const { fetchCopilotModels, fetchCopilotSession, fetchCopilotSessions, streamCopilotMessage } =
  jest.requireMock("@/lib/api/copilot") as {
    fetchCopilotModels: jest.Mock;
    fetchCopilotSession: jest.Mock;
    fetchCopilotSessions: jest.Mock;
    streamCopilotMessage: jest.Mock;
  };

function makeSummary(): CopilotSessionSummary {
  return {
    session_id: 1,
    title: "第一個對話",
    model: "gpt-6.1-terra",
    visibility: "private",
    owner_identity_id: 1,
    owner_name: null,
    is_owner: true,
    can_write: true,
    message_count: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

function makeDetail(): CopilotSessionDetail {
  return { session: makeSummary(), messages: [], handles: {} };
}

async function flushTimers(): Promise<void> {
  for (let i = 0; i < 3; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function renderComposer(): Promise<HTMLTextAreaElement> {
  render(<CopilotPage />);
  await flushTimers();
  const textarea = await screen.findByPlaceholderText("問 PD Copilot…");
  await waitFor(() => expect(textarea).not.toBeDisabled());
  return textarea as HTMLTextAreaElement;
}

/** Types into the composer the way an IME does: composition events, then a value change. */
function compose(textarea: HTMLTextAreaElement, value: string): void {
  fireEvent.compositionStart(textarea);
  fireEvent.change(textarea, { target: { value } });
}

describe("copilot composer with a CJK IME", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fetchCopilotModels.mockResolvedValue({
      enabled: true,
      models: [{ id: "gpt-6.1-terra", label: "6.1 Terra" }],
      default_model: "gpt-6.1-terra",
    });
    fetchCopilotSessions.mockResolvedValue([makeSummary()]);
    fetchCopilotSession.mockResolvedValue(makeDetail());
    streamCopilotMessage.mockResolvedValue(undefined);
  });

  it("does not send when Enter picks a candidate (Chromium: isComposing + keyCode 229)", async () => {
    const textarea = await renderComposer();
    compose(textarea, "病人");
    fireEvent.keyDown(textarea, { key: "Enter", keyCode: 229, isComposing: true });
    await flushTimers();

    expect(streamCopilotMessage).not.toHaveBeenCalled();
    expect(textarea.value).toBe("病人");
  });

  it("does not send when Safari ends composition before the Enter keydown", async () => {
    const textarea = await renderComposer();
    compose(textarea, "病人");
    fireEvent.compositionEnd(textarea);
    fireEvent.keyDown(textarea, { key: "Enter", keyCode: 13 });

    expect(streamCopilotMessage).not.toHaveBeenCalled();
    await flushTimers();
    expect(textarea.value).toBe("病人");
  });

  it("sends on the next Enter, once composition has finished", async () => {
    const textarea = await renderComposer();
    compose(textarea, "病人近況如何");
    fireEvent.compositionEnd(textarea);
    await flushTimers();

    fireEvent.keyDown(textarea, { key: "Enter", keyCode: 13 });
    await flushTimers();

    expect(streamCopilotMessage).toHaveBeenCalledWith(
      1,
      "病人近況如何",
      expect.any(Function),
      expect.anything(),
    );
  });

  it("still inserts a newline on Shift+Enter", async () => {
    const textarea = await renderComposer();
    fireEvent.change(textarea, { target: { value: "第一行" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true, keyCode: 13 });
    await flushTimers();

    expect(streamCopilotMessage).not.toHaveBeenCalled();
  });
});
