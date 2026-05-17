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
          <p className="text-sm text-zinc-500">PD Care Peritoneal Dialysis Exit-Site Care System</p>
        </header>

        <section className="space-y-3 text-sm leading-7 text-zinc-700">
          <p>
            This system uses artificial intelligence and deep learning technologies to assist peritoneal dialysis (PD) patients with standardized catheter exit-site imaging capture and early risk alerts.
          </p>
          <p>
            To provide care and image review services, the system collects and processes necessary data, including LINE identity information, medical record matching data, uploaded images, AI analysis results, and operation logs, solely for medical care, clinical review, and research analysis at National Taiwan University Hospital.
          </p>
          <p>
            All images and records are stored in protected backend systems with role-based access control and audit mechanisms; only authorized medical staff or administrators may view and process them within the scope necessary for their duties.
          </p>
          <p>
            AI outputs provided by this system are for risk reference only and do not constitute medical diagnosis or treatment advice; final determinations are made by qualified healthcare professionals. If you have questions about data use, retention, or access management, please contact the hospital or the system administration unit.
          </p>
          <p>
            Related patent information: Republic of China (Taiwan) Patent No. M678111, titled Peritoneal Dialysis Intelligent Identification System.
          </p>
          <p>
            Contact: National Taiwan University Hospital Peritoneal Dialysis Center, (02) 2356-2277
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
