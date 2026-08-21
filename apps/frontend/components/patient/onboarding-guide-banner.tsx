import { X } from "lucide-react";
import Link from "next/link";

type OnboardingGuideBannerProps = {
  href: string;
  message: string;
  ctaLabel?: string;
  dismissible?: boolean;
  onDismiss?: () => void;
};

export function OnboardingGuideBanner({
  href,
  message,
  ctaLabel,
  dismissible = false,
  onDismiss,
}: OnboardingGuideBannerProps) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3">
      <Link href={href} className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-relaxed text-zinc-800">{message}</p>
        {ctaLabel ? <p className="mt-1 text-xs font-medium text-zinc-600 underline underline-offset-4">{ctaLabel}</p> : null}
      </Link>
      {dismissible ? (
        <button
          type="button"
          onClick={onDismiss}
          className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700"
          aria-label="關閉教學提示"
        >
          <X className="h-4 w-4" strokeWidth={1.8} />
        </button>
      ) : null}
    </div>
  );
}
