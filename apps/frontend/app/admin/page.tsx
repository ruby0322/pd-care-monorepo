"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";

import {
  DashboardDayCalendar,
  type DayCalendarMetrics,
} from "@/app/admin/_components/dashboard-day-calendar";
import { TodayPatientPool } from "@/app/admin/_components/today-patient-pool";
import { TodayWorkbenchHeader } from "@/app/admin/_components/today-workbench-header";
import { useAdminSelectedDate } from "@/lib/admin/use-admin-selected-date";
import {
  fetchHistoryOverviewCalendar,
  fetchHistoryOverviewDays,
  fetchTodayAttention,
  type StaffTodayAttentionResponse,
} from "@/lib/api/staff";
import { getMonthKeysForWeek, getWeekStartDateKey } from "@/lib/utils/upload-calendar";

function AdminDashboardInner() {
  const { selectedDate, setSelectedDate, isTodaySelected, dayScopeLabel } = useAdminSelectedDate();

  const [attention, setAttention] = useState<StaffTodayAttentionResponse | null>(null);
  const [attentionLoading, setAttentionLoading] = useState(true);
  const [attentionError, setAttentionError] = useState<string | null>(null);
  const [selectedPatientId, setSelectedPatientId] = useState<number | null>(null);

  const [browseWeekStart, setBrowseWeekStart] = useState<string | null>(null);
  const weekStartDateKey = browseWeekStart ?? getWeekStartDateKey(selectedDate);
  const weekMonthKeys = useMemo(() => getMonthKeysForWeek(weekStartDateKey), [weekStartDateKey]);

  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [metricsByDate, setMetricsByDate] = useState<Record<string, DayCalendarMetrics>>({});
  const [calendarLoading, setCalendarLoading] = useState(true);

  const refreshAttention = useCallback(() => {
    setAttentionLoading(true);
    return fetchTodayAttention({ localDate: selectedDate })
      .then((data) => {
        setAttention(data);
        setAttentionError(null);
      })
      .catch(() => {
        setAttentionError(`無法載入${dayScopeLabel}上傳病患`);
        setAttention(null);
      })
      .finally(() => {
        setAttentionLoading(false);
      });
  }, [dayScopeLabel, selectedDate]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setAttentionLoading(true);
      void fetchTodayAttention({ localDate: selectedDate })
        .then((data) => {
          if (!cancelled) {
            setAttention(data);
            setAttentionError(null);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setAttentionError(`無法載入${dayScopeLabel}上傳病患`);
            setAttention(null);
          }
        })
        .finally(() => {
          if (!cancelled) {
            setAttentionLoading(false);
          }
        });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [selectedDate, dayScopeLabel]);

  useEffect(() => {
    let cancelled = false;
    void fetchHistoryOverviewDays()
      .then((data) => {
        if (!cancelled) {
          setAvailableDates(data.items.map((item) => item.local_date));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAvailableDates([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setCalendarLoading(true);
      void Promise.all(
        weekMonthKeys.map((monthKey) => {
          const [year, month] = monthKey.split("-").map(Number);
          return fetchHistoryOverviewCalendar({ year, month });
        })
      )
        .then((responses) => {
          if (cancelled) {
            return;
          }
          const next: Record<string, DayCalendarMetrics> = {};
          for (const response of responses) {
            for (const item of response.items) {
              next[item.local_date] = {
                uploadCount: item.upload_count ?? 0,
                uploadedUsers: item.uploaded_users ?? 0,
                riskyPatients: item.risky_patient_count ?? 0,
                unhandledPatients: item.unhandled_patient_count ?? 0,
              };
            }
          }
          setMetricsByDate(next);
        })
        .catch(() => {
          if (!cancelled) {
            setMetricsByDate({});
          }
        })
        .finally(() => {
          if (!cancelled) {
            setCalendarLoading(false);
          }
        });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [weekMonthKeys]);

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
      <TodayWorkbenchHeader selectedDate={selectedDate} dayScopeLabel={dayScopeLabel} />

      <DashboardDayCalendar
        selectedDate={selectedDate}
        weekStartDateKey={weekStartDateKey}
        metricsByDate={metricsByDate}
        availableDates={availableSet}
        loading={calendarLoading}
        onSelectDate={(dateKey) => {
          setBrowseWeekStart(null);
          setSelectedDate(dateKey);
        }}
        onWeekChange={(nextWeekStart) => {
          setBrowseWeekStart(nextWeekStart);
        }}
      />

      <TodayPatientPool
        loading={attentionLoading}
        error={attentionError}
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
          void refreshAttention();
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
