import { apiClient, resolveApiBaseUrl } from "@/lib/api/client";
import { getStaffAccessToken } from "@/lib/auth/staff-session";

export type CopilotVisibility = "private" | "staff" | "admin";

export type CopilotModelsResponse = {
  enabled: boolean;
  models: string[];
  default_model: string | null;
};

export type CopilotToolTraceEntry = {
  tool: string;
  params?: Record<string, unknown>;
  ok: boolean;
  status: number | null;
  truncated?: boolean;
  duration_ms?: number;
};

export type CopilotSessionSummary = {
  session_id: number;
  title: string;
  model: string;
  visibility: CopilotVisibility;
  owner_identity_id: number;
  owner_name: string | null;
  is_owner: boolean;
  can_write: boolean;
  message_count: number;
  created_at: string;
  updated_at: string;
};

export type CopilotMessageItem = {
  message_id: number;
  role: "user" | "assistant";
  content: string;
  model: string | null;
  tool_trace: CopilotToolTraceEntry[];
  created_at: string;
};

/**
 * A de-identified handle's real-world label, resolved for one viewer. `label` is
 * `null` whenever the viewer may not see the underlying entity (e.g. a patient not
 * assigned to this staff member) — that is a permission denial, not a missing value,
 * so the UI must render the bare handle rather than treating it as "unknown".
 */
export type CopilotHandleLabel = {
  entity_type: string;
  label: string | null;
};

export type CopilotSessionDetail = {
  session: CopilotSessionSummary;
  messages: CopilotMessageItem[];
  handles: Record<string, CopilotHandleLabel>;
};

export async function fetchCopilotModels(): Promise<CopilotModelsResponse> {
  const response = await apiClient.get<CopilotModelsResponse>("/v1/copilot/models");
  return response.data;
}

export async function fetchCopilotSessions(): Promise<CopilotSessionSummary[]> {
  const response = await apiClient.get<{ items: CopilotSessionSummary[] }>("/v1/copilot/sessions");
  return response.data.items;
}

export async function createCopilotSession(payload: {
  title?: string;
  model?: string;
  visibility: CopilotVisibility;
}): Promise<CopilotSessionSummary> {
  const response = await apiClient.post<CopilotSessionSummary>("/v1/copilot/sessions", payload);
  return response.data;
}

export async function fetchCopilotSession(sessionId: number): Promise<CopilotSessionDetail> {
  const response = await apiClient.get<CopilotSessionDetail>(`/v1/copilot/sessions/${sessionId}`);
  return response.data;
}

export async function updateCopilotSession(
  sessionId: number,
  payload: { title?: string; model?: string; visibility?: CopilotVisibility },
): Promise<CopilotSessionSummary> {
  const response = await apiClient.patch<CopilotSessionSummary>(`/v1/copilot/sessions/${sessionId}`, payload);
  return response.data;
}

export async function deleteCopilotSession(sessionId: number): Promise<void> {
  await apiClient.delete(`/v1/copilot/sessions/${sessionId}`);
}

export type CopilotModuleSummary = {
  module_id: number;
  title: string;
  description: string | null;
  visibility: CopilotVisibility;
  owner_identity_id: number;
  owner_name: string | null;
  is_owner: boolean;
  can_write: boolean;
  source_session_id: number | null;
  created_at: string;
  updated_at: string;
};

export type CopilotModuleDetail = CopilotModuleSummary & {
  html: string;
};

export async function fetchCopilotModules(): Promise<CopilotModuleSummary[]> {
  const response = await apiClient.get<{ items: CopilotModuleSummary[] }>("/v1/copilot/modules");
  return response.data.items;
}

export async function createCopilotModule(payload: {
  title: string;
  description?: string;
  html: string;
  visibility: CopilotVisibility;
  source_session_id?: number;
  source_message_id?: number;
}): Promise<CopilotModuleDetail> {
  const response = await apiClient.post<CopilotModuleDetail>("/v1/copilot/modules", payload);
  return response.data;
}

export async function fetchCopilotModule(moduleId: number): Promise<CopilotModuleDetail> {
  const response = await apiClient.get<CopilotModuleDetail>(`/v1/copilot/modules/${moduleId}`);
  return response.data;
}

export async function deleteCopilotModule(moduleId: number): Promise<void> {
  await apiClient.delete(`/v1/copilot/modules/${moduleId}`);
}

export type CopilotProxyResult = {
  tool: string;
  ok: boolean;
  status: number | null;
  data: unknown;
};

export async function queryCopilotProxy(tool: string, params: Record<string, unknown>): Promise<CopilotProxyResult> {
  const response = await apiClient.post<CopilotProxyResult>("/v1/copilot/proxy", { tool, params });
  return response.data;
}

export type CopilotStreamEvent =
  | { type: "user_message"; message_id: number }
  | { type: "token"; text: string }
  | { type: "tool_call"; tool: string; params: Record<string, unknown> }
  | { type: "tool_result"; tool: string; ok: boolean; status: number | null; truncated: boolean; duration_ms: number }
  | { type: "message_saved"; message_id: number; content: string; tool_trace: CopilotToolTraceEntry[] }
  | { type: "handle"; handle: string; entity_type: string; label: string | null }
  | { type: "error"; message: string }
  | { type: "done" };

function parseSseChunk(block: string): CopilotStreamEvent | null {
  let eventName: string | null = null;
  let dataLine: string | null = null;
  for (const line of block.split("\n")) {
    if (line.startsWith("event: ")) {
      eventName = line.slice("event: ".length).trim();
    } else if (line.startsWith("data: ")) {
      dataLine = line.slice("data: ".length);
    }
  }
  if (!eventName || dataLine === null) {
    return null;
  }
  try {
    return { type: eventName, ...(JSON.parse(dataLine) as object) } as CopilotStreamEvent;
  } catch {
    return null;
  }
}

/**
 * Streams one assistant turn. Uses `fetch` rather than the shared axios client because
 * axios buffers the body and enforces a 15s timeout, neither of which suits SSE.
 */
export async function streamCopilotMessage(
  sessionId: number,
  content: string,
  onEvent: (event: CopilotStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const token = getStaffAccessToken();
  if (!token) {
    throw new Error("尚未登入或登入已過期。");
  }
  const response = await fetch(`${resolveApiBaseUrl()}/v1/copilot/sessions/${sessionId}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ content }),
    signal,
  });

  if (!response.ok || !response.body) {
    let detail = `HTTP ${response.status}`;
    try {
      const payload = (await response.json()) as { detail?: string };
      if (typeof payload.detail === "string") {
        detail = payload.detail;
      }
    } catch {
      // Keep the status-code fallback.
    }
    throw new Error(detail);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    let separator = buffer.indexOf("\n\n");
    while (separator !== -1) {
      const block = buffer.slice(0, separator);
      buffer = buffer.slice(separator + 2);
      const event = parseSseChunk(block);
      if (event) {
        onEvent(event);
      }
      separator = buffer.indexOf("\n\n");
    }
  }
}
