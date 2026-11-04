"use client";

import { Sparkles, User } from "lucide-react";
import { useState } from "react";

import type { CopilotToolTraceEntry } from "@/lib/api/copilot";

import { parseAssistantContent } from "./artifact-bridge";
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

export function CopilotMessage({ message }: { message: CopilotMessageViewModel }) {
  // Live data is opt-in per artifact and resets when the message re-renders from scratch.
  const [liveArtifacts, setLiveArtifacts] = useState<Record<number, boolean>>({});

  if (message.role === "user") {
    return (
      <div className="flex justify-end gap-2.5">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-zinc-900 px-3.5 py-2.5 text-sm whitespace-pre-wrap text-white">
          {message.content}
        </div>
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-zinc-100">
          <User className="h-3.5 w-3.5 text-zinc-500" strokeWidth={1.5} />
        </div>
      </div>
    );
  }

  const { segments } = parseAssistantContent(message.content);

  return (
    <div className="flex gap-2.5">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-zinc-900">
        <Sparkles className="h-3.5 w-3.5 text-white" strokeWidth={1.5} />
      </div>
      <div className="min-w-0 flex-1">
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
            />
          ),
        )}
        {message.isStreaming && !message.content ? (
          <p className="text-sm text-zinc-400">正在思考…</p>
        ) : null}
      </div>
    </div>
  );
}
