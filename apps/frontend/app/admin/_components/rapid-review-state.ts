"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  fetchPatientAnnotations,
  fetchStaffPatientDetail,
  fetchUploadImageAccess,
  fetchUploadQueue,
  sortUploadsByRisk,
  StaffAnnotationItem,
  StaffPatientDetailResponse,
  StaffRapidReviewQueueItem,
  upsertUploadAnnotation,
} from "@/lib/api/staff";
import { getReadableApiError } from "@/lib/api/client";

type AnnotationLabel = StaffAnnotationItem["label"];
const RAPID_REVIEW_QUEUE_LIMIT = 200;

type ReviewState = {
  loading: boolean;
  saving: boolean;
  error: string | null;
  queue: StaffRapidReviewQueueItem[];
  currentIndex: number;
  currentItem: StaffRapidReviewQueueItem | null;
  currentPatient: StaffPatientDetailResponse | null;
  currentUploadImageUrl: string | null;
  currentUploadAnnotation: StaffAnnotationItem | null;
  remainingCount: number;
  canMovePrev: boolean;
  canMoveNext: boolean;
  reloadQueue: () => Promise<void>;
  movePrev: () => void;
  moveNext: () => void;
  saveCurrentVerdict: (label: AnnotationLabel, comment: string) => Promise<void>;
};

function flattenByPatientGroup(items: StaffRapidReviewQueueItem[]): StaffRapidReviewQueueItem[] {
  const patientOrder: number[] = [];
  const patientMap = new Map<number, StaffRapidReviewQueueItem[]>();

  for (const item of items) {
    if (!patientMap.has(item.patient_id)) {
      patientOrder.push(item.patient_id);
      patientMap.set(item.patient_id, []);
    }
    patientMap.get(item.patient_id)?.push(item);
  }

  return patientOrder.flatMap((patientId) => patientMap.get(patientId) ?? []);
}

export function useRapidReviewState(): ReviewState {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queue, setQueue] = useState<StaffRapidReviewQueueItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [patientById, setPatientById] = useState<Record<number, StaffPatientDetailResponse>>({});
  const [annotationByUploadId, setAnnotationByUploadId] = useState<Record<number, StaffAnnotationItem>>({});
  const [imageUrlByUploadId, setImageUrlByUploadId] = useState<Record<number, string>>({});

  const reloadQueue = useCallback(async () => {
    setLoading(true);
    try {
      const queueResponse = await fetchUploadQueue({ limit: RAPID_REVIEW_QUEUE_LIMIT, suspectedOnly: false });
      const sorted = sortUploadsByRisk(queueResponse.items);
      const unreviewed = sorted.filter((item) => !item.has_annotation);
      const grouped = flattenByPatientGroup(unreviewed);
      setQueue(grouped);
      setCurrentIndex(0);
      setError(null);
    } catch (queueError) {
      setError(getReadableApiError(queueError));
    } finally {
      setLoading(false);
    }
  }, []);

  const currentItem = queue[currentIndex] ?? null;

  useEffect(() => {
    let cancelled = false;
    const loadInitial = async () => {
      try {
        const queueResponse = await fetchUploadQueue({ limit: RAPID_REVIEW_QUEUE_LIMIT, suspectedOnly: false });
        if (cancelled) {
          return;
        }
        const sorted = sortUploadsByRisk(queueResponse.items);
        const unreviewed = sorted.filter((item) => !item.has_annotation);
        setQueue(flattenByPatientGroup(unreviewed));
        setCurrentIndex(0);
        setError(null);
      } catch (queueError) {
        if (!cancelled) {
          setError(getReadableApiError(queueError));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadInitial();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!currentItem) {
      return;
    }
    let cancelled = false;

    const loadPatientContext = async () => {
      try {
        if (!patientById[currentItem.patient_id]) {
          const [detail, annotations] = await Promise.all([
            fetchStaffPatientDetail(currentItem.patient_id),
            fetchPatientAnnotations(currentItem.patient_id),
          ]);
          if (cancelled) {
            return;
          }
          setPatientById((current) => ({ ...current, [currentItem.patient_id]: detail }));
          setAnnotationByUploadId((current) => {
            const next = { ...current };
            for (const item of annotations) {
              next[item.upload_id] = item;
            }
            return next;
          });
        }
        if (!imageUrlByUploadId[currentItem.upload_id]) {
          const access = await fetchUploadImageAccess(currentItem.upload_id);
          if (!cancelled) {
            setImageUrlByUploadId((current) => ({ ...current, [currentItem.upload_id]: access.image_url }));
          }
        }
      } catch (contextError) {
        if (!cancelled) {
          setError(getReadableApiError(contextError));
        }
      }
    };

    void loadPatientContext();
    return () => {
      cancelled = true;
    };
  }, [currentItem, imageUrlByUploadId, patientById]);

  const movePrev = useCallback(() => {
    setCurrentIndex((index) => Math.max(0, index - 1));
  }, []);

  const moveNext = useCallback(() => {
    setCurrentIndex((index) => Math.min(queue.length - 1, index + 1));
  }, [queue.length]);

  const saveCurrentVerdict = useCallback(
    async (label: AnnotationLabel, comment: string) => {
      if (!currentItem) {
        return;
      }
      setSaving(true);
      try {
        const saved = await upsertUploadAnnotation(currentItem.upload_id, { label, comment });
        setAnnotationByUploadId((current) => ({ ...current, [saved.upload_id]: saved }));
        setQueue((current) => current.filter((item) => item.upload_id !== currentItem.upload_id));
        setCurrentIndex((index) => {
          const nextMaxIndex = Math.max(0, queue.length - 2);
          return Math.min(index, nextMaxIndex);
        });
        setError(null);
      } catch (saveError) {
        setError(getReadableApiError(saveError));
      } finally {
        setSaving(false);
      }
    },
    [currentItem, queue.length]
  );

  const currentPatient = currentItem ? patientById[currentItem.patient_id] ?? null : null;
  const currentUploadImageUrl = currentItem ? imageUrlByUploadId[currentItem.upload_id] ?? null : null;
  const currentUploadAnnotation = currentItem ? annotationByUploadId[currentItem.upload_id] ?? null : null;

  return useMemo(
    () => ({
      loading,
      saving,
      error,
      queue,
      currentIndex,
      currentItem,
      currentPatient,
      currentUploadImageUrl,
      currentUploadAnnotation,
      remainingCount: queue.length,
      canMovePrev: currentIndex > 0,
      canMoveNext: currentIndex < queue.length - 1,
      reloadQueue,
      movePrev,
      moveNext,
      saveCurrentVerdict,
    }),
    [
      currentIndex,
      currentItem,
      currentPatient,
      currentUploadAnnotation,
      currentUploadImageUrl,
      error,
      loading,
      moveNext,
      movePrev,
      queue,
      reloadQueue,
      saveCurrentVerdict,
      saving,
    ]
  );
}
