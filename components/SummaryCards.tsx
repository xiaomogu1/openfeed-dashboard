"use client";

import type { SummaryStats } from "@/lib/aggregate";

interface Props {
  stats: SummaryStats;
  lastUpdated: string;
}

function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="bg-slate-800 rounded-xl p-5 border border-slate-700 flex flex-col gap-1">
      <span className="text-xs text-slate-400 uppercase tracking-wide">{label}</span>
      <span className={`text-2xl font-bold ${accent ?? "text-white"}`}>{value}</span>
      {sub && <span className="text-xs text-slate-500">{sub}</span>}
    </div>
  );
}

export default function SummaryCards({ stats, lastUpdated }: Props) {
  const updatedDate = new Date(lastUpdated);
  const hoursAgo = Math.round((Date.now() - updatedDate.getTime()) / (1000 * 60 * 60));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          label="Total spend"
          value={stats.totalSpend.toLocaleString("en-AU", {
            style: "currency",
            currency: "AUD",
            maximumFractionDigits: 0,
          })}
          sub={`${stats.invoiceCount} invoices`}
        />
        {stats.totalKwh !== null && (
          <StatCard
            label="Total imported"
            value={`${stats.totalKwh.toLocaleString("en-AU", { maximumFractionDigits: 0 })} kWh`}
            sub="electricity import"
            accent="text-sky-400"
          />
        )}
        {stats.totalExportKwh !== null && stats.totalExportKwh > 0 && (
          <StatCard
            label="Solar exported"
            value={`${stats.totalExportKwh.toLocaleString("en-AU", { maximumFractionDigits: 0 })} kWh`}
            sub="back to grid"
            accent="text-amber-400"
          />
        )}
        {stats.avgCostPerKwh !== null && (
          <StatCard
            label="Avg rate"
            value={`${Math.round(stats.avgCostPerKwh * 100 * 10) / 10}¢/kWh`}
            sub="electricity (net excl. GST)"
            accent="text-violet-400"
          />
        )}
      </div>

      {stats.overdueCount > 0 && (
        <div className="rounded-lg bg-red-900/40 border border-red-700/60 px-4 py-2 text-sm text-red-300 flex items-center gap-2">
          <span className="font-semibold">
            {stats.overdueCount} overdue invoice{stats.overdueCount > 1 ? "s" : ""}
          </span>
          — please check your energy account.
        </div>
      )}

      <div className="text-xs text-slate-500 text-right">
        Energy data last refreshed ~{hoursAgo}h ago (batch, every 6h)
      </div>
    </div>
  );
}
