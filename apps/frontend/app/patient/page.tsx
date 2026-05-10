"use client";

import { bindIdentity, fetchIdentityStatus, IdentityStatus } from "@/lib/api/identity";
import { getApiErrorDetail } from "@/lib/api/client";
import { fetchUploadHistory, UploadHistoryDay } from "@/lib/api/upload-history";
import { getLiffProfile } from "@/lib/auth/liff";
import { PatientDailyCalendar } from "@/components/patient-daily-calendar";
import { useEffect, useState } from "react";
import Link from "next/link";

type LiffProfileState = {
  userId: string;
  displayName: string;
  pictureUrl: string | null;
};

export default function PatientPage() {
  const [profile, setProfile] = useState<LiffProfileState | null>(null);
  const [status, setStatus] = useState<IdentityStatus | null>(null);
  const [historyDays, setHistoryDays] = useState<UploadHistoryDay[]>([]);
  const [caseNumber, setCaseNumber] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        setLoading(true);
        setError(null);
        const liffProfile = await getLiffProfile();
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
          if (!cancelled) {
            setHistoryLoading(true);
            setHistoryError(null);
          }
          try {
            const history = await fetchUploadHistory(profileState.userId);
            if (!cancelled) {
              setHistoryDays(history.days);
            }
          } catch (historyRequestError) {
            if (!cancelled) {
              setHistoryError(getApiErrorDetail(historyRequestError) ?? "無法載入上傳日曆，仍可繼續拍攝。");
            }
          } finally {
            if (!cancelled) {
              setHistoryLoading(false);
            }
          }
        } else if (!cancelled) {
          setHistoryDays([]);
          setHistoryLoading(false);
          setHistoryError(null);
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
      <div className="min-h-screen bg-white flex items-center justify-center px-6">
        <p className="text-sm text-zinc-500">LINE 身分驗證初始化中...</p>
      </div>
    );
  }

  if (status === "matched") {
    return (
      <div className="min-h-screen bg-white flex flex-col px-6 py-10">
        <p className="text-sm text-zinc-500">{profile?.displayName ?? "使用者"}，歡迎回來！</p>
        <h1 className="text-lg font-semibold text-zinc-900">每日出口追蹤</h1>
        <p className="mt-2 text-sm text-zinc-600 leading-relaxed">
          日曆依據已儲存的上傳紀錄顯示風險狀態。紅色代表當日有至少一筆疑似風險判讀，顏色深淺代表上傳次數。
        </p>

        <div className="mt-6">
          {historyLoading ? (
            <div className="rounded-3xl border border-zinc-100 bg-zinc-50 px-4 py-6 text-sm text-zinc-500">
              正在載入上傳日曆...
            </div>
          ) : (
            <PatientDailyCalendar days={historyDays} />
          )}
        </div>

        {historyError && <p className="mt-3 text-sm text-amber-700">{historyError}</p>}

        <Link
          href="/patient/capture?pain=false&discharge=false&cloudyDialysate=false"
          className="mt-8 flex items-center justify-center w-full py-4 rounded-2xl bg-zinc-900 text-white text-sm font-medium hover:bg-zinc-800 transition-colors"
        >
          開始今日拍攝
        </Link>
        <p className="mt-3 text-xs text-zinc-400">今日已上傳仍可再次拍攝，系統會保留全部紀錄。</p>

        <Link
          href="/"
          className="mt-auto pt-10 text-center text-sm text-zinc-500 hover:text-zinc-700 transition-colors"
        >
          返回首頁
        </Link>
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
