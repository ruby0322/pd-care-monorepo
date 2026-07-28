"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { getMonthKeyFromDateKey, getTaipeiTodayKey, parseTaipeiDateKey } from "@/lib/utils/upload-calendar";

function isValidDateKey(raw: string | null): raw is string {
  if (!raw) {
    return false;
  }
  try {
    parseTaipeiDateKey(raw);
    return true;
  } catch {
    return false;
  }
}

export function useAdminSelectedDate() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const todayKey = getTaipeiTodayKey();

  const selectedDate = useMemo(() => {
    const fromUrl = searchParams.get("date");
    return isValidDateKey(fromUrl) ? fromUrl : todayKey;
  }, [searchParams, todayKey]);

  const isTodaySelected = selectedDate === todayKey;
  const dayScopeLabel = isTodaySelected ? "今日" : "當日";
  const monthKey = getMonthKeyFromDateKey(selectedDate);

  const setSelectedDate = useCallback(
    (nextDate: string) => {
      if (!isValidDateKey(nextDate)) {
        return;
      }
      const params = new URLSearchParams(searchParams.toString());
      if (nextDate === todayKey) {
        params.delete("date");
      } else {
        params.set("date", nextDate);
      }
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams, todayKey]
  );

  return {
    selectedDate,
    setSelectedDate,
    isTodaySelected,
    dayScopeLabel,
    monthKey,
    todayKey,
  };
}
