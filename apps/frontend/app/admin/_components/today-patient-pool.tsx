"use client";

import { useMemo } from "react";

import type { StaffTodayAttentionPatientItem } from "@/lib/api/staff";

import { TodayPatientDetailPanel } from "./today-patient-detail-panel";
import { TodayPatientRow } from "./today-patient-row";
import { useUploadImageUrls } from "./use-upload-image-urls";

type TodayPatientPoolProps = {
  loading: boolean;
  error: string | null;
  suspectedPatients: number;
  elevatedPatients: number;
  otherPatients: number;
  items: StaffTodayAttentionPatientItem[];
  dayScopeLabel: string;
  isTodaySelected: boolean;
  selectedDate: string;
  selectedPatientId: number | null;
  onSelectPatient: (patientId: number) => void;
  onReviewSaved?: () => void;
};

function collectItemUploadIds(item: StaffTodayAttentionPatientItem): number[] {
  const ids: number[] = [];
  const seen = new Set<number>();
  const push = (uploadId: number) => {
    if (seen.has(uploadId)) {
      return;
    }
    seen.add(uploadId);
    ids.push(uploadId);
  };
  if (item.risk_highlight) {
    push(item.risk_highlight.upload_id);
  }
  for (const uploadId of item.preview_upload_ids ?? []) {
    push(uploadId);
  }
  if (ids.length === 0) {
    push(item.representative_upload_id);
  }
  return ids;
}

export function TodayPatientPool({
  loading,
  error,
  suspectedPatients,
  elevatedPatients,
  otherPatients,
  items,
  dayScopeLabel,
  isTodaySelected,
  selectedDate,
  selectedPatientId,
  onSelectPatient,
  onReviewSaved,
}: TodayPatientPoolProps) {
  const selectedItem =
    selectedPatientId != null ? items.find((item) => item.patient_id === selectedPatientId) ?? null : null;

  const uploadIdsForImages = useMemo(() => {
    const seen = new Set<number>();
    const ids: number[] = [];
    for (const item of items) {
      for (const uploadId of collectItemUploadIds(item)) {
        if (seen.has(uploadId)) {
          continue;
        }
        seen.add(uploadId);
        ids.push(uploadId);
      }
    }
    return ids;
  }, [items]);

  const { imageUrlByUploadId, imageErrorByUploadId } = useUploadImageUrls(uploadIdsForImages);

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <section className="min-w-0 flex-1 rounded-xl border border-dashed border-zinc-300 bg-zinc-50/80 p-3 lg:flex-[1.5]">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-zinc-900">{dayScopeLabel}上傳病患</h2>
          <p className="text-xs text-zinc-500">
            疑似感染 {suspectedPatients} · 高風險 {elevatedPatients} · 其餘 {otherPatients}
          </p>
        </div>
        {loading ? <p className="py-6 text-center text-sm text-zinc-400">載入中…</p> : null}
        {!loading && error ? <p className="py-6 text-center text-sm text-red-600">{error}</p> : null}
        {!loading && !error && items.length === 0 ? (
          <p className="py-6 text-center text-sm text-zinc-400">{dayScopeLabel}尚無上傳病患。</p>
        ) : null}
        {!loading && !error && items.length > 0 ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3">
            {items.map((item) => (
              <TodayPatientRow
                key={item.patient_id}
                item={item}
                isTodaySelected={isTodaySelected}
                selected={item.patient_id === selectedPatientId}
                onSelect={onSelectPatient}
                imageUrlByUploadId={imageUrlByUploadId}
                imageErrorByUploadId={imageErrorByUploadId}
              />
            ))}
          </div>
        ) : null}
      </section>

      <TodayPatientDetailPanel
        item={selectedItem}
        selectedDate={selectedDate}
        dayScopeLabel={dayScopeLabel}
        isTodaySelected={isTodaySelected}
        className="w-full shrink-0 lg:sticky lg:top-4 lg:w-[320px] xl:w-[360px]"
        onReviewSaved={onReviewSaved}
        imageUrlByUploadId={imageUrlByUploadId}
        imageErrorByUploadId={imageErrorByUploadId}
      />
    </div>
  );
}
