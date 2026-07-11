"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

type SheetSide = "right" | "bottom";

type SheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  side?: SheetSide;
  children: React.ReactNode;
  className?: string;
  "aria-label"?: string;
};

export function Sheet({
  open,
  onOpenChange,
  side = "right",
  children,
  className,
  "aria-label": ariaLabel = "詳細內容",
}: SheetProps) {
  React.useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onOpenChange(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  if (!open) {
    return null;
  }

  const panelSideClass =
    side === "bottom"
      ? "inset-x-0 bottom-0 max-h-[90vh] w-full rounded-t-2xl sm:inset-y-0 sm:right-0 sm:left-auto sm:max-h-none sm:w-full sm:max-w-md sm:rounded-none sm:rounded-l-2xl"
      : "inset-y-0 right-0 h-full w-full max-w-md rounded-l-2xl";

  return (
    <div className="fixed inset-0 z-50 flex" role="presentation">
      <button
        type="button"
        aria-label="關閉"
        className="absolute inset-0 bg-zinc-900/50"
        onClick={() => onOpenChange(false)}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        className={cn(
          "absolute z-10 flex flex-col overflow-hidden bg-white shadow-xl",
          panelSideClass,
          className
        )}
      >
        {children}
      </div>
    </div>
  );
}

export function SheetHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("border-b border-zinc-200 bg-zinc-50 px-4 py-3", className)} {...props} />;
}

export function SheetBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex-1 overflow-auto px-4 py-3", className)} {...props} />;
}

export function SheetTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("text-base font-semibold text-zinc-900", className)} {...props} />;
}
