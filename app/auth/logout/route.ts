/**
 * GET /auth/logout
 * Clears the session cookie and redirects to the openfeed end_session_endpoint.
 */

import { NextRequest, NextResponse } from "next/server";
import { getDiscovery } from "@/lib/openfeed";
import {
  COOKIE_SESSION,
  COOKIE_FLOW,
  cookieOptions,
} from "@/lib/session-internal";

export async function GET(req: NextRequest) {
  const appPublicUrl = process.env.APP_PUBLIC_URL ?? "http://localhost:3000";

  const res = NextResponse.redirect(`${appPublicUrl}/`);
  // Clear both cookies
  res.cookies.set(COOKIE_SESSION, "", { ...cookieOptions(0), maxAge: 0 });
  res.cookies.set(COOKIE_FLOW, "", { ...cookieOptions(0), maxAge: 0 });

  // Best-effort redirect to openfeed end_session_endpoint
  try {
    if (process.env.OPENFEED_CLIENT_ID) {
      const discovery = await getDiscovery();
      const endSessionUrl = new URL(discovery.end_session_endpoint);
      endSessionUrl.searchParams.set(
        "post_logout_redirect_uri",
        `${appPublicUrl}/`
      );
      endSessionUrl.searchParams.set(
        "client_id",
        process.env.OPENFEED_CLIENT_ID
      );
      return NextResponse.redirect(endSessionUrl.toString());
    }
  } catch {
    // If discovery fails, just redirect home
  }

  return res;
}
