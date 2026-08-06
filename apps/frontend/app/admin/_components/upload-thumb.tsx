"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

import { fetchUploadImageAccess } from "@/lib/api/staff";
import { cn } from "@/lib/utils";

type UploadThumbProps = {
  uploadId: number;
  className?: string;
  imageClassName?: string;
  /** When provided (including null), parent owns loading — skip self-fetch. */
  imageUrl?: string | null;
  imageError?: boolean;
};

export function UploadThumb({
  uploadId,
  className,
  imageClassName,
  imageUrl: controlledUrl,
  imageError: controlledError,
}: UploadThumbProps) {
  const isControlled = controlledUrl !== undefined || controlledError !== undefined;
  const [fetchedUrl, setFetchedUrl] = useState<string | null>(null);
  const [fetchedError, setFetchedError] = useState(false);

  useEffect(() => {
    if (isControlled) {
      return;
    }
    let cancelled = false;
    void fetchUploadImageAccess(uploadId)
      .then((result) => {
        if (!cancelled) {
          setFetchedUrl(result.image_url);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFetchedError(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isControlled, uploadId]);

  const imageUrl = isControlled ? (controlledUrl ?? null) : fetchedUrl;
  const imageError = isControlled ? Boolean(controlledError) : fetchedError;

  return (
    <div className={cn("relative h-full w-full overflow-hidden rounded-md bg-zinc-100 ring-1 ring-zinc-200", className)}>
      {imageUrl ? (
        <Image src={imageUrl} alt="" fill unoptimized className={cn("object-cover", imageClassName)} />
      ) : (
        <div className="flex h-full items-center justify-center text-[10px] text-zinc-400">
          {imageError ? "失敗" : "…"}
        </div>
      )}
    </div>
  );
}
