"use client";

/**
 * Static loading skeleton — used as the Suspense fallback.
 * Must not use any dynamic hooks (useSearchParams, cookies, etc.)
 */
export default function DashboardSkeleton() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900/80 sticky top-0 z-10 h-14" />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8 flex flex-col gap-8 animate-pulse">
        <div className="h-24 bg-slate-800/60 rounded-xl" />
        <div className="h-80 bg-slate-800/60 rounded-xl" />
        <div className="h-60 bg-slate-800/60 rounded-xl" />
        <div className="h-48 bg-slate-800/60 rounded-xl" />
      </main>
    </div>
  );
}
