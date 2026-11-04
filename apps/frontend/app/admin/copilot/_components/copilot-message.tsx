"use client";

import { Sparkles } from "lucide-react";
import { useState } from "react";

import type { CopilotToolTraceEntry } from "@/lib/api/copilot";

import { parseAssistantContent, type ArtifactErrorMessage } from "./artifact-bridge";
import { CopilotHtmlArtifact } from "./copilot-html-artifact";
import { CopilotMarkdown } from "./copilot-markdown";
import { CopilotToolTrace } from "./copilot-tool-trace";

export type CopilotMessageViewModel = {
  key: string;
  role: "user" | "assistant";
  content: string;
  toolTrace: CopilotToolTraceEntry[];
  pendingTool?: string | null;
  isStreaming?: boolean;
};

export function CopilotMessage({
  message,
  onRequestRepair,
}: {
  message: CopilotMessageViewModel;
  onRequestRepair?: (errors: ArtifactErrorMessage[]) => void;
}) {
  // Live data is opt-in per artifact and resets when the message re-renders from scratch.
  const [liveArtifacts, setLiveArtifacts] = useState<Record<number, boolean>>({});

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
        <CopilotToolTrace entries={message.toolTrace} pendingTool={message.pendingTool} />
        {segments.map((segment, index) =>
          segment.kind === "text" ? (
            <CopilotMarkdown key={index} content={segment.value} />
          ) : (
            <CopilotHtmlArtifact
              key={index}
              html={segment.value}
              liveEnabled={liveArtifacts[index] ?? false}
              onToggleLive={(next) => setLiveArtifacts((current) => ({ ...current, [index]: next }))}
              onRequestRepair={onRequestRepair}
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
    </div>
  );
}
