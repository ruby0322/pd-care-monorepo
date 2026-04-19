import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, CheckCircle, AlertTriangle, XCircle, Upload, User, Calendar } from "lucide-react";
import { getPatientById } from "@/lib/mock-data";
import { PhotoRecord, AIResult } from "@/lib/types";
import clsx from "clsx";

function ResultBadge({ result }: { result: AIResult }) {
  const config = {
    normal: { icon: CheckCircle, label: "正常", className: "bg-emerald-50 text-emerald-600 border-emerald-100" },
    suspected: { icon: AlertTriangle, label: "疑似感染", className: "bg-red-50 text-red-600 border-red-100" },
    rejected: { icon: XCircle, label: "拒絕上傳", className: "bg-amber-50 text-amber-600 border-amber-100" },
  };
  const { icon: Icon, label, className } = config[result.classification];
  return (
    <span className={clsx("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium", className)}>
      <Icon className="w-3 h-3" strokeWidth={2} />
      {label}
      {result.accepted && (
        <span className="text-zinc-400 font-normal">{result.confidence}%</span>
      )}
    </span>
  );
}

function SymptomTags({ record }: { record: PhotoRecord }) {
  const active = [
    record.symptoms.pain && "疼痛",
    record.symptoms.discharge && "分泌物",
    record.symptoms.cloudyDialysate && "透析液混濁",
  ].filter(Boolean);

  if (active.length === 0) return <span className="text-xs text-zinc-400">無症狀</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {active.map((s) => (
        <span key={s as string} className="px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-600 text-xs">
          {s}
        </span>
      ))}
    </div>
  );
}

function MockPhoto({ result }: { result: AIResult }) {
  const cl = result.classification;
  const bg = cl === "normal" ? "bg-emerald-50" : cl === "suspected" ? "bg-red-50" : "bg-zinc-100";
  const text = cl === "normal" ? "text-emerald-300" : cl === "suspected" ? "text-red-300" : "text-zinc-300";
  return (
    <div className={clsx("w-16 h-16 rounded-xl flex items-center justify-center flex-shrink-0", bg)}>
      <Upload className={clsx("w-5 h-5", text)} strokeWidth={1.5} />
    </div>
  );
}

export default async function PatientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const patient = getPatientById(id);
  if (!patient) notFound();

  const sortedRecords = [...patient.records].sort(
    (a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
  );

  const totalUploads = patient.records.length;
  const suspectedCount = patient.records.filter((r) => r.aiResult.classification === "suspected").length;
  const rejectedCount = patient.records.filter((r) => r.aiResult.classification === "rejected").length;

  const recordsByDate = sortedRecords.reduce<Record<string, PhotoRecord[]>>((acc, r) => {
    const date = new Date(r.uploadedAt).toLocaleDateString("zh-TW", { year: "numeric", month: "long", day: "numeric" });
    if (!acc[date]) acc[date] = [];
    acc[date].push(r);
    return acc;
  }, {});

  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <Link
          href="/admin"
          className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-zinc-100 transition-colors"
        >
          <ChevronLeft className="w-5 h-5 text-zinc-500" strokeWidth={1.5} />
        </Link>
        <div>
          <h1 className="text-lg font-semibold text-zinc-900">{patient.name}</h1>
          <p className="text-xs text-zinc-400 font-mono mt-0.5">{patient.caseNumber}</p>
        </div>
      </div>

      <div className="bg-white border border-zinc-100 rounded-2xl p-5">
        <h2 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-4 flex items-center gap-2">
          <User className="w-3.5 h-3.5" strokeWidth={2} />
          基本資料
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-4">
          {[
            { label: "姓名", value: patient.name },
            { label: "病例號", value: patient.caseNumber, mono: true },
            { label: "年齡", value: `${patient.age} 歲` },
            { label: "性別", value: patient.gender === "male" ? "男" : "女" },
            { label: "LINE 帳號", value: `@${patient.lineUsername}`, mono: true },
            { label: "診斷日期", value: new Date(patient.diagnosisDate).toLocaleDateString("zh-TW") },
          ].map(({ label, value, mono }) => (
            <div key={label}>
              <div className="text-xs text-zinc-400 mb-0.5">{label}</div>
              <div className={clsx("text-sm text-zinc-900", mono && "font-mono")}>{value}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { icon: Upload, label: "總上傳次數", value: totalUploads, color: "zinc" },
          { icon: AlertTriangle, label: "疑似感染次數", value: suspectedCount, color: "red" },
          { icon: XCircle, label: "拒絕上傳次數", value: rejectedCount, color: "amber" },
        ].map(({ icon: Icon, label, value, color }) => (
          <div key={label} className="bg-white border border-zinc-100 rounded-2xl p-4 flex flex-col gap-2">
            <Icon
              className={clsx(
                "w-4 h-4",
                color === "red" ? "text-red-400" : color === "amber" ? "text-amber-400" : "text-zinc-400"
              )}
              strokeWidth={1.5}
            />
            <div className={clsx("text-xl font-semibold", color === "red" ? "text-red-600" : color === "amber" ? "text-amber-600" : "text-zinc-900")}>
              {value}
            </div>
            <div className="text-xs text-zinc-400">{label}</div>
          </div>
        ))}
      </div>

      <div className="bg-white border border-zinc-100 rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-zinc-50 flex items-center gap-2">
          <Calendar className="w-4 h-4 text-zinc-400" strokeWidth={1.5} />
          <h2 className="text-sm font-medium text-zinc-900">上傳歷程</h2>
        </div>
        <div className="divide-y divide-zinc-50">
          {Object.entries(recordsByDate).map(([date, recs]) => (
            <div key={date} className="px-5 py-4">
              <div className="text-xs font-medium text-zinc-400 mb-3">{date}</div>
              <div className="flex flex-col gap-3">
                {recs.map((record) => (
                  <div key={record.id} className="flex items-start gap-4">
                    <MockPhoto result={record.aiResult} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1.5">
                        <ResultBadge result={record.aiResult} />
                        <span className="text-xs text-zinc-400">
                          {new Date(record.uploadedAt).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                      {record.aiResult.rejectionReason && (
                        <p className="text-xs text-amber-600 mb-1.5">{record.aiResult.rejectionReason}</p>
                      )}
                      <SymptomTags record={record} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
