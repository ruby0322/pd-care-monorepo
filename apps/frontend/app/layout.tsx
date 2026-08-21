import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";
import "./globals.css";
import { getSiteUrl } from "@/lib/blog/seo";
import { publicPageMetadata } from "@/lib/seo/page-metadata";

const HOME_TITLE = "PD Care｜腹膜透析出口照護系統";
const HOME_DESCRIPTION = "臺大醫院腹膜透析智慧照護：出口影像與 AI 輔助感染偵測，結果不構成診斷。";

export const metadata: Metadata = {
  ...publicPageMetadata({
    title: HOME_TITLE,
    description: HOME_DESCRIPTION,
    path: "/",
  }),
  metadataBase: new URL(getSiteUrl()),
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "PD Care",
  },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-TW" suppressHydrationWarning>
      <body className="antialiased font-sans bg-white" suppressHydrationWarning>
        {children}
        <Toaster position="top-right" richColors closeButton />
      </body>
    </html>
  );
}
