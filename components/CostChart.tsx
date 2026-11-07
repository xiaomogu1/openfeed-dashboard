"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  Line,
  ComposedChart,
  ResponsiveContainer,
  Cell,
} from "recharts";
import type { InvoicePeriodData } from "@/lib/aggregate";

const STATUS_COLORS: Record<string, string> = {
  PAID: "#22c55e",
  DUE: "#f59e0b",
  OVERDUE: "#ef4444",
  PARTIALLY_PAID: "#3b82f6",
  UNKNOWN: "#94a3b8",
};

function fmt(n: number) {
  return n.toLocaleString("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 });
}

interface Props {
  periods: InvoicePeriodData[];
  accountFilter?: string | null;
}

export default function CostChart({ periods, accountFilter }: Props) {
  const filtered = accountFilter
    ? periods.filter((p) => p.accountId === accountFilter)
    : periods;

  // Aggregate by period label (if multiple accounts, sum them)
  const byLabel = new Map<string, { label: string; date: string; total: number; gst: number; net: number; status: string }>();
  for (const p of filtered) {
    const key = `${p.issueDate}-${p.accountId}`;
    byLabel.set(key, {
      label: p.periodLabel,
      date: p.issueDate,
      total: p.invoiceAmount,
      gst: p.gstAmount,
      net: p.netAmount,
      status: p.paymentStatus,
    });
  }

  const data = Array.from(byLabel.values()).sort((a, b) =>
    a.date.localeCompare(b.date)
  );

  // Cumulative spend
  let cumulative = 0;
  const withCumulative = data.map((d) => {
    cumulative += d.total;
    return { ...d, cumulative };
  });

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-gray-400 text-sm">
        No invoice data available
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={withCumulative} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: "#94a3b8" }}
          interval="preserveStartEnd"
          tickLine={false}
        />
        <YAxis
          yAxisId="bar"
          tick={{ fontSize: 11, fill: "#94a3b8" }}
          tickFormatter={(v) => `$${v}`}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          yAxisId="line"
          orientation="right"
          tick={{ fontSize: 11, fill: "#64748b" }}
          tickFormatter={(v) => `$${(v / 1000).toFixed(1)}k`}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          contentStyle={{ backgroundColor: "#0f172a", border: "1px solid #1e293b", borderRadius: 8 }}
          labelStyle={{ color: "#e2e8f0", fontWeight: 600 }}
          formatter={(value, name) => {
            if (value == null) return ["—", String(name)];
            const n = Number(value);
            if (name === "cumulative") return [fmt(n), "Cumulative spend"];
            if (name === "net") return [fmt(n), "Net (excl. GST)"];
            if (name === "gst") return [fmt(n), "GST"];
            return [fmt(n), String(name)];
          }}
        />
        <Legend
          wrapperStyle={{ fontSize: 12, color: "#94a3b8" }}
          formatter={(v) =>
            v === "net" ? "Net (excl. GST)" : v === "gst" ? "GST" : "Cumulative spend"
          }
        />
        <Bar dataKey="net" stackId="cost" yAxisId="bar" name="net" radius={[0, 0, 0, 0]}>
          {withCumulative.map((entry) => (
            <Cell key={entry.date + "-net"} fill={STATUS_COLORS[entry.status] ?? STATUS_COLORS.UNKNOWN} fillOpacity={0.85} />
          ))}
        </Bar>
        <Bar dataKey="gst" stackId="cost" yAxisId="bar" name="gst" fill="#334155" radius={[3, 3, 0, 0]} />
        <Line
          dataKey="cumulative"
          yAxisId="line"
          type="monotone"
          stroke="#818cf8"
          strokeWidth={2}
          dot={false}
          name="cumulative"
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
