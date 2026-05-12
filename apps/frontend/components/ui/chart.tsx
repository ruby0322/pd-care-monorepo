"use client";

import * as React from "react";
import * as RechartsPrimitive from "recharts";

import { cn } from "@/lib/utils";

export type ChartConfig = {
  [key: string]: {
    label?: React.ReactNode;
    color?: string;
  };
};

type ChartContextProps = {
  config: ChartConfig;
};

const ChartContext = React.createContext<ChartContextProps | null>(null);

function useChart() {
  const context = React.useContext(ChartContext);
  if (!context) {
    throw new Error("useChart must be used within a <ChartContainer />");
  }
  return context;
}

export function ChartContainer({
  id,
  className,
  children,
  config,
}: React.ComponentProps<"div"> & {
  config: ChartConfig;
  children: React.ComponentProps<typeof RechartsPrimitive.ResponsiveContainer>["children"];
}) {
  const uniqueId = React.useId();
  const chartId = `chart-${id ?? uniqueId.replace(/:/g, "")}`;

  return (
    <ChartContext.Provider value={{ config }}>
      <div data-chart={chartId} className={cn("flex aspect-video justify-center text-xs", className)}>
        <ChartStyle id={chartId} config={config} />
        <RechartsPrimitive.ResponsiveContainer>{children}</RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
}

function ChartStyle({ id, config }: { id: string; config: ChartConfig }) {
  const colorConfig = Object.entries(config).filter(([, value]) => value.color);
  if (!colorConfig.length) {
    return null;
  }

  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `
[data-chart=${id}] {
${colorConfig.map(([key, value]) => `  --color-${key}: ${value.color};`).join("\n")}
}
`,
      }}
    />
  );
}

export const ChartTooltip = RechartsPrimitive.Tooltip;

export function ChartTooltipContent({
  active,
  payload,
  label,
  className,
}: {
  active?: boolean;
  payload?: Array<{
    dataKey?: string | number;
    name?: string | number;
    value?: string | number;
    color?: string;
  }>;
  label?: string | number;
  className?: string;
}) {
  const { config } = useChart();

  if (!active || !payload?.length) {
    return null;
  }

  return (
    <div className={cn("rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs shadow-sm", className)}>
      {label ? <div className="mb-1 text-zinc-500">{label}</div> : null}
      <div className="space-y-1">
        {payload.map((item, index) => {
          const key = String(item.dataKey ?? item.name ?? index);
          const itemConfig = config[key];
          const itemLabel = itemConfig?.label ?? item.name ?? key;
          const itemColor = item.color ?? itemConfig?.color ?? "currentColor";
          const itemValue = `${item.value ?? "-"}`;

          return (
            <div key={key} className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: itemColor }} />
                <span className="text-zinc-600">{itemLabel}</span>
              </div>
              <span className="font-medium text-zinc-900">{itemValue}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const ChartLegend = RechartsPrimitive.Legend;

export function ChartLegendContent({
  payload,
}: {
  payload?: Array<{
    dataKey?: string | number;
    value?: string | number;
    color?: string;
  }>;
}) {
  const { config } = useChart();
  if (!payload?.length) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-4 text-xs text-zinc-600">
      {payload.map((item) => {
        const key = String(item.dataKey ?? item.value);
        const itemConfig = config[key];
        return (
          <div key={key} className="flex items-center gap-2">
            <span
              className="h-2 w-2 rounded-full"
              style={{
                backgroundColor: item.color ?? itemConfig?.color ?? "currentColor",
              }}
            />
            <span>{itemConfig?.label ?? item.value}</span>
          </div>
        );
      })}
    </div>
  );
}
