import Link from "next/link";

export default function TermsOfUseEnPage() {
  return (
    <main className="min-h-screen bg-white px-6 py-10">
      <div className="mx-auto w-full max-w-3xl space-y-8">
        <header className="space-y-2">
          <div className="flex items-center justify-between gap-4">
            <h1 className="text-2xl font-semibold text-zinc-900">Terms of Use</h1>
            <Link href="/terms-of-use" className="text-sm text-zinc-500 underline underline-offset-4 hover:text-zinc-900">
              中文版
            </Link>
          </div>
          <p className="text-sm text-zinc-500">PD Care Peritoneal Dialysis Exit-Site Monitoring System</p>
        </header>

        <section className="space-y-3 text-sm leading-7 text-zinc-700">
          <p>
            By using this system, you agree that it serves solely as an assistive tool for peritoneal dialysis exit-site care and functions as an AI risk prompt platform, not a provider of medical diagnosis or prescription advice.
          </p>
          <p>
            Users must provide accurate identity and patient-matching information, and follow the on-screen guidance for standardized image capture and upload to maintain image quality and care safety.
          </p>
          <p>
            You agree that your uploaded data may be processed for clinical care, remote monitoring, clinical review, and research analysis purposes; all data access must comply with authorization controls and hospital governance policies.
          </p>
          <p>
            Unauthorized access, copying, distribution, or modification of system data or functions is prohibited. The hospital or system administrators may suspend or terminate service in cases of policy violations or security risks.
          </p>
          <p>
            System functionality and these terms may be updated as needed. Continued use of the system indicates acceptance of the latest published version.
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
