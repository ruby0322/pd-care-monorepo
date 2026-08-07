"use client";

import { useEffect, useMemo, useState } from "react";

import { fetchUploadImageAccessBatch } from "@/lib/api/staff";

const BATCH_SIZE = 50;

export function useUploadImageUrls(uploadIds: number[]) {
  const [imageUrlByUploadId, setImageUrlByUploadId] = useState<Record<number, string>>({});
  const [imageErrorByUploadId, setImageErrorByUploadId] = useState<Record<number, boolean>>({});

  const stableIds = useMemo(() => {
    const seen = new Set<number>();
    const ids: number[] = [];
    for (const uploadId of uploadIds) {
      if (seen.has(uploadId)) {
        continue;
      }
      seen.add(uploadId);
      ids.push(uploadId);
    }
    return ids;
  }, [uploadIds]);

  const missingKey = useMemo(() => {
    return stableIds.filter((uploadId) => !imageUrlByUploadId[uploadId] && !imageErrorByUploadId[uploadId]).join(",");
  }, [imageErrorByUploadId, imageUrlByUploadId, stableIds]);

  useEffect(() => {
    const missing = missingKey
      ? missingKey.split(",").map((value) => Number(value)).filter((value) => Number.isFinite(value))
      : [];
    if (missing.length === 0) {
      return;
    }
    let cancelled = false;
    const chunks: number[][] = [];
    for (let index = 0; index < missing.length; index += BATCH_SIZE) {
      chunks.push(missing.slice(index, index + BATCH_SIZE));
    }
    void Promise.all(chunks.map((chunk) => fetchUploadImageAccessBatch(chunk)))
      .then((responses) => {
        if (cancelled) {
          return;
        }
        setImageUrlByUploadId((current) => {
          const next = { ...current };
          for (const response of responses) {
            for (const item of response.items) {
              if (item.image_url) {
                next[item.upload_id] = item.image_url;
              }
            }
          }
          return next;
        });
        setImageErrorByUploadId((current) => {
          const next = { ...current };
          for (const response of responses) {
            for (const item of response.items) {
              if (item.error || !item.image_url) {
                next[item.upload_id] = true;
              }
            }
          }
          return next;
        });
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setImageErrorByUploadId((current) => {
          const next = { ...current };
          for (const uploadId of missing) {
            next[uploadId] = true;
          }
          return next;
        });
      });
    return () => {
      cancelled = true;
    };
  }, [missingKey]);

  return { imageUrlByUploadId, imageErrorByUploadId };
}
