/**
 * GET /auth/consent-return
 * Receives the grantId from the openfeed consent deep-link.
 * Refreshes the token (which now carries the grant_id), validates the match,
 * and stores the bound session.
 */

import { NextRequest, NextResponse } from "next/server";
import { refreshSession } from "@/lib/openfeed";
import {
  decrypt,
  encrypt,
  COOKIE_SESSION,
  SESSION_MAX_AGE,
  cookieOptions,
} from "@/lib/session-internal";
import type { Session } from "@/lib/openfeed";

export async function GET(req: NextRequest) {
  const appPublicUrl = process.env.APP_PUBLIC_URL ?? "http://localhost:3000";

  try {
    const { searchParams } = req.nextUrl;
    const consented = searchParams.get("consented");
    const returnedGrantId = searchParams.get("grantId");

    if (consented !== "true") {
      const reason = searchParams.get("reason") ?? "consent_declined";
      return NextResponse.redirect(
        `${appPublicUrl}/?error=${encodeURIComponent(reason)}`
      );
    }

    // Read existing session (has refresh_token from the callback)
    const sessionRaw = req.cookies.get(COOKIE_SESSION)?.value;
    const session = sessionRaw ? await decrypt<Session>(sessionRaw) : null;

    if (!session?.refreshToken) {
      return NextResponse.redirect(`${appPublicUrl}/?error=no_session_for_consent`);
    }

    // Refresh the token — the new token will carry the grant_id automatically
    const newSession = await refreshSession(session);

    if (!newSession.grantId) {
      return NextResponse.redirect(`${appPublicUrl}/?error=grant_not_bound`);
    }

    // Verify grantId matches what the consent deep-link returned
    if (returnedGrantId && newSession.grantId !== returnedGrantId) {
      return NextResponse.redirect(`${appPublicUrl}/?error=grant_id_mismatch`);
    }

    const sessionValue = await encrypt(
      newSession as unknown as Record<string, unknown>
    );

    const redirect = NextResponse.redirect(`${appPublicUrl}/`);
    redirect.cookies.set(COOKIE_SESSION, sessionValue, cookieOptions(SESSION_MAX_AGE));
    return redirect;
  } catch (err) {
    console.error("/auth/consent-return error:", err);
    return NextResponse.redirect(`${appPublicUrl}/?error=consent_return_failed`);
  }
}


