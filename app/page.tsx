import { Suspense } from "react";
import SessionProvider from "@/components/SessionProvider";
import DashboardSkeleton from "@/components/DashboardSkeleton";

export default function Page() {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <SessionProvider />
    </Suspense>
  );
}
