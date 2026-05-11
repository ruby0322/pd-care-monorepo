import Link from "next/link";

export default function PrivacyPolicyPage() {
  return (
    <main className="min-h-screen bg-white px-6 py-10">
      <div className="mx-auto w-full max-w-3xl space-y-8">
        <header className="space-y-2">
          <div className="flex items-center justify-between gap-4">
            <h1 className="text-2xl font-semibold text-zinc-900">隱私權政策</h1>
            <Link href="/privacy-policy/en" className="text-sm text-zinc-500 underline underline-offset-4 hover:text-zinc-900">
              English
            </Link>
          </div>
          <p className="text-sm text-zinc-500">PD Care 腹膜透析出口照護系統</p>
        </header>

        <section className="space-y-3 text-sm leading-7 text-zinc-700">
          <p>
            本系統（AI 即時腹膜透析導管傷口監測）透過人工智慧與深度學習技術，協助腹膜透析（PD）病患進行出口影像標準化拍攝與早期風險提醒。
          </p>
          <p>
            為提供照護與審查服務，系統會蒐集並處理必要資料，包括 LINE 身分識別資訊、病歷比對資訊、上傳影像、AI 分析結果與操作紀錄，僅用於台大醫院醫療照護、臨床審查與研究分析。
          </p>
          <p>
            所有影像與紀錄皆儲存於受保護的後端系統，並以權限與稽核機制控管存取；僅授權之醫療人員或管理人員得於必要範圍內檢視與處理。
          </p>
          <p>
            本系統提供之 AI 結果僅為風險提示，不構成醫療診斷或治療建議；最終判斷仍由醫療專業人員作成。若您對資料使用、保存或權限管理有疑問，請聯繫院方或系統管理單位。
          </p>
          <p>
            技術相關專利資訊：中華民國專利（M678111），名稱為「腹膜透析智慧辨識系統」。
          </p>
        </section>

        <div className="border-t border-zinc-200 pt-4">
          <Link href="/" className="text-sm text-zinc-600 underline underline-offset-4 hover:text-zinc-900">
            返回首頁
          </Link>
        </div>
      </div>
    </main>
  );
}
