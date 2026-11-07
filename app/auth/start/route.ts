/**
 * GET /auth/start
 * Builds a PAR request (FAPI 2.0 + PKCE-S256) and redirects the user
 * to the openfeed authorization endpoint.
 * Runs server-side only — no token material touches the browser.
 */

import { NextResponse } from "next/server";
import { getDiscovery, buildClientAssertion } from "@/lib/openfeed";
import {
  encrypt,
  COOKIE_FLOW,
  FLOW_MAX_AGE,
  cookieOptions,
} from "@/lib/session-internal";
import { createHash } from "crypto";

export async function GET() {
  const appPublicUrl = process.env.APP_PUBLIC_URL ?? "http://localhost:3000";

  try {
    const clientId = process.env.OPENFEED_CLIENT_ID;

    if (!clientId) {
      return NextResponse.json(
        {
          error:
            "OPENFEED_CLIENT_ID not configured. Complete app registration first (Phase 3).",
        },
        { status: 503 }
      );
    }

    const discovery = await getDiscovery();

    // PKCE-S256
    const codeVerifier = Buffer.from(
      crypto.getRandomValues(new Uint8Array(32))
    ).toString("base64url");
    const codeChallenge = createHash("sha256")
      .update(codeVerifier)
      .digest("base64url");

    const state = crypto.randomUUID();
    const nonce = crypto.randomUUID();

    const clientAssertion = await buildClientAssertion();

    // PAR POST — REQUIRED before redirect (plain redirect without PAR is rejected)
    const parBody = new URLSearchParams({
      client_assertion_type:
        "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      client_assertion: clientAssertion,
      response_type: "code",
      client_id: clientId,
      redirect_uri: `${appPublicUrl}/auth/callback`,
      scope: "openid openfeed-au:data:energy:read",
      resource: "https://api.openfeed.au", // REQUIRED — binds token to sharing-api audience
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      nonce,
      state,
      grant_management_action: "create",
    });

    const parRes = await fetch(
      discovery.pushed_authorization_request_endpoint,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: parBody,
      }
    );

    if (!parRes.ok) {
      const err = await parRes.text();
      console.error("PAR failed:", parRes.status, err);
      return NextResponse.redirect(`${appPublicUrl}/?error=par_failed`);
    }

    const parData = (await parRes.json()) as { request_uri: string };

    // Redirect to authorization endpoint — only client_id + request_uri
    const authUrl = `${discovery.authorization_endpoint}?client_id=${encodeURIComponent(clientId)}&request_uri=${encodeURIComponent(parData.request_uri)}`;
    const res = NextResponse.redirect(authUrl);

    // Store PKCE + flow state in short-lived cookie (single-use, cleared in callback)
    const flowValue = await encrypt({ codeVerifier, state, nonce });
    res.cookies.set(COOKIE_FLOW, flowValue, cookieOptions(FLOW_MAX_AGE));

    return res;
  } catch (err) {
    console.error("/auth/start error:", err);
    return NextResponse.redirect(`${appPublicUrl}/?error=auth_start_failed`);
  }
}
