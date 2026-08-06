"use client";

import { useEffect, useState } from "react";

import { fetchUploadImageAccess } from "@/lib/api/staff";

export function useUploadImageUrls(uploadIds: number[]) {
  const [imageUrlByUploadId, setImageUrlByUploadId] = useState<Record<number, string>>({});
  const [imageErrorByUploadId, setImageErrorByUploadId] = useState<Record<number, boolean>>({});

  useEffect(() => {
    if (uploadIds.length === 0) {
      return;
    }
    const missing = uploadIds.filter((uploadId) => !imageUrlByUploadId[uploadId]);
    if (missing.length === 0) {
      return;
    }
    let cancelled = false;
    void Promise.allSettled(missing.map((uploadId) => fetchUploadImageAccess(uploadId))).then((results) => {
      if (cancelled) {
        return;
      }
      setImageUrlByUploadId((current) => {
        const next = { ...current };
        results.forEach((result, index) => {
          if (result.status === "fulfilled") {
            next[missing[index]] = result.value.image_url;
          }
        });
        return next;
      });
      setImageErrorByUploadId((current) => {
        const next = { ...current };
        results.forEach((result, index) => {
          next[missing[index]] = result.status === "rejected";
        });
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [imageUrlByUploadId, uploadIds]);

  return { imageUrlByUploadId, imageErrorByUploadId };
}
