"use client";

import { useMemo, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";

const DEFAULT_DASHBOARD_PATH =
  "/grafana/d/pdcare-overview/pd-care-observability?orgId=1&refresh=30s&from=now-6h&to=now&kiosk=tv";

export default function AdminMonitoringPage() {
  const [reloadKey, setReloadKey] = useState(0);
  const [iframeBlocked, setIframeBlocked] = useState(false);

  const dashboardSrc = useMemo(() => {
    const configuredPath = process.env.NEXT_PUBLIC_GRAFANA_EMBED_PATH?.trim();
    if (!configuredPath) {
      return DEFAULT_DASHBOARD_PATH;
    }
    if (configuredPath.startsWith("http://") || configuredPath.startsWith("https://") || configuredPath.startsWith("/")) {
      return configuredPath;
    }
    return `/${configuredPath}`;
  }, []);

  const externalDashboardUrl = useMemo(() => {
    const withoutKiosk = dashboardSrc.replace(/([?&])kiosk=[^&]*/g, "");
    const publicBase = process.env.NEXT_PUBLIC_GRAFANA_PUBLIC_URL?.trim();
    if (publicBase && withoutKiosk.startsWith("/grafana/")) {
      return `${publicBase.replace(/\/+$/, "")}${withoutKiosk.slice("/grafana".length)}`;
    }
    return withoutKiosk;
  }, [dashboardSrc]);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900">監控中心</h1>
          <p className="text-xs text-zinc-500">即時檢視 backend 指標與 frontend/backend 日誌</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setIframeBlocked(false);
              setReloadKey((value) => value + 1);
            }}
            className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
          >
            <RefreshCw className="h-4 w-4" />
            重新載入
          </button>
          <a
            href={externalDashboardUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
          >
            <ExternalLink className="h-4 w-4" />
            另開 Grafana
          </a>
        </div>
      </header>

      {iframeBlocked ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          內嵌儀表板載入失敗，可能是瀏覽器安全政策或 Grafana 設定造成。請使用「另開 Grafana」查看。
        </div>
      ) : null}

      <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white">
        <iframe
          key={reloadKey}
          src={dashboardSrc}
          title="PD Care Monitoring Dashboard"
          className="h-[calc(100vh-220px)] min-h-[640px] w-full"
          onError={() => setIframeBlocked(true)}
        />
      </div>
    </div>
  );
}
