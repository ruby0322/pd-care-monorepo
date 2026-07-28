type TodayWorkbenchHeaderProps = {
  selectedDate: string;
  dayScopeLabel: string;
};

export function TodayWorkbenchHeader({ selectedDate, dayScopeLabel }: TodayWorkbenchHeaderProps) {
  return (
    <header>
      <h1 className="text-xl font-semibold text-zinc-900">儀表板</h1>
      <p className="mt-1 text-sm text-zinc-500">
        {selectedDate} · {dayScopeLabel}需關注的病患與工作佇列
      </p>
    </header>
  );
}
