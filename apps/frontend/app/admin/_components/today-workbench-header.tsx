type TodayWorkbenchHeaderProps = {
  showUsageTrends?: boolean;
};

export function TodayWorkbenchHeader({ showUsageTrends = false }: TodayWorkbenchHeaderProps) {
  return (
    <header>
      <h1 className="text-xl font-semibold text-zinc-900">儀表板</h1>
      <p className="mt-1 text-xs text-zinc-500">
        {showUsageTrends ? "使用趨勢與當日需關注病患。" : "當日需關注病患。"}
      </p>
    </header>
  );
}
