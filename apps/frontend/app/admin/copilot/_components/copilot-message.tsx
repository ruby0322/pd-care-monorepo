"use client";

import { Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { getReadableApiError } from "@/lib/api/client";
import { createCopilotModule, type CopilotHandleLabel, type CopilotToolTraceEntry, type CopilotVisibility } from "@/lib/api/copilot";

import { callsLiveBridge, parseAssistantContent, usesLiveBridge, type ArtifactErrorMessage } from "./artifact-bridge";
import { CopilotHtmlArtifact } from "./copilot-html-artifact";
import { CopilotMarkdown } from "./copilot-markdown";
import { CopilotToolTrace } from "./copilot-tool-trace";
import { applyHandleLabels } from "./handle-labels";
import { SaveModuleDialog } from "./save-module-dialog";

export type CopilotMessageViewModel = {
  key: string;
  role: "user" | "assistant";
  content: string;
  toolTrace: CopilotToolTraceEntry[];
  pendingTool?: string | null;
  isStreaming?: boolean;
  /** The persisted message id, when this view model backs a saved (non-streaming) message. */
  messageId?: number;
};

export function CopilotMessage({
  message,
  handles,
  role = "staff",
  sessionId,
  onRequestRepair,
  onAutoRepair,
}: {
  message: CopilotMessageViewModel;
  /** Session-scoped handle -> label map, resolved per viewer. Defaults to empty. */
  handles?: Record<string, CopilotHandleLabel>;
  /** Gates the admin-only visibility option in the save-as-module dialog. */
  role?: "staff" | "admin";
  /** Recorded as the new module's provenance when the artifact came from this session. */
  sessionId?: number;
  onRequestRepair?: (errors: ArtifactErrorMessage[], html: string) => void;
  onAutoRepair?: (errors: ArtifactErrorMessage[]) => boolean;
}) {
  // Overrides only: the default comes from whether the report actually uses the bridge.
  const [liveOverrides, setLiveOverrides] = useState<Record<number, boolean>>({});
  const [saveHtml, setSaveHtml] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function handleSaveModule(payload: { title: string; description?: string; visibility: CopilotVisibility }) {
    if (saveHtml === null) {
      return;
    }
    setIsSaving(true);
    try {
      await createCopilotModule({
        title: payload.title,
        description: payload.description,
        html: saveHtml,
        visibility: payload.visibility,
        source_session_id: sessionId,
        source_message_id: message.messageId,
      });
      setSaveHtml(null);
    } catch (error) {
      toast.error(getReadableApiError(error));
    } finally {
      setIsSaving(false);
    }
  }

  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl bg-zinc-100 px-4 py-2.5 text-[15px] leading-6 whitespace-pre-wrap text-zinc-900">
          {message.content}
        </div>
      </div>
    );
  }

  const { segments } = parseAssistantContent(message.content);

  return (
    <div className="flex gap-3.5">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-900">
        <Sparkles className="h-3.5 w-3.5 text-white" strokeWidth={1.5} />
      </div>
      <div className="min-w-0 flex-1 pt-0.5">
        <CopilotToolTrace
          entries={message.toolTrace}
          pendingTool={message.pendingTool}
          isStreaming={message.isStreaming}
        />
        {segments.map((segment, index) =>
          segment.kind === "text" ? (
            <CopilotMarkdown key={index} content={applyHandleLabels(segment.value, handles ?? {})} />
          ) : (
            <CopilotHtmlArtifact
              key={index}
              html={segment.value}
              liveEnabled={liveOverrides[index] ?? usesLiveBridge(segment.value)}
              onToggleLive={(next) => setLiveOverrides((current) => ({ ...current, [index]: next }))}
              onRequestRepair={onRequestRepair}
              onAutoRepair={message.isStreaming ? undefined : onAutoRepair}
              onSaveAsModule={setSaveHtml}
              incomplete={segment.closed ? undefined : message.isStreaming ? "writing" : "truncated"}
            />
          ),
        )}
        {message.isStreaming && !message.content ? (
          <span
            role="status"
            aria-label="正在產生回覆"
            className="inline-block h-4 w-[3px] animate-pulse rounded-full bg-zinc-400 align-middle"
          />
        ) : null}
      </div>
      {saveHtml !== null ? (
        <SaveModuleDialog
          role={role}
          canShare={callsLiveBridge(saveHtml)}
          isSubmitting={isSaving}
          onClose={() => setSaveHtml(null)}
          onSave={(payload) => void handleSaveModule(payload)}
        />
      ) : null}
    </div>
  );
}
