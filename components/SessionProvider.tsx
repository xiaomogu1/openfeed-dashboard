/**
 * SessionProvider — a server component inside a <Suspense> boundary.
 * Reads cookies() to determine the session state, then renders Dashboard.
 * Being inside Suspense means the cookies() call doesn't block prerendering.
 */

import { getSession } from "@/lib/session";
import Dashboard from "@/components/Dashboard";

export default async function SessionProvider() {
  const IS_MOCK = process.env.NEXT_PUBLIC_OPENFEED_MOCK === "true";

  let hasSession = IS_MOCK;
  if (!IS_MOCK) {
    try {
      const session = await getSession();
      hasSession = !!(session?.grantId);
    } catch {
      hasSession = false;
    }
  }

  return <Dashboard hasSession={hasSession} />;
}
