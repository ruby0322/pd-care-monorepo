"use client";

import { cn } from "@/lib/utils";

type PersonAvatarProps = {
  name: string | null | undefined;
  pictureUrl?: string | null;
  size?: "sm" | "md" | "lg";
  className?: string;
};

const sizeClass = {
  sm: "h-5 w-5 text-[10px]",
  md: "h-7 w-7 text-xs",
  lg: "h-10 w-10 text-sm",
} as const;

function initials(name: string | null | undefined): string {
  const trimmed = (name ?? "").trim();
  if (!trimmed) {
    return "?";
  }
  return trimmed.slice(0, 1).toUpperCase();
}

export function PersonAvatar({ name, pictureUrl, size = "md", className }: PersonAvatarProps) {
  if (pictureUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- LINE CDN URLs vary; avoid next/image remote config
      <img
        src={pictureUrl}
        alt=""
        className={cn("inline-block shrink-0 rounded-full bg-zinc-200 object-cover", sizeClass[size], className)}
      />
    );
  }
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-zinc-300 font-semibold text-zinc-700",
        sizeClass[size],
        className
      )}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}
