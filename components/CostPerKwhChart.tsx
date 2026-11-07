"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { InvoicePeriodData } from "@/lib/aggregate";

interface Props {
  periods: InvoicePeriodData[];
}

export default function CostPerKwhChart({ periods }: Props) {
  const data = periods
    .filter((p) => p.fuelType === "electricity" && p.costPerKwh !== null)
    .sort((a, b) => a.issueDate.localeCompare(b.issueDate))
    .map((p) => ({
      label: p.periodLabel,
      date: p.issueDate,
      centsPerKwh: Math.round((p.costPerKwh ?? 0) * 100 * 10) / 10,
    }));

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-gray-400 text-sm">
        No cost-per-kWh data available
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: "#94a3b8" }}
          interval="preserveStartEnd"
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 11, fill: "#94a3b8" }}
          tickFormatter={(v) => `${v}¢`}
          tickLine={false}
          axisLine={false}
          domain={["auto", "auto"]}
        />
        <Tooltip
          contentStyle={{ backgroundColor: "#0f172a", border: "1px solid #1e293b", borderRadius: 8 }}
          labelStyle={{ color: "#e2e8f0", fontWeight: 600 }}
          formatter={(v) => [`${v ?? "—"}¢/kWh`, "Effective rate"]}
        />
        <Line
          dataKey="centsPerKwh"
          type="monotone"
          stroke="#a78bfa"
          strokeWidth={2}
          dot={{ r: 3, fill: "#a78bfa" }}
          name="centsPerKwh"
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
