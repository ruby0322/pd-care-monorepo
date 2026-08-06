"use client";

import Image from "next/image";
import Link from "next/link";
import { X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { getReadableApiError } from "@/lib/api/client";
import {
  fetchHistoryOverview,
  type StaffHistoryOverviewUploadItem,
  type StaffHistoryOverviewUserGroupItem,
  upsertUploadAnnotation,
} from "@/lib/api/staff";

import { HistoryUploadAnnotationModal } from "./history-upload-annotation-modal";
import {
  suggestedHistoryUploadLabel,
  type HistoryUploadDraftVerdict,
} from "./history-upload-review-helpers";
import { HistoryUploadThumbnailGrid } from "./history-upload-thumbnail-grid";
import { useUploadImageUrls } from "./use-upload-image-urls";

const INITIAL_VISIBLE = 7;
const LOAD_STEP = 8;

type PatientDayUploadReviewModalProps = {
  open: boolean;
  onClose: () => void;
  patientId: number;
  localDate: string;
  fallbackName?: string;
  fallbackCaseNumber?: string;
  fallbackPictureUrl?: string | null;
  onReviewSaved?: () => void;
};

export function PatientDayUploadReviewModal({
  open,
  onClose,
  patientId,
  localDate,
  fallbackName,
  fallbackCaseNumber,
  fallbackPictureUrl,
  onReviewSaved,
}: PatientDayUploadReviewModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [group, setGroup] = useState<StaffHistoryOverviewUserGroupItem | null>(null);
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE);
  const [selectedUploadId, setSelectedUploadId] = useState<number | null>(null);
  const [draft, setDraft] = useState<HistoryUploadDraftVerdict>({ label: "suspected", comment: "" });
  const [saving, setSaving] = useState(false);

  const loadGroup = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetchHistoryOverview({
        localDate,
        sortBy: "timeline",
        groupByUser: true,
        groupSortBy: "infection_risk",
      });
      const nextGroup = response.groups.find((item) => item.patient_id === patientId) ?? null;
      setGroup(nextGroup);
      setError(nextGroup ? null : "找不到當日上傳紀錄");
    } catch (loadError) {
      setGroup(null);
      setError(getReadableApiError(loadError));
    } finally {
      setLoading(false);
    }
  }, [localDate, patientId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadGroup();
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [loadGroup]);

  const visibleUploads = useMemo(() => {
    if (!group) {
      return [] as StaffHistoryOverviewUploadItem[];
    }
    return group.uploads.slice(0, visibleCount);
  }, [group, visibleCount]);

  const selectedUpload = useMemo(
    () =>
      selectedUploadId != null
        ? group?.uploads.find((item) => item.upload_id === selectedUploadId) ?? null
        : null,
    [group?.uploads, selectedUploadId]
  );

  const uploadIdsForImages = useMemo(() => {
    const ids = visibleUploads.map((item) => item.upload_id);
    if (selectedUpload && !ids.includes(selectedUpload.upload_id)) {
      ids.push(selectedUpload.upload_id);
    }
    return ids;
  }, [selectedUpload, visibleUploads]);

  const { imageUrlByUploadId, imageErrorByUploadId } = useUploadImageUrls(uploadIdsForImages);

  useEffect(() => {
    if (!selectedUpload) {
      return;
    }
    const timer = window.setTimeout(() => {
      setDraft({
        label: suggestedHistoryUploadLabel(selectedUpload),
        comment: selectedUpload.annotation_comment ?? "",
      });
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [selectedUpload]);

  async function onSaveSelected() {
    if (!selectedUpload) {
      return;
    }
    setSaving(true);
    try {
      await upsertUploadAnnotation(selectedUpload.upload_id, {
        label: draft.label,
        comment: draft.comment,
      });
      toast.success("已儲存標註");
      setSelectedUploadId(null);
      await loadGroup();
      onReviewSaved?.();
    } catch {
      toast.error("儲存失敗，請稍後重試");
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return null;
  }

  const displayName = group?.real_name ?? group?.patient_full_name ?? fallbackName ?? "未命名";
  const caseNumber = group?.case_number ?? fallbackCaseNumber ?? "—";
  const pictureUrl = group?.picture_url ?? fallbackPictureUrl ?? null;
  const hasMore = group ? visibleCount < group.uploads.length : false;

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-zinc-900/60 p-0 sm:items-center sm:p-4">
        <div className="flex max-h-[90vh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:max-w-4xl sm:rounded-2xl">
          <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <Link
                href={`/admin/patients/${patientId}`}
                className="relative block h-10 w-10 shrink-0 overflow-hidden rounded-full bg-zinc-100 ring-1 ring-zinc-200 transition hover:ring-zinc-400"
                aria-label={`查看 ${displayName} 詳情`}
              >
                {pictureUrl ? (
                  <Image src={pictureUrl} alt={`avatar-${patientId}`} fill unoptimized className="object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-zinc-400">N/A</div>
                )}
              </Link>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-zinc-900">{displayName}</p>
                <p className="truncate text-xs text-zinc-500">
                  {caseNumber}
                  {group ? ` · 當日上傳 ${group.upload_count} 張` : null}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
              aria-label="關閉"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="overflow-y-auto p-4">
            {loading ? <p className="py-8 text-center text-sm text-zinc-400">載入上傳紀錄中…</p> : null}
            {!loading && error ? <p className="py-8 text-center text-sm text-red-600">{error}</p> : null}
            {!loading && !error && group ? (
              <HistoryUploadThumbnailGrid
                uploads={visibleUploads}
                imageUrlByUploadId={imageUrlByUploadId}
                imageErrorByUploadId={imageErrorByUploadId}
                onSelectUpload={setSelectedUploadId}
                hasMore={hasMore}
                onLoadMore={() => setVisibleCount((current) => current + LOAD_STEP)}
              />
            ) : null}
          </div>
        </div>
      </div>

      {selectedUpload ? (
        <HistoryUploadAnnotationModal
          upload={selectedUpload}
          imageUrl={imageUrlByUploadId[selectedUpload.upload_id] ?? null}
          draft={draft}
          saving={saving}
          onDraftChange={setDraft}
          onSave={() => void onSaveSelected()}
          onClose={() => setSelectedUploadId(null)}
        />
      ) : null}
    </>
  );
}
