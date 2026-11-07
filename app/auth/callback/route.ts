/**
 * GET /auth/callback
 * Receives the authorization code from openfeed, validates state + iss,
 * exchanges for tokens (DPoP-bound), stores session, and either:
 *   - redirects to / if grant is present
 *   - redirects to consent deep-link if no grant yet
 */

import { NextRequest, NextResponse } from "next/server";
import { getDiscovery, buildClientAssertion, buildDpopProof } from "@/lib/openfeed";
import {
  decrypt,
  encrypt,
  COOKIE_FLOW,
  COOKIE_SESSION,
  SESSION_MAX_AGE,
  FLOW_MAX_AGE,
  cookieOptions,
} from "@/lib/session-internal";
import type { FlowState } from "@/lib/session";

interface TokenResponse {
  access_token: string;
  token_type: string;
  refresh_token?: string;
  expires_in?: number;
  id_token?: string;
  authorization_details?: Array<{ grant_id?: string }>;
}

export async function GET(req: NextRequest) {
  const appPublicUrl = process.env.APP_PUBLIC_URL ?? "http://localhost:3000";
  const appId = process.env.OPENFEED_APP_ID;
  const clientId = process.env.OPENFEED_CLIENT_ID;

  try {
    const { searchParams } = req.nextUrl;
    const code = searchParams.get("code");
    const returnedState = searchParams.get("state");
    const returnedIss = searchParams.get("iss");
    const errorParam = searchParams.get("error");

    if (errorParam) {
      return NextResponse.redirect(
        `${appPublicUrl}/?error=${encodeURIComponent(errorParam)}`
      );
    }

    if (!code) {
      return NextResponse.redirect(`${appPublicUrl}/?error=missing_code`);
    }

    // Read and immediately clear the flow cookie (single-use)
    const flowRaw = req.cookies.get(COOKIE_FLOW)?.value;
    const flow = flowRaw ? await decrypt<FlowState>(flowRaw) : null;

    if (!flow) {
      return NextResponse.redirect(`${appPublicUrl}/?error=flow_state_missing`);
    }

    // Validate state (CSRF) — must check before doing anything with the code
    if (returnedState !== flow.state) {
      return NextResponse.redirect(`${appPublicUrl}/?error=state_mismatch`);
    }

    // Validate iss (RFC 9207 mix-up defence)
    if (returnedIss) {
      const discovery = await getDiscovery();
      if (returnedIss !== discovery.issuer) {
        return NextResponse.redirect(`${appPublicUrl}/?error=issuer_mismatch`);
      }
    }

    const discovery = await getDiscovery();

    // Build DPoP proof for token endpoint
    const dpopProof = await buildDpopProof({
      htu: discovery.token_endpoint,
      htm: "POST",
    });

    const tokenBody = new URLSearchParams({
      client_assertion_type:
        "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      client_assertion: await buildClientAssertion(),
      grant_type: "authorization_code",
      code,
      code_verifier: flow.codeVerifier,
      redirect_uri: `${appPublicUrl}/auth/callback`,
      resource: "https://api.openfeed.au", // REQUIRED
    });

    let tokenRes = await fetch(discovery.token_endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        DPoP: dpopProof,
      },
      body: tokenBody,
    });

    // Handle use_dpop_nonce retry (RFC 9449 §8)
    if (tokenRes.status === 400) {
      const errBody = await tokenRes.json().catch(() => ({}));
      const nonce = tokenRes.headers.get("DPoP-Nonce");
      if (errBody.error === "use_dpop_nonce" && nonce) {
        const retryProof = await buildDpopProof({
          htu: discovery.token_endpoint,
          htm: "POST",
          nonce,
        });
        tokenRes = await fetch(discovery.token_endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            DPoP: retryProof,
          },
          body: tokenBody,
        });
      }
    }

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      console.error("Token exchange failed:", tokenRes.status, err);
      const redirect = NextResponse.redirect(
        `${appPublicUrl}/?error=token_exchange_failed`
      );
      // Clear the flow cookie
      redirect.cookies.set(COOKIE_FLOW, "", { ...cookieOptions(FLOW_MAX_AGE), maxAge: 0 });
      return redirect;
    }

    const tokenData = (await tokenRes.json()) as TokenResponse;
    const grantId = tokenData.authorization_details?.[0]?.grant_id ?? null;

    const session = {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token ?? "",
      expiresAt: Date.now() + (tokenData.expires_in ?? 3600) * 1000,
      grantId,
    };

    const sessionValue = await encrypt(session as unknown as Record<string, unknown>);

    if (!grantId) {
      // No grant yet — redirect to consent deep-link; refresh_token stored in session
      if (!appId) {
        // Can't redirect to consent without appId
        const redirect = NextResponse.redirect(
          `${appPublicUrl}/?error=app_id_not_configured`
        );
        redirect.cookies.set(COOKIE_FLOW, "", { ...cookieOptions(0), maxAge: 0 });
        return redirect;
      }
      const consentUrl = `https://app.openfeed.au/grants/disclosure?appId=${appId}&redirectUri=${encodeURIComponent(`${appPublicUrl}/auth/consent-return`)}`;
      const redirect = NextResponse.redirect(consentUrl);
      redirect.cookies.set(COOKIE_SESSION, sessionValue, cookieOptions(SESSION_MAX_AGE));
      redirect.cookies.set(COOKIE_FLOW, "", { ...cookieOptions(FLOW_MAX_AGE), maxAge: 0 });
      return redirect;
    }

    // Grant present — store session and redirect to dashboard
    const redirect = NextResponse.redirect(`${appPublicUrl}/`);
    redirect.cookies.set(COOKIE_SESSION, sessionValue, cookieOptions(SESSION_MAX_AGE));
    redirect.cookies.set(COOKIE_FLOW, "", { ...cookieOptions(FLOW_MAX_AGE), maxAge: 0 });
    return redirect;
  } catch (err) {
    console.error("/auth/callback error:", err);
    const redirect = NextResponse.redirect(`${appPublicUrl}/?error=callback_failed`);
    redirect.cookies.set(COOKIE_FLOW, "", { ...cookieOptions(FLOW_MAX_AGE), maxAge: 0 });
    return redirect;
  }
}
