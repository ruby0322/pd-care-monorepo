import Link from "next/link";

export default function TermsOfUsePage() {
  return (
    <main className="min-h-screen bg-white px-6 py-10">
      <div className="mx-auto w-full max-w-3xl space-y-8">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold text-zinc-900">使用條款</h1>
          <p className="text-sm text-zinc-500">PD Care 腹膜透析出口照護系統</p>
        </header>

        <section className="space-y-3 text-sm leading-7 text-zinc-700">
          <p>
            使用本系統即表示您同意本系統僅作為腹膜透析出口照護之輔助工具，並理解其定位為 AI 風險提示平台，不提供醫療診斷或處方建議。
          </p>
          <p>
            使用者應提供真實且正確的身分與病歷比對資訊，並依畫面指示完成標準化拍攝與上傳，以維持影像品質與照護安全。
          </p>
          <p>
            您同意系統得基於醫療照護、遠距監測、臨床審查與研究分析目的處理您上傳之資料；所有資料存取均須符合授權與院方管理規範。
          </p>
          <p>
            未經授權不得擅自存取、複製、散布或修改系統資料與功能。若有違反使用規範或影響系統安全之行為，院方與管理單位得暫停或終止服務。
          </p>
          <p>
            系統與條款內容可能依實際需求調整。若您持續使用本系統，視為同意更新後條款；最新版本以系統頁面公告為準。
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
