"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { getReadableApiError } from "@/lib/api/client";
import {
  fetchStaffNotifications,
  markStaffNotificationRead,
  StaffNotificationItem,
} from "@/lib/api/staff";

type AdminNotificationContextValue = {
  notifications: StaffNotificationItem[];
  unreadCount: number;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  markingIds: Record<number, boolean>;
  refreshNotifications: () => Promise<void>;
  markNotificationRead: (notificationId: number) => Promise<void>;
};

const AdminNotificationContext = createContext<AdminNotificationContextValue | null>(null);

export function AdminNotificationProvider({ children }: { children: React.ReactNode }) {
  const [notifications, setNotifications] = useState<StaffNotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [markingIds, setMarkingIds] = useState<Record<number, boolean>>({});

  const refreshNotifications = useCallback(async () => {
    setRefreshing(true);
    try {
      const payload = await fetchStaffNotifications({ limit: 20, offset: 0 });
      setNotifications(payload.items);
      setUnreadCount(payload.unread_count);
      setError(null);
    } catch (refreshError) {
      setError(getReadableApiError(refreshError));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const markNotificationRead = useCallback(async (notificationId: number) => {
    setMarkingIds((current) => ({ ...current, [notificationId]: true }));
    try {
      await markStaffNotificationRead(notificationId);
      setNotifications((current) =>
        current.map((item) => (item.id === notificationId ? { ...item, status: "reviewed" } : item))
      );
      setUnreadCount((current) => Math.max(0, current - 1));
      setError(null);
    } catch (markError) {
      setError(getReadableApiError(markError));
    } finally {
      setMarkingIds((current) => {
        const next = { ...current };
        delete next[notificationId];
        return next;
      });
    }
  }, []);

  useEffect(() => {
    let active = true;
    const loadInitial = async () => {
      try {
        const payload = await fetchStaffNotifications({ limit: 20, offset: 0 });
        if (!active) {
          return;
        }
        setNotifications(payload.items);
        setUnreadCount(payload.unread_count);
        setError(null);
      } catch (loadError) {
        if (!active) {
          return;
        }
        setError(getReadableApiError(loadError));
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };
    void loadInitial();
    const interval = setInterval(() => {
      void refreshNotifications();
    }, 60000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [refreshNotifications]);

  const value = useMemo<AdminNotificationContextValue>(
    () => ({
      notifications,
      unreadCount,
      loading,
      refreshing,
      error,
      markingIds,
      refreshNotifications,
      markNotificationRead,
    }),
    [error, loading, markNotificationRead, markingIds, notifications, refreshNotifications, refreshing, unreadCount]
  );

  return <AdminNotificationContext.Provider value={value}>{children}</AdminNotificationContext.Provider>;
}

export function useAdminNotifications() {
  const context = useContext(AdminNotificationContext);
  if (!context) {
    throw new Error("useAdminNotifications must be used within AdminNotificationProvider");
  }
  return context;
}
