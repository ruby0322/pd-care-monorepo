"use client";

import { bindIdentity, fetchIdentityStatus, IdentityStatus } from "@/lib/api/identity";
import { getApiErrorDetail } from "@/lib/api/client";
import { getLiffProfile } from "@/lib/auth/liff";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, ChevronRight, AlertCircle } from "lucide-react";
import clsx from "clsx";

type ToggleItem = {
  id: "pain" | "discharge" | "cloudyDialysate";
  label: string;
  description: string;
  warningText: string;
};

const ITEMS: ToggleItem[] = [
  {
    id: "pain",
    label: "疼痛",
    description: "出口部位是否有疼痛感",
    warningText: "疼痛可能為感染徵兆",
  },
  {
    id: "discharge",
    label: "分泌物",
    description: "出口是否有分泌物或滲液",
    warningText: "分泌物可能為感染徵兆",
  },
  {
    id: "cloudyDialysate",
    label: "透析液混濁",
    description: "引流後的透析液是否混濁",
    warningText: "混濁透析液可能為腹膜炎徵兆",
  },
];

function SymptomEntryView() {
  const router = useRouter();
  const [symptoms, setSymptoms] = useState({
    pain: false,
    discharge: false,
    cloudyDialysate: false,
  });

  const hasWarning = symptoms.pain || symptoms.discharge || symptoms.cloudyDialysate;

  const toggle = (id: ToggleItem["id"]) => {
    setSymptoms((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleNext = () => {
    const params = new URLSearchParams({
      pain: String(symptoms.pain),
      discharge: String(symptoms.discharge),
      cloudyDialysate: String(symptoms.cloudyDialysate),
    });
    router.push(`/patient/capture?${params.toString()}`);
  };

  return (
    <>
      <header className="flex items-center gap-3 px-5 pt-12 pb-6">
        <Link href="/" className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-zinc-100 transition-colors">
          <ChevronLeft className="w-5 h-5 text-zinc-500" strokeWidth={1.5} />
        </Link>
        <div>
          <h1 className="text-base font-semibold text-zinc-900">症狀自評</h1>
          <p className="text-xs text-zinc-400 mt-0.5">今日出口狀況記錄</p>
        </div>
      </header>

      <main className="flex-1 flex flex-col px-5 pb-8 gap-6">
        <div className="flex flex-col gap-3">
          {ITEMS.map((item) => {
            const active = symptoms[item.id];
            return (
              <button
                key={item.id}
                onClick={() => toggle(item.id)}
                className={clsx(
                  "flex items-center justify-between w-full px-5 py-4 rounded-2xl border transition-all text-left",
                  active
                    ? "border-red-200 bg-red-50"
                    : "border-zinc-100 bg-zinc-50 hover:border-zinc-200"
                )}
              >
                <div>
                  <div className={clsx("text-sm font-medium", active ? "text-red-700" : "text-zinc-800")}>
                    {item.label}
                  </div>
                  <div className={clsx("text-xs mt-0.5", active ? "text-red-500" : "text-zinc-400")}>
                    {active ? item.warningText : item.description}
                  </div>
                </div>
                <div
                  className={clsx(
                    "w-11 h-6 rounded-full transition-colors relative flex-shrink-0 ml-4",
                    active ? "bg-red-500" : "bg-zinc-200"
                  )}
                >
                  <div
                    className={clsx(
                      "absolute top-1 w-4 h-4 rounded-full bg-white shadow-sm transition-all",
                      active ? "left-6" : "left-1"
                    )}
                  />
                </div>
              </button>
            );
          })}
        </div>

        {hasWarning && (
          <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-amber-50 border border-amber-100">
            <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" strokeWidth={1.5} />
            <p className="text-xs text-amber-700 leading-relaxed">
              偵測到潛在症狀，請繼續完成出口拍攝，並聯絡您的照護團隊確認狀況。
            </p>
          </div>
        )}

        <div className="mt-auto flex flex-col gap-3">
          <p className="text-xs text-zinc-400 text-center">
            完成症狀紀錄後，進行出口拍攝以供 AI 分析
          </p>
          <button
            onClick={handleNext}
            className="flex items-center justify-center gap-2 w-full py-4 rounded-2xl bg-zinc-900 text-white text-sm font-medium hover:bg-zinc-800 transition-colors"
          >
            前往出口拍攝
            <ChevronRight className="w-4 h-4" strokeWidth={1.5} />
          </button>
        </div>
      </main>
    </>
  );
}

type LiffProfileState = {
  userId: string;
  displayName: string;
  pictureUrl: string | null;
};

export default function PatientPage() {
  const [profile, setProfile] = useState<LiffProfileState | null>(null);
  const [status, setStatus] = useState<IdentityStatus | null>(null);
  const [caseNumber, setCaseNumber] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      <div className="min-h-screen bg-white flex flex-col">
        <SymptomEntryView />
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
