"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { ActiveUploadersSummary } from "@/app/admin/_components/active-uploaders-summary";
import {
  DashboardDayCalendar,
  type DayCalendarMetrics,
} from "@/app/admin/_components/dashboard-day-calendar";
import { PendingBindingsSummary } from "@/app/admin/_components/pending-bindings-summary";
import { TodayPatientPool } from "@/app/admin/_components/today-patient-pool";
import { TodayUploadCount } from "@/app/admin/_components/today-upload-count";
import { TodayWorkbenchHeader } from "@/app/admin/_components/today-workbench-header";
import { useAdminSelectedDate } from "@/lib/admin/use-admin-selected-date";
import { getStaffRole } from "@/lib/auth/staff-session";
import {
  fetchAdminActiveUsersSeries,
  fetchHistoryOverviewCalendar,
  fetchHistoryOverviewDays,
  fetchPendingBindings,
  fetchTodayAttention,
  type StaffPendingBindingItem,
  type StaffTodayAttentionResponse,
} from "@/lib/api/staff";
import { getMonthKeyFromDateKey } from "@/lib/utils/upload-calendar";

function AdminDashboardInner() {
  const { selectedDate, setSelectedDate, isTodaySelected, dayScopeLabel, monthKey } =
    useAdminSelectedDate();

  const [attention, setAttention] = useState<StaffTodayAttentionResponse | null>(null);
  const [attentionLoading, setAttentionLoading] = useState(true);
  const [attentionError, setAttentionError] = useState<string | null>(null);

  const [pendingItems, setPendingItems] = useState<StaffPendingBindingItem[]>([]);
  const [pendingLoading, setPendingLoading] = useState(true);
  const [pendingError, setPendingError] = useState<string | null>(null);

  const isAdmin = getStaffRole() === "admin";
  const [activeUsers, setActiveUsers] = useState<number | null>(null);
  const [activeLoading, setActiveLoading] = useState(isAdmin);
  const [activeError, setActiveError] = useState<string | null>(null);

  const [browseMonthKey, setBrowseMonthKey] = useState<string | null>(null);
  const calendarMonthKey = browseMonthKey ?? monthKey;
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [metricsByDate, setMetricsByDate] = useState<Record<string, DayCalendarMetrics>>({});
  const [calendarLoading, setCalendarLoading] = useState(true);

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
    const [year, month] = calendarMonthKey.split("-").map(Number);
    const timer = window.setTimeout(() => {
      setCalendarLoading(true);
      void fetchHistoryOverviewCalendar({ year, month })
        .then((data) => {
          if (cancelled) {
            return;
          }
          const next: Record<string, DayCalendarMetrics> = {};
          for (const item of data.items) {
            next[item.local_date] = {
              uploadCount: item.upload_count ?? 0,
              uploadedUsers: item.uploaded_users ?? 0,
              riskyPatients: item.risky_patient_count ?? 0,
              unhandledPatients: item.unhandled_patient_count ?? 0,
            };
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
  }, [calendarMonthKey]);

  useEffect(() => {
    let cancelled = false;
    void fetchPendingBindings()
      .then((items) => {
        if (!cancelled) {
          setPendingItems(items);
          setPendingError(null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPendingError("無法載入待審綁定");
          setPendingItems([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setPendingLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isAdmin) {
      return;
    }
    let cancelled = false;
    void fetchAdminActiveUsersSeries({ activeWindowDays: 7, lookbackDays: 7, interval: "day" })
      .then((data) => {
        if (!cancelled) {
          const last = data.items[data.items.length - 1];
          setActiveUsers(last?.active_users ?? 0);
          setActiveError(null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setActiveError("failed");
          setActiveUsers(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setActiveLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  const availableSet = useMemo(() => new Set(availableDates), [availableDates]);

  return (
    <main className="space-y-4 p-4 md:p-6">
      <TodayWorkbenchHeader selectedDate={selectedDate} dayScopeLabel={dayScopeLabel} />

      <DashboardDayCalendar
        selectedDate={selectedDate}
        monthKey={calendarMonthKey}
        metricsByDate={metricsByDate}
        availableDates={availableSet}
        loading={calendarLoading}
        onSelectDate={(dateKey) => {
          setBrowseMonthKey(null);
          setSelectedDate(dateKey);
        }}
        onMonthChange={(nextMonth) => {
          const first = availableDates.find((d) => getMonthKeyFromDateKey(d) === nextMonth);
          if (first) {
            setBrowseMonthKey(null);
            setSelectedDate(first);
          } else {
            setBrowseMonthKey(nextMonth);
          }
        }}
      />

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-[1.5]">
          <TodayPatientPool
            loading={attentionLoading}
            error={attentionError}
            suspectedPatients={attention?.suspected_patients ?? 0}
            elevatedPatients={attention?.elevated_patients ?? 0}
            otherPatients={attention?.other_patients ?? 0}
            items={attention?.items ?? []}
            dayScopeLabel={dayScopeLabel}
            isTodaySelected={isTodaySelected}
          />
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <TodayUploadCount
            totalUploads={attention?.total_uploads ?? null}
            loading={attentionLoading}
            dayScopeLabel={dayScopeLabel}
            selectedDate={selectedDate}
          />
          <PendingBindingsSummary items={pendingItems} loading={pendingLoading} error={pendingError} />
          {isAdmin ? (
            <ActiveUploadersSummary activeUsers={activeUsers} loading={activeLoading} error={activeError} />
          ) : (
            <p className="text-xs text-zinc-400">
              <Link href="/admin/history-overview" className="hover:text-zinc-700">
                查看區間分析 →
              </Link>
            </p>
          )}
        </div>
      </div>
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
