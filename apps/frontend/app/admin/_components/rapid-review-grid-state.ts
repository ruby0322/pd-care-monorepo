"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { getReadableApiError } from "@/lib/api/client";
import {
  fetchUploadImageAccess,
  fetchUploadQueue,
  sortUploadsByRisk,
  StaffAnnotationItem,
  StaffRapidReviewQueueItem,
  upsertUploadAnnotation,
} from "@/lib/api/staff";

const GRID_SIZE = 16;
const RAPID_REVIEW_QUEUE_LIMIT = 200;

type AnnotationLabel = StaffAnnotationItem["label"];

type RapidReviewGridState = {
  loading: boolean;
  saving: boolean;
  bulkSaving: boolean;
  error: string | null;
  queue: StaffRapidReviewQueueItem[];
  visibleItems: StaffRapidReviewQueueItem[];
  imageUrlByUploadId: Record<number, string>;
  imageLoadErrorByUploadId: Record<number, boolean>;
  selectedUploadId: number | null;
  selectedItem: StaffRapidReviewQueueItem | null;
  remainingCount: number;
  reloadQueue: () => Promise<void>;
  selectUpload: (uploadId: number | null) => void;
  annotateUpload: (uploadId: number, label: AnnotationLabel, comment: string) => Promise<void>;
  acceptAllVisible: () => Promise<void>;
};

function mapPredictionToLabel(item: StaffRapidReviewQueueItem): AnnotationLabel {
  if (item.screening_result === "normal") {
    return "normal";
  }
  if (item.screening_result === "suspected") {
    return "suspected";
  }
  return "rejected";
}

export function useRapidReviewGridState(): RapidReviewGridState {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queue, setQueue] = useState<StaffRapidReviewQueueItem[]>([]);
  const [imageUrlByUploadId, setImageUrlByUploadId] = useState<Record<number, string>>({});
  const [imageLoadErrorByUploadId, setImageLoadErrorByUploadId] = useState<Record<number, boolean>>({});
  const [selectedUploadId, setSelectedUploadId] = useState<number | null>(null);

  const reloadQueue = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetchUploadQueue({ limit: RAPID_REVIEW_QUEUE_LIMIT, suspectedOnly: false });
      const sorted = sortUploadsByRisk(response.items);
      const unreviewed = sorted.filter((item) => !item.has_annotation);
      setQueue(unreviewed);
      const queueUploadIdSet = new Set(unreviewed.map((item) => item.upload_id));
      setImageUrlByUploadId((current) =>
        Object.fromEntries(Object.entries(current).filter(([uploadId]) => queueUploadIdSet.has(Number(uploadId))))
      );
      setImageLoadErrorByUploadId((current) =>
        Object.fromEntries(Object.entries(current).filter(([uploadId]) => queueUploadIdSet.has(Number(uploadId))))
      );
      setSelectedUploadId((current) => (current && unreviewed.some((item) => item.upload_id === current) ? current : null));
      setError(null);
    } catch (queueError) {
      setError(getReadableApiError(queueError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void reloadQueue();
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [reloadQueue]);

  const visibleItems = useMemo(() => queue.slice(0, GRID_SIZE), [queue]);

  useEffect(() => {
    if (visibleItems.length === 0) {
      return;
    }
    const missing = visibleItems.filter((item) => !imageUrlByUploadId[item.upload_id]);
    if (missing.length === 0) {
      return;
    }
    let cancelled = false;
    const loadImages = async () => {
      const accessList = await Promise.allSettled(missing.map((item) => fetchUploadImageAccess(item.upload_id)));
      if (cancelled) {
        return;
      }
      setImageUrlByUploadId((current) => {
        const next = { ...current };
        accessList.forEach((result, index) => {
          if (result.status === "fulfilled") {
            next[missing[index].upload_id] = result.value.image_url;
          }
        });
        return next;
      });
      setImageLoadErrorByUploadId((current) => {
        const next = { ...current };
        accessList.forEach((result, index) => {
          next[missing[index].upload_id] = result.status === "rejected";
        });
        return next;
      });
    };
    void loadImages();
    return () => {
      cancelled = true;
    };
  }, [imageUrlByUploadId, visibleItems]);

  const annotateUpload = useCallback(async (uploadId: number, label: AnnotationLabel, comment: string) => {
    setSaving(true);
    try {
      await upsertUploadAnnotation(uploadId, { label, comment });
      setQueue((current) => current.filter((item) => item.upload_id !== uploadId));
      setSelectedUploadId((current) => (current === uploadId ? null : current));
      setError(null);
    } catch (saveError) {
      setError(getReadableApiError(saveError));
      throw saveError;
    } finally {
      setSaving(false);
    }
  }, []);

  const acceptAllVisible = useCallback(async () => {
    if (visibleItems.length === 0) {
      return;
    }
    setBulkSaving(true);
    try {
      const results = await Promise.allSettled(
        visibleItems.map((item) =>
          upsertUploadAnnotation(item.upload_id, {
            label: mapPredictionToLabel(item),
            comment: "",
          })
        )
      );
      const succeededIds = results
        .map((result, index) => (result.status === "fulfilled" ? visibleItems[index].upload_id : null))
        .filter((uploadId): uploadId is number => uploadId !== null);
      const failedCount = results.length - succeededIds.length;

      if (succeededIds.length > 0) {
        const succeededSet = new Set<number>(succeededIds);
        setQueue((current) => current.filter((item) => !succeededSet.has(item.upload_id)));
        setSelectedUploadId((current) => (current && succeededSet.has(current) ? null : current));
      }
      if (failedCount > 0) {
        setError(`全部接受完成，但有 ${failedCount} 張寫入失敗，請重試。`);
      } else {
        setError(null);
      }
    } catch (bulkError) {
      setError(getReadableApiError(bulkError));
    } finally {
      setBulkSaving(false);
    }
  }, [visibleItems]);

  const selectedItem = useMemo(
    () => (selectedUploadId ? visibleItems.find((item) => item.upload_id === selectedUploadId) ?? null : null),
    [selectedUploadId, visibleItems]
  );

  return {
    loading,
    saving,
    bulkSaving,
    error,
    queue,
    visibleItems,
    imageUrlByUploadId,
    imageLoadErrorByUploadId,
    selectedUploadId,
    selectedItem,
    remainingCount: queue.length,
    reloadQueue,
    selectUpload: setSelectedUploadId,
    annotateUpload,
    acceptAllVisible,
  };
}
