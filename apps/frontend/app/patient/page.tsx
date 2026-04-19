"use client";

import { useState } from "react";
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

export default function PatientPage() {
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
    <div className="min-h-screen bg-white flex flex-col">
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
    </div>
  );
}
