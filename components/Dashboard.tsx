"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import type { DashboardData, InvoicePeriodData } from "@/lib/aggregate";
import { computeSummary } from "@/lib/aggregate";
import CostChart from "@/components/CostChart";
import UsageChart from "@/components/UsageChart";
import CostPerKwhChart from "@/components/CostPerKwhChart";
import SummaryCards from "@/components/SummaryCards";

const IS_MOCK = process.env.NEXT_PUBLIC_OPENFEED_MOCK === "true";

type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; data: DashboardData }
  | { status: "error"; code: string; message: string }
  | { status: "unauthenticated" };

function AccountTab({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
        active
          ? "bg-indigo-600 text-white"
          : "text-slate-400 hover:text-white hover:bg-slate-700"
      }`}
    >
      {label}
    </button>
  );
}

function ErrorBanner({
  code,
  message,
}: {
  code: string;
  message: string;
}) {
  const isGrant = code === "grant_revoked";
  const isCredit = code === "credit_exhausted";

  return (
    <div
      className={`rounded-xl p-4 border text-sm ${
        isGrant || isCredit
          ? "bg-red-900/40 border-red-700 text-red-300"
          : "bg-amber-900/40 border-amber-700 text-amber-300"
      }`}
    >
      <div className="font-semibold mb-1">
        {isGrant
          ? "Data access revoked"
          : isCredit
          ? "Data access paused"
          : "Error loading data"}
      </div>
      <div>{message}</div>
      {isGrant && (
        <a
          href="/auth/start"
          className="mt-2 inline-block underline text-red-200 hover:text-white"
        >
          Reconnect your energy account
        </a>
      )}
    </div>
  );
}

export default function Dashboard({
  hasSession,
}: {
  hasSession: boolean;
}) {
  return (
    <Suspense fallback={<DashboardInner hasSession={hasSession} urlError={undefined} />}>
      <DashboardWithParams hasSession={hasSession} />
    </Suspense>
  );
}

function DashboardWithParams({ hasSession }: { hasSession: boolean }) {
  const searchParams = useSearchParams();
  const urlError = searchParams.get("error") ?? undefined;
  return <DashboardInner hasSession={hasSession} urlError={urlError} />;
}

function DashboardInner({
  hasSession,
  urlError,
}: {
  hasSession: boolean;
  urlError?: string;
}) {
  const [state, setState] = useState<LoadState>(
    hasSession ? { status: "loading" } : { status: "unauthenticated" }
  );
  const [activeAccount, setActiveAccount] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const res = await fetch("/api/energy");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (res.status === 401 || body.error === "not_authenticated") {
          setState({ status: "unauthenticated" });
          return;
        }
        setState({
          status: "error",
          code: body.error ?? "server_error",
          message: body.message ?? "An error occurred loading energy data.",
        });
        return;
      }
      const data = (await res.json()) as DashboardData;
      setState({ status: "loaded", data });
      setActiveAccount(null);
    } catch {
      setState({
        status: "error",
        code: "network_error",
        message: "Could not reach the server. Check your connection.",
      });
    }
  }, []);

  useEffect(() => {
    if (hasSession) load();
  }, [hasSession, load]);

  const periods: InvoicePeriodData[] =
    state.status === "loaded" ? state.data.periods : [];

  const accounts =
    state.status === "loaded" ? state.data.accounts : [];

  const filteredPeriods = activeAccount
    ? periods.filter((p) => p.accountId === activeAccount)
    : periods;

  const stats = computeSummary(filteredPeriods);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center text-xs font-bold">
              E
            </div>
            <span className="font-semibold text-sm">Energy Dashboard</span>
            {IS_MOCK && (
              <span className="text-xs bg-amber-700/40 text-amber-300 border border-amber-600/40 px-2 py-0.5 rounded-full">
                Mock data
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {(hasSession || IS_MOCK) ? (
              !IS_MOCK && (
                <a
                  href="/auth/logout"
                  className="text-xs text-slate-400 hover:text-white transition-colors"
                >
                  Disconnect
                </a>
              )
            ) : (
              <a
                href="/auth/start"
                className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-lg transition-colors font-medium"
              >
                Connect with openfeed
              </a>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8 flex flex-col gap-8">
        {/* URL error (from auth redirects) */}
        {urlError && (
          <ErrorBanner
            code={urlError}
            message={decodeURIComponent(urlError).replace(/_/g, " ")}
          />
        )}

        {/* Unauthenticated state */}
        {state.status === "unauthenticated" && !IS_MOCK && (
          <div className="flex flex-col items-center justify-center gap-6 py-20 text-center">
            <div className="w-16 h-16 rounded-2xl bg-indigo-900/50 border border-indigo-700/50 flex items-center justify-center text-3xl">
              ⚡
            </div>
            <div>
              <h1 className="text-2xl font-bold mb-2">Household Energy Dashboard</h1>
              <p className="text-slate-400 max-w-md">
                Connect your energy account via openfeed to see historical cost
                and usage graphs from all your invoices.
              </p>
            </div>
            <a
              href="/auth/start"
              className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-3 rounded-xl font-semibold transition-colors"
            >
              Connect with openfeed
            </a>
            <p className="text-xs text-slate-500">
              Your data is fetched directly from your energy retailer via Australia&apos;s Consumer Data Right.
            </p>
          </div>
        )}

        {/* Loading state */}
        {state.status === "loading" && (
          <div className="flex flex-col gap-6 animate-pulse">
            <div className="h-24 bg-slate-800/60 rounded-xl" />
            <div className="h-80 bg-slate-800/60 rounded-xl" />
            <div className="h-60 bg-slate-800/60 rounded-xl" />
          </div>
        )}

        {/* Error state */}
        {state.status === "error" && (
          <div className="flex flex-col gap-4">
            <ErrorBanner code={state.code} message={state.message} />
            {state.code !== "grant_revoked" && (
              <button
                onClick={load}
                className="self-start text-sm text-indigo-400 hover:text-indigo-300 underline"
              >
                Try again
              </button>
            )}
          </div>
        )}

        {/* Data loaded (or mock) */}
        {(state.status === "loaded" || IS_MOCK) && (
          <>
            {/* Account tabs */}
            {accounts.length > 1 && (
              <div className="flex items-center gap-2 flex-wrap">
                <AccountTab
                  label="All accounts"
                  active={activeAccount === null}
                  onClick={() => setActiveAccount(null)}
                />
                {accounts.map((a) => (
                  <AccountTab
                    key={a.accountId}
                    label={`${a.displayName ?? a.accountId} (${a.providerName})`}
                    active={activeAccount === a.accountId}
                    onClick={() => setActiveAccount(a.accountId)}
                  />
                ))}
              </div>
            )}

            {/* Summary cards */}
            <SummaryCards
              stats={stats}
              lastUpdated={
                state.status === "loaded"
                  ? state.data.lastUpdated
                  : new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
              }
            />

            {/* Cost chart */}
            <section className="bg-slate-900 rounded-2xl border border-slate-800 p-6">
              <h2 className="text-base font-semibold mb-1">
                Cost per invoice
              </h2>
              <p className="text-xs text-slate-500 mb-5">
                Bars show net cost (excl. GST) by payment status — green = paid, amber = due, red = overdue.
                Right axis tracks cumulative spend.
              </p>
              <CostChart
                periods={filteredPeriods}
                accountFilter={activeAccount}
              />
            </section>

            {/* Usage chart */}
            <section className="bg-slate-900 rounded-2xl border border-slate-800 p-6">
              <h2 className="text-base font-semibold mb-1">
                Electricity usage per billing period
              </h2>
              <p className="text-xs text-slate-500 mb-5">
                Blue = imported from grid (consumption). Amber = solar exported back to grid.
              </p>
              <UsageChart periods={filteredPeriods} />
            </section>

            {/* Cost/kWh chart */}
            <section className="bg-slate-900 rounded-2xl border border-slate-800 p-6">
              <h2 className="text-base font-semibold mb-1">
                Effective electricity rate (¢/kWh)
              </h2>
              <p className="text-xs text-slate-500 mb-5">
                Net cost (excl. GST) divided by total imported kWh. Shows rate changes over time.
              </p>
              <CostPerKwhChart periods={filteredPeriods} />
            </section>

            {/* Invoice table */}
            <section className="bg-slate-900 rounded-2xl border border-slate-800 p-6">
              <h2 className="text-base font-semibold mb-4">All invoices</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-500 border-b border-slate-800">
                      <th className="pb-2 pr-4 font-medium">Period</th>
                      <th className="pb-2 pr-4 font-medium">Account</th>
                      <th className="pb-2 pr-4 font-medium text-right">Total (incl. GST)</th>
                      <th className="pb-2 pr-4 font-medium text-right hidden sm:table-cell">Usage</th>
                      <th className="pb-2 pr-4 font-medium text-right hidden sm:table-cell">Rate</th>
                      <th className="pb-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...filteredPeriods]
                      .sort((a, b) => b.issueDate.localeCompare(a.issueDate))
                      .map((p) => (
                        <tr
                          key={p.key}
                          className="border-b border-slate-800/60 hover:bg-slate-800/30 transition-colors"
                        >
                          <td className="py-2.5 pr-4 text-slate-300">
                            {p.periodLabel}
                          </td>
                          <td className="py-2.5 pr-4 text-slate-400 text-xs">
                            <div>{p.accountName}</div>
                            <div className="text-slate-600">{p.providerName}</div>
                          </td>
                          <td className="py-2.5 pr-4 text-right font-medium">
                            {p.invoiceAmount.toLocaleString("en-AU", {
                              style: "currency",
                              currency: "AUD",
                            })}
                          </td>
                          <td className="py-2.5 pr-4 text-right text-slate-400 hidden sm:table-cell">
                            {p.consumptionKwh !== null
                              ? `${p.consumptionKwh.toFixed(0)} kWh`
                              : "—"}
                          </td>
                          <td className="py-2.5 pr-4 text-right text-slate-400 hidden sm:table-cell">
                            {p.costPerKwh !== null
                              ? `${Math.round(p.costPerKwh * 100 * 10) / 10}¢`
                              : "—"}
                          </td>
                          <td className="py-2.5">
                            <StatusBadge status={p.paymentStatus} />
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    PAID: "bg-green-900/50 text-green-400 border-green-700/50",
    DUE: "bg-amber-900/50 text-amber-400 border-amber-700/50",
    OVERDUE: "bg-red-900/50 text-red-400 border-red-700/50",
    PARTIALLY_PAID: "bg-blue-900/50 text-blue-400 border-blue-700/50",
    UNKNOWN: "bg-slate-700/50 text-slate-400 border-slate-600/50",
  };
  return (
    <span
      className={`inline-block text-xs px-2 py-0.5 rounded-full border font-medium ${
        map[status] ?? map.UNKNOWN
      }`}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}
