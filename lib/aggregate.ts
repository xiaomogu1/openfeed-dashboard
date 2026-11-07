/**
 * Aggregation layer: joins invoices with meter usage reads to produce
 * chart-ready data series. Works for both mock and live data.
 */

import type { EnergyAccount, EnergyInvoice, EnergyMeterRead } from "./openfeed";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface InvoicePeriodData {
  /** Stable key for React */
  key: string;
  invoiceNumber: string;
  accountId: string;
  accountName: string;
  providerName: string;
  fuelType: "electricity" | "gas" | "unknown";
  /** ISO date */
  issueDate: string;
  /** ISO date */
  dueDate: string | undefined;
  /** Display label: "Nov 2026" */
  periodLabel: string;
  /** Total invoice amount (AUD inc GST) */
  invoiceAmount: number;
  /** GST component */
  gstAmount: number;
  /** Net amount excl. GST */
  netAmount: number;
  paymentStatus: string;
  /** Total consumption kWh (positive = import) */
  consumptionKwh: number | null;
  /** Solar export kWh (positive = export amount) */
  exportKwh: number | null;
  /** Derived $/kWh — null if usage unknown */
  costPerKwh: number | null;
  /** Billing period in days (inferred) */
  periodDays: number | null;
}

export interface DashboardData {
  accounts: EnergyAccount[];
  periods: InvoicePeriodData[];
  lastUpdated: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function periodLabel(isoDate: string): string {
  const d = new Date(isoDate + "T00:00:00Z");
  return `${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function inferFuelType(account: EnergyAccount): "electricity" | "gas" | "unknown" {
  const name = (account.displayName ?? "").toLowerCase();
  if (name.includes("gas")) return "gas";
  if (name.includes("electr") || name.includes("solar")) return "electricity";
  // Check plan fuel type
  for (const plan of account.plans ?? []) {
    const fuel = (plan.planDetail?.fuelType ?? "").toLowerCase();
    if (fuel === "gas") return "gas";
    if (fuel === "electricity") return "electricity";
  }
  return "unknown";
}

/** Sum kWh from a set of meter reads (positive = consumption, negative = export) */
export function sumMeterReadsKwh(reads: EnergyMeterRead[]): {
  consumptionKwh: number;
  exportKwh: number;
} {
  let consumption = 0;
  let export_ = 0;

  for (const read of reads) {
    if (read.readUType === "basicRead" && read.basicRead) {
      const v = read.basicRead.value ?? 0;
      if (v >= 0) consumption += v;
      else export_ += Math.abs(v);
    } else if (read.readUType === "intervalRead" && read.intervalRead) {
      const agg = read.intervalRead.aggregateValue ?? 0;
      if (agg >= 0) consumption += agg;
      else export_ += Math.abs(agg);
    }
  }

  return { consumptionKwh: consumption, exportKwh: export_ };
}

// ─── Main aggregation ─────────────────────────────────────────────────────────

export function buildDashboardData({
  accounts,
  invoicesByAccount,
  meterReadsByAccount,
  lastUpdated,
}: {
  accounts: EnergyAccount[];
  invoicesByAccount: Record<string, EnergyInvoice[]>;
  meterReadsByAccount: Record<string, EnergyMeterRead[]>;
  lastUpdated: string;
}): DashboardData {
  const periods: InvoicePeriodData[] = [];

  for (const account of accounts) {
    const invoices = (invoicesByAccount[account.accountId] ?? [])
      .slice() // don't mutate
      .sort((a, b) => (a.issueDate ?? "").localeCompare(b.issueDate ?? ""));

    const fuelType = inferFuelType(account);
    const reads = meterReadsByAccount[account.accountId] ?? [];

    for (let i = 0; i < invoices.length; i++) {
      const inv = invoices[i];
      const prevIssueDate = i > 0 ? invoices[i - 1].issueDate : null;
      const periodStart = prevIssueDate ?? null;
      const periodEnd = inv.issueDate ?? null;

      // Infer period length in days
      let periodDays: number | null = null;
      if (periodStart && periodEnd) {
        const ms =
          new Date(periodEnd + "T00:00:00Z").getTime() -
          new Date(periodStart + "T00:00:00Z").getTime();
        periodDays = Math.round(ms / (1000 * 60 * 60 * 24));
      }

      // Filter meter reads to this invoice's billing period
      const periodReads = reads.filter((r) => {
        const readDate = r.readStartDate;
        if (!readDate) return false;
        if (periodStart && readDate < periodStart) return false;
        if (periodEnd && readDate > periodEnd) return false;
        return true;
      });

      const { consumptionKwh, exportKwh } =
        periodReads.length > 0
          ? sumMeterReadsKwh(periodReads)
          : { consumptionKwh: 0, exportKwh: 0 };

      const invoiceAmount = inv.invoiceAmount ?? 0;
      const gstAmount = inv.gstAmount ?? 0;
      const netAmount = invoiceAmount - gstAmount;

      const costPerKwh =
        fuelType === "electricity" && consumptionKwh > 0
          ? netAmount / consumptionKwh
          : null;

      const issueDateStr = inv.issueDate ?? "";

      periods.push({
        key: `${account.accountId}-${inv.invoiceNumber ?? i}`,
        invoiceNumber: inv.invoiceNumber ?? `INV-${i}`,
        accountId: account.accountId,
        accountName: account.displayName ?? account.accountId,
        providerName: account.providerName,
        fuelType,
        issueDate: issueDateStr,
        dueDate: inv.dueDate,
        periodLabel: issueDateStr ? periodLabel(issueDateStr) : `Invoice ${i + 1}`,
        invoiceAmount,
        gstAmount,
        netAmount,
        paymentStatus: inv.paymentStatus ?? "UNKNOWN",
        consumptionKwh: consumptionKwh > 0 ? Math.round(consumptionKwh * 10) / 10 : null,
        exportKwh: exportKwh > 0 ? Math.round(exportKwh * 10) / 10 : null,
        costPerKwh: costPerKwh ? Math.round(costPerKwh * 1000) / 1000 : null,
        periodDays,
      });
    }
  }

  // Sort all periods by issue date ascending
  periods.sort((a, b) => a.issueDate.localeCompare(b.issueDate));

  return { accounts, periods, lastUpdated };
}

// ─── Summary stats ────────────────────────────────────────────────────────────

export interface SummaryStats {
  totalSpend: number;
  totalKwh: number | null;
  avgCostPerKwh: number | null;
  totalExportKwh: number | null;
  invoiceCount: number;
  paidCount: number;
  overdueCount: number;
}

export function computeSummary(periods: InvoicePeriodData[]): SummaryStats {
  const elecPeriods = periods.filter((p) => p.fuelType === "electricity");
  const totalSpend = periods.reduce((s, p) => s + p.invoiceAmount, 0);
  const totalKwh = elecPeriods.every((p) => p.consumptionKwh !== null)
    ? elecPeriods.reduce((s, p) => s + (p.consumptionKwh ?? 0), 0)
    : null;
  const totalExportKwh = elecPeriods.every((p) => p.exportKwh !== null)
    ? elecPeriods.reduce((s, p) => s + (p.exportKwh ?? 0), 0)
    : null;
  const avgCostPerKwh =
    totalKwh && totalKwh > 0
      ? elecPeriods.reduce((s, p) => s + p.netAmount, 0) / totalKwh
      : null;

  return {
    totalSpend: Math.round(totalSpend * 100) / 100,
    totalKwh: totalKwh ? Math.round(totalKwh * 10) / 10 : null,
    avgCostPerKwh: avgCostPerKwh ? Math.round(avgCostPerKwh * 1000) / 1000 : null,
    totalExportKwh: totalExportKwh ? Math.round(totalExportKwh * 10) / 10 : null,
    invoiceCount: periods.length,
    paidCount: periods.filter((p) => p.paymentStatus === "PAID").length,
    overdueCount: periods.filter((p) => p.paymentStatus === "OVERDUE").length,
  };
}
