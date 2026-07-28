"use client";

import type { StaffTodayAttentionPatientItem } from "@/lib/api/staff";

import { TodayPatientRow } from "./today-patient-row";

type TodayPatientPoolProps = {
  loading: boolean;
  error: string | null;
  suspectedPatients: number;
  elevatedPatients: number;
  otherPatients: number;
  items: StaffTodayAttentionPatientItem[];
  dayScopeLabel: string;
  isTodaySelected: boolean;
};

export function TodayPatientPool({
  loading,
  error,
  suspectedPatients,
  elevatedPatients,
  otherPatients,
  items,
  dayScopeLabel,
  isTodaySelected,
}: TodayPatientPoolProps) {
  return (
    <section className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50/80 p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-zinc-900">{dayScopeLabel}上傳病患</h2>
        <p className="text-xs text-zinc-500">
          疑似 {suspectedPatients} · 高風險 {elevatedPatients} · 其餘 {otherPatients}
        </p>
      </div>
      {loading ? <p className="py-6 text-center text-sm text-zinc-400">載入中…</p> : null}
      {!loading && error ? <p className="py-6 text-center text-sm text-red-600">{error}</p> : null}
      {!loading && !error && items.length === 0 ? (
        <p className="py-6 text-center text-sm text-zinc-400">{dayScopeLabel}尚無上傳病患。</p>
      ) : null}
      {!loading && !error && items.length > 0 ? (
        <div className="grid grid-cols-1 gap-2 lg:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <TodayPatientRow key={item.patient_id} item={item} isTodaySelected={isTodaySelected} />
          ))}
        </div>
      ) : null}
    </section>
  );
}
