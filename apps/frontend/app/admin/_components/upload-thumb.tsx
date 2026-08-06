"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

import { fetchUploadImageAccess } from "@/lib/api/staff";
import { cn } from "@/lib/utils";

type UploadThumbProps = {
  uploadId: number;
  className?: string;
  imageClassName?: string;
};

export function UploadThumb({ uploadId, className, imageClassName }: UploadThumbProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchUploadImageAccess(uploadId)
      .then((result) => {
        if (!cancelled) {
          setImageUrl(result.image_url);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setImageError(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [uploadId]);

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
