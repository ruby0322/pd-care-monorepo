"use client";

import { PatientDailyCalendar } from "@/components/patient-daily-calendar";
import { apiClient, getApiErrorDetail } from "@/lib/api/client";
import { bindIdentity, fetchIdentityStatus, IdentityStatus } from "@/lib/api/identity";
import {
  fetchPatientMessages,
  fetchUploadHistory,
  PatientMessageItem,
  UploadHistoryDay,
  UploadHistorySummary28d,
} from "@/lib/api/upload-history";
import { getLiffLoginProof } from "@/lib/auth/liff";
import { clearPatientSession, setPatientSession } from "@/lib/auth/patient-session";
import { Camera, MessageSquare, UserRound } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type LiffProfileState = {
  userId: string;
  displayName: string;
  pictureUrl: string | null;
};

type LoginResponse = {
  access_token: string;
  expires_in: number;
  role: "patient" | "staff" | "admin";
  line_user_id: string;
};

function getMessageLabelDotClass(label: string): string {
  if (label === "confirmed_infection") {
    return "bg-red-500";
  }
  if (label === "suspected") {
    return "bg-amber-500";
  }
  if (label === "rejected") {
    return "bg-zinc-500";
  }
  return "bg-emerald-500";
}

export default function PatientPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<LiffProfileState | null>(null);
  const [status, setStatus] = useState<IdentityStatus | null>(null);
  const [historyDays, setHistoryDays] = useState<UploadHistoryDay[]>([]);
  const [summary28d, setSummary28d] = useState<UploadHistorySummary28d>({
    all_upload_count_28d: 0,
    suspected_upload_count_28d: 0,
    continuous_upload_streak_days: 0,
  });
  const [caseNumber, setCaseNumber] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [latestMessage, setLatestMessage] = useState<PatientMessageItem | null>(null);
  const [unreadMessageCount, setUnreadMessageCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [messagePreviewError, setMessagePreviewError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        setLoading(true);
        setError(null);
        const proof = await getLiffLoginProof();
        const liffProfile = proof.profile;
        if (cancelled) {
          return;
        }
        const profileState: LiffProfileState = {
          userId: liffProfile.userId,
          displayName: liffProfile.displayName,
          pictureUrl: liffProfile.pictureUrl ?? null,
        };
        setProfile(profileState);
        const bindStatus = await fetchIdentityStatus(profileState.userId);
        if (!cancelled) {
          setStatus(bindStatus.status);
        }
        if (bindStatus.status === "matched") {
          let tokenExp: number | null = null;
          try {
            const payloadSegment = proof.idToken.split(".")[1];
            const payloadJson = JSON.parse(atob(payloadSegment));
            tokenExp = typeof payloadJson?.exp === "number" ? payloadJson.exp : null;
          } catch {
            tokenExp = null;
          }
          const nowSec = Math.floor(Date.now() / 1000);
          const tokenExpired = tokenExp !== null && tokenExp <= nowSec;
          if (tokenExpired) {
            window.liff?.login({ redirectUri: window.location.href });
            throw new Error("LINE 登入憑證已過期，正在重新導向登入...");
          }
          const loginResponse = await apiClient.post<LoginResponse>("/v1/auth/login", {
            line_id_token: proof.idToken,
          });
          if (cancelled) {
            return;
          }
          const loginPayload = loginResponse.data;
          if (loginPayload.role !== "patient" && loginPayload.role !== "admin") {
            throw new Error("目前 LINE 帳號角色無法使用病患端功能。");
          }
          setPatientSession({
            accessToken: loginPayload.access_token,
            expiresAt: Date.now() + loginPayload.expires_in * 1000,
            role: loginPayload.role,
            lineUserId: loginPayload.line_user_id,
          });
          if (!cancelled) {
            setHistoryLoading(true);
            setHistoryError(null);
            setMessagePreviewError(null);
          }
          try {
            const history = await fetchUploadHistory();
            if (!cancelled) {
              setHistoryDays(history.days);
              setSummary28d(history.summary_28d);
            }
          } catch (historyRequestError) {
            if (!cancelled) {
              setHistoryError(getApiErrorDetail(historyRequestError) ?? "無法載入上傳日曆，仍可繼續拍攝。");
            }
          }
          try {
            const latest = await fetchPatientMessages({ limit: 1 });
            if (!cancelled) {
              setLatestMessage(latest.items[0] ?? null);
              setUnreadMessageCount(latest.unread_count);
            }
          } catch (messageError) {
            if (!cancelled) {
              setMessagePreviewError(getApiErrorDetail(messageError) ?? "訊息預覽載入失敗，可前往訊息盒查看。");
            }
          } finally {
            if (!cancelled) {
              setHistoryLoading(false);
            }
          }
        } else if (!cancelled) {
          clearPatientSession();
          setHistoryDays([]);
          setSummary28d({
            all_upload_count_28d: 0,
            suspected_upload_count_28d: 0,
            continuous_upload_streak_days: 0,
          });
          setLatestMessage(null);
          setUnreadMessageCount(0);
          setHistoryLoading(false);
          setHistoryError(null);
          setMessagePreviewError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(getApiErrorDetail(err) ?? (err instanceof Error ? err.message : "無法初始化 LINE 身分驗證"));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  const submitBinding = async () => {
    if (!profile) {
      return;
    }
    if (!caseNumber.trim() || !birthDate) {
      setError("請輸入病歷號與生日。");
      return;
    }

    try {
      setSubmitting(true);
      setError(null);
      const result = await bindIdentity({
        line_user_id: profile.userId,
        display_name: profile.displayName,
        picture_url: profile.pictureUrl,
        case_number: caseNumber.trim(),
        birth_date: birthDate,
      });
      setStatus(result.status);
    } catch (err) {
      setError(getApiErrorDetail(err) ?? "綁定失敗，請稍後再試或聯絡護理師。");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[100dvh] bg-white flex items-center justify-center px-6">
        <p className="text-sm text-zinc-500">LINE 身分驗證初始化中...</p>
      </div>
    );
  }

  if (status === "matched") {
    const suspectedRate =
      summary28d.all_upload_count_28d > 0
        ? Math.round((summary28d.suspected_upload_count_28d / summary28d.all_upload_count_28d) * 100)
        : 0;

    return (
      <div className="h-[100dvh] overflow-hidden bg-white px-6 pt-8 pb-[calc(env(safe-area-inset-bottom)+1rem)] flex flex-col">
        <h1 className="text-xl font-semibold text-zinc-900">{profile?.displayName ?? "使用者"}，歡迎回來！</h1>
        <p className="mt-2 text-sm text-zinc-600 leading-relaxed">最近 28 天上傳狀態摘要與每日追蹤紀錄。</p>

        <div className="mt-5 min-h-0 flex-1 overflow-y-auto pr-1">
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-2xl border border-zinc-100 bg-zinc-50 px-3 py-3">
              <p className="text-[11px] text-zinc-500">疑似感染率</p>
              <p className="mt-1 text-base font-semibold text-zinc-900">{suspectedRate}%</p>
            </div>
            <div className="rounded-2xl border border-zinc-100 bg-zinc-50 px-3 py-3">
              <p className="text-[11px] text-zinc-500">連續上傳</p>
              <p className="mt-1 text-base font-semibold text-zinc-900">{summary28d.continuous_upload_streak_days} 天</p>
            </div>
            <div className="rounded-2xl border border-zinc-100 bg-zinc-50 px-3 py-3">
              <p className="text-[11px] text-zinc-500">上傳次數</p>
              <p className="mt-1 text-base font-semibold text-zinc-900">{summary28d.all_upload_count_28d}</p>
            </div>
          </div>

          <div className="mt-6">
            {historyLoading ? (
              <div className="rounded-3xl border border-zinc-100 bg-zinc-50 px-4 py-6 text-sm text-zinc-500">
                正在載入上傳日曆...
              </div>
            ) : (
              <PatientDailyCalendar
                days={historyDays}
                onDayClick={(dayKey) => {
                  router.push(`/patient/day/${dayKey}`);
                }}
              />
            )}
          </div>

          {historyError && <p className="mt-3 text-sm text-amber-700">{historyError}</p>}
          {messagePreviewError && <p className="mt-3 text-sm text-amber-700">{messagePreviewError}</p>}

          {latestMessage ? (
            <div className="mt-4 rounded-3xl border border-zinc-200 bg-white px-4 py-4 shadow-sm shadow-zinc-100/50">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-medium text-zinc-600">最新護理註解</p>
                {!latestMessage.is_read ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-600">
                    <span className={`h-1.5 w-1.5 rounded-full ${getMessageLabelDotClass(latestMessage.label)}`} />
                    未讀
                  </span>
                ) : (
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500">已讀</span>
                )}
              </div>
              <div className="mt-2 flex items-center gap-3">
                <div className="h-14 w-14 overflow-hidden rounded-xl bg-zinc-100">
                  <Image
                    src={latestMessage.image_url}
                    alt={`message-preview-${latestMessage.upload_id}`}
                    width={56}
                    height={56}
                    unoptimized
                    className="h-full w-full object-cover"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-zinc-800">標註：{latestMessage.label}</p>
                  <p className="truncate text-xs text-zinc-600">{latestMessage.comment || "（無補充說明）"}</p>
                </div>
              </div>
              <Link
                href="/patient/messages"
                className="mt-3 inline-flex items-center text-xs font-medium text-zinc-700 underline underline-offset-4"
              >
                顯示更多
              </Link>
            </div>
          ) : null}
        </div>

        <div className="pt-4">
          <div className="relative">
            <div className="grid grid-cols-5 items-end gap-3">
              <Link
                href="/patient/messages"
                className="relative col-start-1 justify-self-start flex h-14 w-14 flex-col items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-600 transition-colors hover:bg-zinc-50"
              >
                <MessageSquare className="h-4 w-4" strokeWidth={1.8} />
                <span className="mt-0.5 text-[10px] font-medium">訊息</span>
                {unreadMessageCount > 0 ? (
                  <span className="absolute -right-1 -top-1 inline-flex min-h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-none text-white">
                    {unreadMessageCount > 9 ? "9+" : unreadMessageCount}
                  </span>
                ) : null}
              </Link>

              <Link
                href="/patient/profile"
                className="col-start-5 justify-self-end flex h-14 w-14 flex-col items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-600 transition-colors hover:bg-zinc-50"
              >
                <UserRound className="h-4 w-4" strokeWidth={1.8} />
                <span className="mt-0.5 text-[10px] font-medium">個人</span>
              </Link>
            </div>

            <div className="pointer-events-none absolute inset-0 flex items-end justify-center">
              <Link
                href="/patient/capture?pain=false&discharge=false&cloudyDialysate=false"
                className="pointer-events-auto flex h-20 w-20 flex-col items-center justify-center rounded-full bg-zinc-900 text-white transition-colors hover:bg-zinc-800"
              >
                <Camera className="h-6 w-6" strokeWidth={1.8} />
                <span className="mt-0.5 text-[11px] font-medium">拍攝</span>
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (status === "pending") {
    return (
      <div className="min-h-screen bg-white flex flex-col px-6 py-14">
        <h1 className="text-lg font-semibold text-zinc-900">等待護理師審核</h1>
        <p className="mt-3 text-sm text-zinc-600 leading-relaxed">
          已收到您的身分綁定申請，護理團隊確認後即可開始上傳出口影像。在核可前，系統暫時無法開啟拍攝流程。
        </p>
        <p className="mt-5 text-xs text-zinc-400">LINE 顯示名稱：{profile?.displayName ?? "未知"}</p>
        <Link
          href="/"
          className="mt-auto flex items-center justify-center w-full py-4 rounded-2xl border border-zinc-200 text-zinc-700 text-sm font-medium hover:bg-zinc-50 transition-colors"
        >
          返回首頁
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white flex flex-col px-6 py-14">
      <h1 className="text-lg font-semibold text-zinc-900">首次身分綁定</h1>
      <p className="mt-3 text-sm text-zinc-600 leading-relaxed">
        請輸入病歷號與生日完成臨床身分驗證。若資料尚未建檔，系統會送出待審核申請，待護理師完成綁定後才能上傳影像。
      </p>

      <div className="mt-6 space-y-4">
        <div>
          <label htmlFor="case-number" className="block text-xs font-medium text-zinc-500 mb-1">
            病歷號
          </label>
          <input
            id="case-number"
            value={caseNumber}
            onChange={(event) => setCaseNumber(event.target.value)}
            placeholder="例如 P123456"
            className="w-full rounded-xl border border-zinc-200 px-3 py-2.5 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-300"
          />
        </div>
        <div>
          <label htmlFor="birth-date" className="block text-xs font-medium text-zinc-500 mb-1">
            生日
          </label>
          <input
            id="birth-date"
            type="date"
            value={birthDate}
            onChange={(event) => setBirthDate(event.target.value)}
            className="w-full rounded-xl border border-zinc-200 px-3 py-2.5 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-300"
          />
        </div>
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      <button
        onClick={submitBinding}
        disabled={submitting}
        className="mt-6 w-full py-4 rounded-2xl bg-zinc-900 text-white text-sm font-medium hover:bg-zinc-800 transition-colors disabled:opacity-40"
      >
        {submitting ? "送出中..." : "送出綁定申請"}
      </button>

      <Link
        href="/"
        className="mt-3 flex items-center justify-center w-full py-4 rounded-2xl border border-zinc-200 text-zinc-700 text-sm font-medium hover:bg-zinc-50 transition-colors"
      >
        取消並返回首頁
      </Link>
    </div>
  );
}
