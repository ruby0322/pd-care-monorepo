"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, MessageSquare, RefreshCw } from "lucide-react";

import { fetchPatientMessages, markPatientMessageRead, PatientMessageItem } from "@/lib/api/upload-history";
import { apiClient, getReadableApiError } from "@/lib/api/client";
import { getLiffLoginProof } from "@/lib/auth/liff";
import { getPatientSession, setPatientSession } from "@/lib/auth/patient-session";

type LoginResponse = {
  access_token: string;
  expires_in: number;
  role: "patient" | "staff" | "admin";
  line_user_id: string;
};

export default function PatientMessagesPage() {
  const router = useRouter();
  const [items, setItems] = useState<PatientMessageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoadingId, setActionLoadingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);

  const ensurePatientSession = useCallback(async () => {
    const existing = getPatientSession();
    if (existing) {
      return;
    }
    const proof = await getLiffLoginProof();
    const response = await apiClient.post<LoginResponse>("/v1/auth/login", {
      line_id_token: proof.idToken,
    });
    const payload = response.data;
    if (payload.role !== "patient" && payload.role !== "admin") {
      throw new Error("目前 LINE 帳號角色無法讀取病患端訊息。");
    }
    setPatientSession({
      accessToken: payload.access_token,
      expiresAt: Date.now() + payload.expires_in * 1000,
      role: payload.role,
      lineUserId: payload.line_user_id,
    });
  }, []);

  const loadMessages = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      await ensurePatientSession();
      const payload = await fetchPatientMessages({ limit: 50 });
      setItems(payload.items);
      setUnreadCount(payload.unread_count);
    } catch (err) {
      if (err instanceof Error && err.message.trim()) {
        setError(err.message);
      } else {
        setError(getReadableApiError(err));
      }
    } finally {
      setLoading(false);
    }
  }, [ensurePatientSession]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadMessages();
    }, 0);
    return () => clearTimeout(timer);
  }, [loadMessages]);

  const subtitle = useMemo(() => {
    if (loading) {
      return "正在載入訊息...";
    }
    if (unreadCount > 0) {
      return `目前有 ${unreadCount} 則未讀訊息`;
    }
    return "目前沒有未讀訊息";
  }, [loading, unreadCount]);

  const handleReadAndOpen = async (item: PatientMessageItem) => {
    try {
      setActionLoadingId(item.annotation_id);
      if (!item.is_read) {
        await markPatientMessageRead(item.annotation_id);
      }
      router.push(`/patient/uploads/${item.upload_id}`);
    } catch (err) {
      setError(getReadableApiError(err));
    } finally {
      setActionLoadingId(null);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-white px-6 py-10">
      <div className="flex items-center gap-3">
        <Link
          href="/patient"
          className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-500 transition-colors hover:bg-zinc-100"
        >
          <ChevronLeft className="h-5 w-5" strokeWidth={1.5} />
        </Link>
        <div>
          <h1 className="text-lg font-semibold text-zinc-900">訊息盒</h1>
          <p className="text-xs text-zinc-500">{subtitle}</p>
        </div>
      </div>

      <button
        type="button"
        onClick={() => void loadMessages()}
        className="mt-4 inline-flex items-center gap-2 rounded-xl border border-zinc-200 px-3 py-2 text-xs text-zinc-600 transition-colors hover:bg-zinc-50"
      >
        <RefreshCw className="h-3.5 w-3.5" />
        重新整理
      </button>

      {error ? <div className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

      {loading ? (
        <div className="mt-5 rounded-2xl border border-zinc-100 bg-zinc-50 px-4 py-5 text-sm text-zinc-500">載入中...</div>
      ) : null}

      {!loading && items.length === 0 ? (
        <div className="mt-5 rounded-2xl border border-zinc-100 bg-zinc-50 px-4 py-5 text-sm text-zinc-500">暫無護理註解訊息。</div>
      ) : null}

      <div className="mt-5 space-y-3">
        {items.map((item) => {
          const createdAt = new Date(item.created_at).toLocaleString("zh-TW");
          return (
            <div
              key={item.annotation_id}
              className="rounded-2xl border border-zinc-100 bg-white p-3 shadow-sm shadow-zinc-100/40"
            >
              <div className="flex gap-3">
                <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-zinc-100">
                  <Image
                    src={item.image_url}
                    alt={`message-upload-${item.upload_id}`}
                    width={64}
                    height={64}
                    unoptimized
                    className="h-full w-full object-cover"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {!item.is_read ? (
                      <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-600">未讀</span>
                    ) : (
                      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500">已讀</span>
                    )}
                    <span className="text-[11px] text-zinc-500">{createdAt}</span>
                  </div>
                  <p className="mt-1 text-sm font-medium text-zinc-800">護理標註：{item.label}</p>
                  <p className="mt-0.5 line-clamp-2 text-xs text-zinc-600">{item.comment || "（無補充說明）"}</p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => void handleReadAndOpen(item)}
                disabled={actionLoadingId === item.annotation_id}
                className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-50"
              >
                <MessageSquare className="h-4 w-4" />
                {actionLoadingId === item.annotation_id ? "處理中..." : "查看上傳明細"}
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
