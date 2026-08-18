"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  DashboardDayCalendar,
  type DayCalendarMetrics,
} from "@/app/admin/_components/dashboard-day-calendar";
import { TodayPatientPool } from "@/app/admin/_components/today-patient-pool";
import { TodayWorkbenchHeader } from "@/app/admin/_components/today-workbench-header";
import { UploadTrendChart } from "@/app/admin/_components/upload-trend-chart";
import { UserTrendChart } from "@/app/admin/_components/user-trend-chart";
import { useAdminSelectedDate } from "@/lib/admin/use-admin-selected-date";
import {
  fetchTodayAttention,
  fetchWorkbenchDashboard,
  type StaffTodayAttentionResponse,
  type StaffWorkbenchWeekDayItem,
} from "@/lib/api/staff";
import { getWeekStartDateKey } from "@/lib/utils/upload-calendar";

function metricsFromWeekDays(weekDays: StaffWorkbenchWeekDayItem[]): Record<string, DayCalendarMetrics> {
  const next: Record<string, DayCalendarMetrics> = {};
  for (const day of weekDays) {
    next[day.local_date] = {
      uploadCount: day.upload_count ?? 0,
      uploadedUsers: day.uploaded_users ?? 0,
      riskyPatients: day.risky_patient_count ?? 0,
      unhandledPatients: day.unhandled_patient_count ?? 0,
    };
  }
  return next;
}

function AdminDashboardInner() {
  const { selectedDate, setSelectedDate, isTodaySelected, dayScopeLabel } = useAdminSelectedDate();

  const [attention, setAttention] = useState<StaffTodayAttentionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPatientId, setSelectedPatientId] = useState<number | null>(null);

  const [browseWeekStart, setBrowseWeekStart] = useState<string | null>(null);
  const weekStartDateKey = browseWeekStart ?? getWeekStartDateKey(selectedDate);

  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [metricsByDate, setMetricsByDate] = useState<Record<string, DayCalendarMetrics>>({});
  const cachedWeekStartRef = useRef<string | null>(null);

  const loadWorkbench = useCallback(
    async (options?: { forceFull?: boolean; isCancelled?: () => boolean }) => {
      const cancelled = options?.isCancelled ?? (() => false);
      const forceFull = options?.forceFull ?? false;
      const weekChanged = forceFull || cachedWeekStartRef.current !== weekStartDateKey;

      setLoading(true);
      try {
        if (weekChanged) {
          const data = await fetchWorkbenchDashboard({
            localDate: selectedDate,
            weekStart: weekStartDateKey,
          });
          if (cancelled()) {
            return;
          }
          setAvailableDates(data.available_dates);
          setMetricsByDate(metricsFromWeekDays(data.week_days));
          setAttention(data.attention);
          cachedWeekStartRef.current = weekStartDateKey;
        } else {
          const data = await fetchTodayAttention({ localDate: selectedDate });
          if (cancelled()) {
            return;
          }
          setAttention(data);
        }
        setError(null);
      } catch {
        if (cancelled()) {
          return;
        }
        setError(`無法載入${dayScopeLabel}上傳病患`);
        setAttention(null);
      } finally {
        if (!cancelled()) {
          setLoading(false);
        }
      }
    },
    [dayScopeLabel, selectedDate, weekStartDateKey]
  );

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void loadWorkbench({ isCancelled: () => cancelled });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [loadWorkbench]);

  const availableSet = useMemo(() => new Set(availableDates), [availableDates]);
  const resolvedPatientId = useMemo(() => {
    const items = attention?.items ?? [];
    if (items.length === 0) {
      return null;
    }
    if (
      selectedPatientId != null &&
      items.some((item) => item.patient_id === selectedPatientId)
    ) {
      return selectedPatientId;
    }
    return items[0].patient_id;
  }, [attention?.items, selectedPatientId]);

  return (
    <main className="space-y-4 p-4 md:p-6">
      <TodayWorkbenchHeader />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <UserTrendChart />
        <UploadTrendChart />
      </div>

      <DashboardDayCalendar
        selectedDate={selectedDate}
        weekStartDateKey={weekStartDateKey}
        metricsByDate={metricsByDate}
        availableDates={availableSet}
        loading={loading}
        onSelectDate={(dateKey) => {
          setBrowseWeekStart(null);
          setSelectedDate(dateKey);
        }}
        onWeekChange={(nextWeekStart) => {
          setBrowseWeekStart(nextWeekStart);
        }}
      />

      <TodayPatientPool
        loading={loading}
        error={error}
        suspectedPatients={attention?.suspected_patients ?? 0}
        elevatedPatients={attention?.elevated_patients ?? 0}
        otherPatients={attention?.other_patients ?? 0}
        items={attention?.items ?? []}
        dayScopeLabel={dayScopeLabel}
        isTodaySelected={isTodaySelected}
        selectedDate={selectedDate}
        selectedPatientId={resolvedPatientId}
        onSelectPatient={setSelectedPatientId}
        onReviewSaved={() => {
          void loadWorkbench({ forceFull: true });
        }}
      />
    </main>
  );
}

export default function AdminDashboard() {
  return (
    <Suspense
      fallback={
        <main className="space-y-4 p-4 md:p-6">
          <p className="text-sm text-zinc-400">載入儀表板…</p>
        </main>
      }
    >
      <AdminDashboardInner />
    </Suspense>
  );
}
