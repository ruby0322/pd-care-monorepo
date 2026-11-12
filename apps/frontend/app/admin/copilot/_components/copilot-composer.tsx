"use client";

import { ArrowUp, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { shouldSendOnEnter } from "./composer-keys";

const MAX_COMPOSER_HEIGHT = 200;

type Props = {
  /** Called with the trimmed question. The composer clears only once this returns true. */
  onSend: (content: string) => boolean | Promise<boolean>;
  /** Shows the stop button instead of send, and refuses input while a turn is running. */
  isStreaming?: boolean;
  onStop?: () => void;
  /** False on a read-only session: the textarea explains itself instead of taking input. */
  canWrite?: boolean;
  placeholder?: string;
  readOnlyPlaceholder?: string;
  autoFocus?: boolean;
  /** Rendered under the input, where the create screen puts its model/visibility chips. */
  children?: React.ReactNode;
};

/**
 * The one composer. The thread's bottom bar and the new-chat screen render this same
 * component: between IME composition handling, auto-growing and the send/stop swap there is
 * too much behaviour here to keep two copies of, and the IME bug this guards against was
 * reported from the thread -- the create screen would have shipped with it still in place.
 */
export function CopilotComposer({
  onSend,
  isStreaming = false,
  onStop,
  canWrite = true,
  placeholder = "問 PD Copilot…",
  readOnlyPlaceholder = "唯讀對話，無法提問",
  autoFocus = false,
  children,
}: Props) {
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const isComposingRef = useRef(false);
  const compositionGenerationRef = useRef(0);

  function resize() {
    const node = textareaRef.current;
    if (!node) {
      return;
    }
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, MAX_COMPOSER_HEIGHT)}px`;
  }

  useEffect(() => {
    if (autoFocus) {
      textareaRef.current?.focus();
    }
  }, [autoFocus]);

  async function send() {
    const content = input;
    if (!content.trim() || isStreaming || !canWrite) {
      return;
    }
    // Cleared the moment the question is handed over, not when it is answered: `onSend`
    // resolves at the *end* of the turn, so waiting for it left the question sitting in the
    // box for the length of the whole answer, looking like a send that had not happened.
    setInput("");
    window.setTimeout(resize, 0);

    if (await onSend(content)) {
      return;
    }
    // Refused (no session, read-only, a turn already running): put it back, so a question
    // is never silently swallowed -- but not over something typed in the meantime.
    setInput((current) => (current === "" ? content : current));
    window.setTimeout(resize, 0);
  }

  return (
    <form
      className={`rounded-2xl border bg-white shadow-sm transition-colors ${
        canWrite ? "border-zinc-200 focus-within:border-zinc-400" : "border-zinc-100 bg-zinc-50"
      }`}
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <div className="flex items-end gap-2 p-2 pl-4">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(event) => {
            setInput(event.target.value);
            resize();
          }}
          onCompositionStart={() => {
            compositionGenerationRef.current += 1;
            isComposingRef.current = true;
          }}
          onCompositionEnd={() => {
            // Safari dispatches the candidate-picking Enter's keydown right after
            // compositionend, so the flag has to outlive this task to catch it. The
            // generation guard keeps that delay from clearing a *later* composition:
            // committing one word and starting the next within the same task would
            // otherwise leave this timer to unset the flag mid-compose, and Safari
            // has no native flag to fall back on.
            const generation = compositionGenerationRef.current;
            setTimeout(() => {
              if (compositionGenerationRef.current === generation) {
                isComposingRef.current = false;
              }
            }, 0);
          }}
          onKeyDown={(event) => {
            if (shouldSendOnEnter(event, isComposingRef.current)) {
              event.preventDefault();
              void send();
            }
          }}
          rows={1}
          maxLength={8000}
          disabled={!canWrite || isStreaming}
          placeholder={canWrite ? placeholder : readOnlyPlaceholder}
          className="max-h-[200px] min-h-[24px] flex-1 resize-none self-center bg-transparent py-1.5 text-[15px] leading-6 text-zinc-900 outline-none placeholder:text-zinc-400 disabled:cursor-not-allowed"
        />
        {isStreaming ? (
          <button
            type="button"
            onClick={onStop}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-zinc-900 text-white transition-colors hover:bg-zinc-700"
            aria-label="停止產生"
          >
            <Square className="h-3.5 w-3.5 fill-current" strokeWidth={1.5} />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!canWrite || !input.trim()}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-zinc-900 text-white transition-all hover:bg-zinc-700 disabled:bg-zinc-200 disabled:text-zinc-400"
            aria-label="送出"
          >
            <ArrowUp className="h-4 w-4" strokeWidth={2} />
          </button>
        )}
      </div>
      {children ? <div className="flex flex-wrap items-center gap-2 px-3 pb-2.5">{children}</div> : null}
    </form>
  );
}
