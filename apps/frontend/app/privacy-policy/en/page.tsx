import Link from "next/link";

export default function PrivacyPolicyEnPage() {
  return (
    <main className="min-h-screen bg-white px-6 py-10">
      <div className="mx-auto w-full max-w-3xl space-y-8">
        <header className="space-y-2">
          <div className="flex items-center justify-between gap-4">
            <h1 className="text-2xl font-semibold text-zinc-900">Privacy Policy</h1>
            <Link href="/privacy-policy" className="text-sm text-zinc-500 underline underline-offset-4 hover:text-zinc-900">
              中文版
            </Link>
          </div>
          <p className="text-sm text-zinc-500">PD Care Peritoneal Dialysis Exit-Site Monitoring System</p>
        </header>

        <section className="space-y-3 text-sm leading-7 text-zinc-700">
          <p>
            This system (AI-based recognition for peritoneal dialysis catheter exit-site infection risk) uses artificial intelligence and deep learning technologies to assist patients with standardized exit-site image capture and early risk alerts.
          </p>
          <p>
            To support clinical care and review workflows, the system collects and processes necessary data, including LINE identity information, patient matching data, uploaded images, AI analysis outputs, and operation logs, solely for care delivery, clinical review, and research analysis.
          </p>
          <p>
            All images and related records are stored in protected backend systems with role-based access control and audit mechanisms; only authorized medical staff or administrators may access and process data when required.
          </p>
          <p>
            AI outputs are risk prompts only and do not constitute medical diagnosis or treatment advice. Final medical judgment remains the responsibility of qualified healthcare professionals. If you have questions about data usage, retention, or access control, please contact the hospital or system administrators.
          </p>
          <p>
            Related patent information: Republic of China (Taiwan) Patent No. M678111, titled Peritoneal Dialysis Intelligent Identification System.
          </p>
        </section>

        <div className="border-t border-zinc-200 pt-4">
          <Link href="/" className="text-sm text-zinc-600 underline underline-offset-4 hover:text-zinc-900">
            Back to Home
          </Link>
        </div>
      </div>
    </main>
  );
}
