/**
 * GET /api/energy
 * Returns aggregated energy dashboard data: accounts, meters, invoices,
 * and per-invoice meter usage (kWh). Works in both mock and live mode.
 *
 * Response: DashboardData from lib/aggregate.ts
 * Errors: 401, 402, 403 (grant_revoked), 503
 */

import { NextRequest, NextResponse } from "next/server";
import { decrypt, COOKIE_SESSION } from "@/lib/session-internal";
import type { Session } from "@/lib/openfeed";
import {
  fetchAllPages,
  type EnergyAccount,
  type EnergyMeter,
  type EnergyInvoice,
  type EnergyBillingTransaction,
  type EnergyMeterRead,
  type EnergyUsage,
} from "@/lib/openfeed";
import { buildDashboardData, type DashboardData } from "@/lib/aggregate";
import { mockData, type MockInvoicePeriod } from "@/lib/mock";

const IS_MOCK = process.env.NEXT_PUBLIC_OPENFEED_MOCK === "true";

// ─── Mock handler ─────────────────────────────────────────────────────────────

function buildMockResponse(): DashboardData {
  const accounts = [mockData.accounts.electricity, mockData.accounts.gas];

  // For mock, we use the pre-computed periods (no meter reads needed)
  const periodsMap = mockData.periods as Record<string, MockInvoicePeriod[]>;
  const periodsFlat = accounts.flatMap((account) => {
    const accountPeriods: MockInvoicePeriod[] = periodsMap[account.accountId] ?? [];
    return accountPeriods.map((p) => ({
      key: `${account.accountId}-${p.invoice.invoiceNumber}`,
      invoiceNumber: p.invoice.invoiceNumber ?? "",
      accountId: account.accountId,
      accountName: account.displayName ?? account.accountId,
      providerName: account.providerName,
      fuelType: account.accountId.includes("gas")
        ? ("gas" as const)
        : ("electricity" as const),
      issueDate: p.invoice.issueDate ?? "",
      dueDate: p.invoice.dueDate,
      periodLabel: formatPeriodLabel(p.invoice.issueDate ?? ""),
      invoiceAmount: p.invoice.invoiceAmount ?? 0,
      gstAmount: p.invoice.gstAmount ?? 0,
      netAmount: (p.invoice.invoiceAmount ?? 0) - (p.invoice.gstAmount ?? 0),
      paymentStatus: p.invoice.paymentStatus ?? "UNKNOWN",
      consumptionKwh:
        p.consumptionKwh > 0
          ? Math.round((p.consumptionKwh + p.clKwh) * 10) / 10
          : p.gasMj > 0
          ? null
          : null,
      exportKwh: p.exportKwh > 0 ? p.exportKwh : null,
      costPerKwh:
        p.consumptionKwh > 0
          ? Math.round(
              (((p.invoice.invoiceAmount ?? 0) - (p.invoice.gstAmount ?? 0)) /
                (p.consumptionKwh + p.clKwh)) *
                1000
            ) / 1000
          : null,
      periodDays: null as number | null, // computed below
    }));
  });

  // Sort by issue date
  periodsFlat.sort((a, b) => a.issueDate.localeCompare(b.issueDate));

  // Fill in periodDays (diff between consecutive invoices per account)
  const byAccount = new Map<string, typeof periodsFlat>();
  for (const p of periodsFlat) {
    if (!byAccount.has(p.accountId)) byAccount.set(p.accountId, []);
    byAccount.get(p.accountId)!.push(p);
  }
  for (const [, acctPeriods] of byAccount) {
    for (let i = 0; i < acctPeriods.length; i++) {
      if (i === 0) continue;
      const prev = acctPeriods[i - 1];
      const curr = acctPeriods[i];
      const ms =
        new Date(curr.issueDate + "T00:00:00Z").getTime() -
        new Date(prev.issueDate + "T00:00:00Z").getTime();
      curr.periodDays = Math.round(ms / (1000 * 60 * 60 * 24));
    }
  }

  return {
    accounts,
    periods: periodsFlat,
    lastUpdated: mockData.lastUpdated,
  };
}

function formatPeriodLabel(isoDate: string): string {
  if (!isoDate) return "";
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const d = new Date(isoDate + "T00:00:00Z");
  return `${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

// ─── Billing fallback ─────────────────────────────────────────────────────────

/**
 * When an account has no invoices, synthesize them from billing transactions:
 * group by invoiceNumber, sum amount+gst, use latest executionDateTime as issueDate.
 */
function synthesizeInvoicesFromBilling(
  transactions: EnergyBillingTransaction[]
): EnergyInvoice[] {
  const groups = new Map<string, EnergyBillingTransaction[]>();
  for (const tx of transactions) {
    const key = tx.invoiceNumber;
    if (!key) continue; // skip transactions with no invoice reference
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(tx);
  }

  const invoices: EnergyInvoice[] = [];
  for (const [invoiceNumber, txs] of groups) {
    const totalAmount = txs.reduce((s, t) => s + (t.amount ?? 0), 0);
    const totalGst = txs.reduce((s, t) => s + (t.gst ?? 0), 0);
    // Use the latest executionDateTime as the synthetic issue date
    const latestDateTime = txs
      .map((t) => t.executionDateTime ?? "")
      .filter(Boolean)
      .sort()
      .at(-1) ?? "";
    const issueDate = latestDateTime ? latestDateTime.slice(0, 10) : undefined;

    invoices.push({
      invoiceNumber,
      invoiceAmount: Math.round(totalAmount * 100) / 100,
      gstAmount: Math.round(totalGst * 100) / 100,
      issueDate,
      dueDate: undefined,
      paymentStatus: "UNKNOWN",
    });
  }

  return invoices;
}

// ─── Live handler ─────────────────────────────────────────────────────────────

async function buildLiveResponse(
  session: Session,
  signal: AbortSignal
): Promise<DashboardData> {
  // Fetch all energy accounts
  const accounts = await fetchAllPages<EnergyAccount>(
    "/v1/energy/accounts",
    session,
    signal
  );

  // For each account: fetch meters + invoices concurrently; fall back to billing if no invoices
  const accountData = await Promise.all(
    accounts.map(async (account) => {
      const [meters, invoicesRaw] = await Promise.all([
        fetchAllPages<EnergyMeter>(
          `/v1/energy/accounts/${account.accountId}/meters`,
          session,
          signal
        ),
        fetchAllPages<EnergyInvoice>(
          `/v1/energy/accounts/${account.accountId}/invoices`,
          session,
          signal
        ),
      ]);

      let invoices = invoicesRaw;
      if (invoices.length === 0) {
        // No invoices — try billing transactions and synthesize synthetic invoices
        try {
          const billing = await fetchAllPages<EnergyBillingTransaction>(
            `/v1/energy/accounts/${account.accountId}/billing`,
            session,
            signal
          );
          if (billing.length > 0) {
            invoices = synthesizeInvoicesFromBilling(billing);
          }
        } catch (err) {
          console.warn(
            `Billing fallback failed for account ${account.accountId}:`,
            err
          );
        }
      }

      return { account, meters, invoices };
    })
  );

  // Fetch meter usage in ≤30-day windows for each meter + invoice period
  const meterReadsByAccount: Record<string, EnergyMeterRead[]> = {};

  for (const { account, meters, invoices } of accountData) {
    const allReads: EnergyMeterRead[] = [];

    for (const meter of meters) {
      // Determine date range from invoice history
      const sortedInvoices = invoices
        .filter((inv) => inv.issueDate)
        .sort((a, b) => (a.issueDate ?? "").localeCompare(b.issueDate ?? ""));

      if (sortedInvoices.length === 0) continue;

      const oldestDate = sortedInvoices[0].issueDate!;
      const newestDate =
        sortedInvoices[sortedInvoices.length - 1].issueDate!;

      // Break into ≤30-day windows (API limit)
      const windows = buildDateWindows(oldestDate, newestDate, 30);

      for (const { from, to } of windows) {
        if (signal.aborted) break;
        try {
          const usageItems = await fetchAllPages<EnergyUsage>(
            `/v1/energy/accounts/${account.accountId}/meters/${meter.meterId}/usage?oldestDate=${from}&newestDate=${to}`,
            session,
            signal
          );
          // EnergyUsage.reads contains the EnergyMeterRead[] per interval date
          for (const item of usageItems) {
            if (item.reads) allReads.push(...item.reads);
          }
        } catch (err) {
          // Non-fatal: if usage fails for a window, continue
          console.warn(`Usage fetch failed for meter ${meter.meterId} [${from}–${to}]:`, err);
        }
      }
    }

    meterReadsByAccount[account.accountId] = allReads;
  }

  const invoicesByAccount: Record<string, EnergyInvoice[]> = {};
  for (const { account, invoices } of accountData) {
    invoicesByAccount[account.accountId] = invoices;
  }

  return buildDashboardData({
    accounts,
    invoicesByAccount,
    meterReadsByAccount,
    lastUpdated: new Date().toISOString(),
  });
}

/** Build ≤maxDays windows between two ISO date strings */
function buildDateWindows(
  from: string,
  to: string,
  maxDays: number
): Array<{ from: string; to: string }> {
  const windows: Array<{ from: string; to: string }> = [];
  let current = new Date(from + "T00:00:00Z");
  const end = new Date(to + "T00:00:00Z");

  while (current <= end) {
    const windowEnd = new Date(current);
    windowEnd.setUTCDate(windowEnd.getUTCDate() + maxDays - 1);
    if (windowEnd > end) windowEnd.setTime(end.getTime());

    windows.push({
      from: current.toISOString().slice(0, 10),
      to: windowEnd.toISOString().slice(0, 10),
    });

    current = new Date(windowEnd);
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return windows;
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  // Mock mode: no session required
  if (IS_MOCK) {
    return NextResponse.json(buildMockResponse());
  }

  // Live mode: require authenticated session with active grant
  const sessionRaw = req.cookies.get(COOKIE_SESSION)?.value;
  const session = sessionRaw ? await decrypt<Session>(sessionRaw) : null;

  if (!session?.grantId) {
    return NextResponse.json(
      { error: "not_authenticated", message: "No active session or grant." },
      { status: 401 }
    );
  }

  const controller = new AbortController();

  try {
    const data = await buildLiveResponse(session, controller.signal);
    return NextResponse.json(data);
  } catch (err) {
    // If it's an API error, map to HTTP status
    const apiError = (err as { apiError?: string }).apiError;

    if (apiError === "grant_revoked") {
      // CDR: abort all in-flight (already done via signal on throw), clear grant state
      controller.abort();
      return NextResponse.json(
        { error: "grant_revoked", message: "Grant has been revoked. Please reconnect." },
        { status: 403 }
      );
    }

    if (apiError === "credit_exhausted") {
      return NextResponse.json(
        { error: "credit_exhausted", message: "Data access paused. Developer credit exhausted." },
        { status: 402 }
      );
    }

    if (apiError === "token_expired") {
      return NextResponse.json(
        { error: "token_expired", message: "Session expired. Please log in again." },
        { status: 401 }
      );
    }

    if (apiError === "rate_limited") {
      return NextResponse.json(
        { error: "rate_limited", message: "Rate limited. Please try again shortly." },
        { status: 429 }
      );
    }

    console.error("/api/energy error:", err);
    return NextResponse.json(
      { error: "server_error", message: "An unexpected error occurred." },
      { status: 500 }
    );
  }
}
