"use client";

import { Blocks, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { fetchCopilotModule, type CopilotModuleSummary } from "@/lib/api/copilot";

import { VISIBILITY_META } from "@/app/admin/copilot/_components/visibility-meta";

import { ModulePreview } from "./module-preview";

/** Taipei-local day, which is how every other date in the admin UI is written. */
function shortDate(value: string): string {
  const when = new Date(value);
  if (Number.isNaN(when.getTime())) {
    return "";
  }
  return `${when.getMonth() + 1}/${when.getDate()}`;
}

/**
 * One module in the selection grid: what it renders, what it is called, who may see it.
 *
 * The preview needs the module's HTML, which the list endpoint does not carry, so the card
 * fetches its own detail -- but only once it has been scrolled into view. Thirty saved
 * modules would otherwise mean thirty fetches and thirty iframes parsing and executing on
 * page load, for cards nobody has looked at yet.
 */
export function ModuleCard({
  module,
  onDelete,
}: {
  module: CopilotModuleSummary;
  onDelete?: (moduleId: number) => void;
}) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  // Without IntersectionObserver (jsdom, older browsers) every card mounts eagerly rather
  // than never. Decided at mount so the fallback needs no state write from an effect.
  const [isVisible, setIsVisible] = useState(() => typeof IntersectionObserver === "undefined");
  const { label, Icon, badgeClass } = VISIBILITY_META[module.visibility];

  useEffect(() => {
    const node = cardRef.current;
    if (node === null || isVisible || typeof IntersectionObserver === "undefined") {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [isVisible]);

  useEffect(() => {
    if (!isVisible || html !== null) {
      return;
    }
    let cancelled = false;
    void fetchCopilotModule(module.module_id)
      .then((detail) => {
        if (!cancelled) {
          setHtml(detail.html);
        }
      })
      // A preview that cannot load is a blank panel, not an error worth a toast: the card
      // still names the module and still opens it.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [isVisible, html, module.module_id]);

  return (
    <div
      ref={cardRef}
      className="group relative overflow-hidden rounded-xl border border-zinc-200 bg-white transition-all hover:-translate-y-px hover:border-zinc-300 hover:shadow-md"
    >
      {html === null ? (
        <div className="flex h-[104px] items-center justify-center border-b border-zinc-100 bg-zinc-50/60">
          <Blocks className="h-5 w-5 text-zinc-300" strokeWidth={1.5} />
        </div>
      ) : (
        <ModulePreview html={html} />
      )}

      <div className="px-3 pt-2.5 pb-3">
        <p className="truncate text-sm font-medium text-zinc-900">{module.title}</p>
        <p className="mt-0.5 mb-2 line-clamp-2 min-h-[2.5em] text-xs leading-5 text-zinc-500">
          {module.description ?? "沒有描述"}
        </p>
        <div className="flex items-center gap-1.5 text-[11px] text-zinc-400">
          <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium ${badgeClass}`}>
            <Icon className="h-3 w-3" strokeWidth={1.5} />
            {label}
          </span>
          {module.is_owner ? null : <span className="truncate">{module.owner_name ?? "他人"}</span>}
          <span className="shrink-0">{shortDate(module.updated_at)}</span>
          {module.is_owner && onDelete ? (
            <button
              type="button"
              onClick={() => onDelete(module.module_id)}
              className="relative z-10 ml-auto inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-zinc-400 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:bg-zinc-100 hover:text-zinc-700"
              aria-label={`刪除模組「${module.title}」`}
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
            </button>
          ) : null}
        </div>
      </div>

      {/* Last, and covering the card: the whole tile is the link, but the delete button
          above it must stay clickable, so the overlay sits under it in the stack. */}
      <Link
        href={`/admin/modules/${module.module_id}`}
        className="absolute inset-0 z-0 rounded-xl focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:outline-none"
      >
        <span className="sr-only">開啟模組「{module.title}」</span>
      </Link>
    </div>
  );
}
