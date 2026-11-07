"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import type { InvoicePeriodData } from "@/lib/aggregate";

interface Props {
  periods: InvoicePeriodData[];
}

export default function UsageChart({ periods }: Props) {
  const elec = periods.filter(
    (p) => p.fuelType === "electricity" && p.consumptionKwh !== null
  );

  const data = elec
    .sort((a, b) => a.issueDate.localeCompare(b.issueDate))
    .map((p) => ({
      label: p.periodLabel,
      date: p.issueDate,
      import: p.consumptionKwh ?? 0,
      export: p.exportKwh ? -p.exportKwh : 0,
      net: (p.consumptionKwh ?? 0) - (p.exportKwh ?? 0),
    }));

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-gray-400 text-sm">
        No electricity usage data available
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: "#94a3b8" }}
          interval="preserveStartEnd"
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 11, fill: "#94a3b8" }}
          tickFormatter={(v) => `${v} kWh`}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          contentStyle={{ backgroundColor: "#0f172a", border: "1px solid #1e293b", borderRadius: 8 }}
          labelStyle={{ color: "#e2e8f0", fontWeight: 600 }}
          formatter={(value, name) => {
            if (value == null) return ["—", String(name)];
            const abs = Math.abs(Number(value));
            if (name === "import") return [`${abs.toFixed(1)} kWh`, "Import (consumption)"];
            if (name === "export") return [`${abs.toFixed(1)} kWh`, "Solar export"];
            return [`${abs.toFixed(1)} kWh`, String(name)];
          }}
        />
        <Legend
          wrapperStyle={{ fontSize: 12, color: "#94a3b8" }}
          formatter={(v) =>
            v === "import" ? "Import (consumption)" : v === "export" ? "Solar export" : v
          }
        />
        <ReferenceLine y={0} stroke="#334155" />
        <Bar dataKey="import" name="import" fill="#38bdf8" radius={[3, 3, 0, 0]} />
        <Bar dataKey="export" name="export" fill="#fbbf24" radius={[0, 0, 3, 3]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
