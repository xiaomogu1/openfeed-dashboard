/**
 * openfeed Sharing API client
 * All logic runs server-side only. Never import this from a client component.
 */

import * as jose from "jose";
import { createHash } from "crypto";
import type { components } from "./openfeed-types";

// ─── Types ───────────────────────────────────────────────────────────────────

export type EnergyAccount = components["schemas"]["EnergyAccount"];
export type EnergyMeter = components["schemas"]["EnergyMeter"];
export type EnergyMeterRead = components["schemas"]["EnergyMeterRead"];
export type EnergyUsage = components["schemas"]["EnergyUsage"];
export type EnergyInvoice = components["schemas"]["EnergyInvoice"];
export type EnergyBillingTransaction =
  components["schemas"]["EnergyBillingTransaction"];

export interface Session {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Date.now() ms
  grantId: string | null;
}

export type ApiError =
  | "token_expired"
  | "credit_exhausted"
  | "grant_revoked"
  | "balance_unavailable"
  | "enforcement_failure"
  | "not_found"
  | "rate_limited";

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ApiError };

// ─── Discovery (memoised) ─────────────────────────────────────────────────────

interface DiscoveryDoc {
  issuer: string;
  pushed_authorization_request_endpoint: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  end_session_endpoint: string;
}

let _discovery: DiscoveryDoc | null = null;

export async function getDiscovery(): Promise<DiscoveryDoc> {
  if (_discovery) return _discovery;
  const res = await fetch(
    "https://auth.openfeed.au/.well-known/openid-configuration",
    { next: { revalidate: 3600 } }
  );
  if (!res.ok) throw new Error(`Discovery fetch failed: ${res.status}`);
  _discovery = (await res.json()) as DiscoveryDoc;
  return _discovery;
}

import type { KeyObject } from "crypto";

// ─── Key loading ──────────────────────────────────────────────────────────────

// jose v5 can return CryptoKey (Web Crypto) or KeyObject (Node). Use unknown.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyKey = KeyObject | CryptoKey | any;

let _appPrivateKey: AnyKey | null = null;
let _dpopPrivateKey: AnyKey | null = null;
let _dpopPublicKey: AnyKey | null = null;

async function getAppPrivateKey(): Promise<AnyKey> {
  if (_appPrivateKey) return _appPrivateKey;
  const pem = process.env.OPENFEED_APP_PRIVATE_KEY;
  if (!pem) throw new Error("OPENFEED_APP_PRIVATE_KEY not set");
  _appPrivateKey = await jose.importPKCS8(pem, "PS256");
  return _appPrivateKey;
}

async function getDpopKeys(): Promise<{
  privateKey: AnyKey;
  publicKey: AnyKey;
}> {
  if (_dpopPrivateKey && _dpopPublicKey)
    return { privateKey: _dpopPrivateKey, publicKey: _dpopPublicKey };
  const pem = process.env.OPENFEED_DPOP_PRIVATE_KEY;
  if (!pem) throw new Error("OPENFEED_DPOP_PRIVATE_KEY not set");
  const kp = await jose.importPKCS8(pem, "PS256", { extractable: true });
  _dpopPrivateKey = kp;
  // Derive public key from private
  const jwk = await jose.exportJWK(kp);
  // Remove private key components to get public key
  const { d, p, q, dp, dq, qi, ...pub } = jwk;
  void d; void p; void q; void dp; void dq; void qi;
  _dpopPublicKey = await jose.importJWK(pub, "PS256");
  return { privateKey: _dpopPrivateKey, publicKey: _dpopPublicKey };
}

// ─── client_assertion JWT ─────────────────────────────────────────────────────

export async function buildClientAssertion(): Promise<string> {
  const clientId = process.env.OPENFEED_CLIENT_ID;
  if (!clientId) throw new Error("OPENFEED_CLIENT_ID not set");
  const privateKey = await getAppPrivateKey();
  const now = Math.floor(Date.now() / 1000);
  return new jose.SignJWT({
    iss: clientId,
    sub: clientId,
    aud: "https://auth.openfeed.au", // issuer URL, NOT the endpoint URL
    jti: crypto.randomUUID(),        // fresh per call — never cache
    iat: now,
    exp: now + 60,
  })
    .setProtectedHeader({ alg: "PS256" })
    .sign(privateKey);
}

// ─── DPoP proof ───────────────────────────────────────────────────────────────

// Per-endpoint nonce cache (RFC 9449 §8)
const _dpopNonces = new Map<string, string>();

export async function buildDpopProof({
  htu: rawHtu,
  htm,
  ath,
  nonce,
}: {
  htu: string;
  htm: string;
  ath?: string;
  nonce?: string;
}): Promise<string> {
  const { privateKey, publicKey } = await getDpopKeys();
  const publicJwk = await jose.exportJWK(publicKey);

  // htu: strip query string and fragment; keep raw = (never percent-encode)
  const htu = rawHtu.split("?")[0].split("#")[0];

  const payload: Record<string, unknown> = {
    htu,
    htm,
    iat: Math.floor(Date.now() / 1000),
    jti: crypto.randomUUID(),
  };
  if (ath) payload.ath = ath;
  const cachedNonce = _dpopNonces.get(htu) ?? nonce;
  if (cachedNonce) payload.nonce = cachedNonce;

  return new jose.SignJWT(payload)
    .setProtectedHeader({ alg: "PS256", typ: "dpop+jwt", jwk: publicJwk })
    .sign(privateKey);
}

// ─── Token refresh ────────────────────────────────────────────────────────────

export async function refreshSession(session: Session): Promise<Session> {
  const discovery = await getDiscovery();
  const dpopProof = await buildDpopProof({
    htu: discovery.token_endpoint,
    htm: "POST",
  });

  const body = new URLSearchParams({
    client_assertion_type:
      "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    client_assertion: await buildClientAssertion(),
    grant_type: "refresh_token",
    refresh_token: session.refreshToken,
    resource: "https://api.openfeed.au",
  });

  const res = await fetch(discovery.token_endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      DPoP: dpopProof,
    },
    body,
  });

  // Handle use_dpop_nonce retry (RFC 9449 §8)
  if (res.status === 400) {
    const errBody = await res.json().catch(() => ({}));
    const nonce = res.headers.get("DPoP-Nonce");
    if (errBody.error === "use_dpop_nonce" && nonce) {
      _dpopNonces.set(discovery.token_endpoint, nonce);
      const retryProof = await buildDpopProof({
        htu: discovery.token_endpoint,
        htm: "POST",
        nonce,
      });
      const retryRes = await fetch(discovery.token_endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          DPoP: retryProof,
        },
        body,
      });
      if (!retryRes.ok) throw new Error(`Token refresh failed: ${retryRes.status}`);
      const tokenData = await retryRes.json();
      return buildSessionFromTokenResponse(tokenData, session);
    }
  }

  if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`);
  const tokenData = await res.json();
  return buildSessionFromTokenResponse(tokenData, session);
}

function buildSessionFromTokenResponse(
  tokenData: {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    authorization_details?: Array<{ grant_id?: string }>;
  },
  previousSession: Session
): Session {
  const grantId =
    tokenData.authorization_details?.[0]?.grant_id ?? previousSession.grantId;
  return {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token ?? previousSession.refreshToken,
    expiresAt: Date.now() + (tokenData.expires_in ?? 3600) * 1000,
    grantId,
  };
}

// ─── DPoP-bound API call ──────────────────────────────────────────────────────

const API_BASE = "https://api.openfeed.au";

type SharingApiResult<T> = { data: T; meta?: unknown; links?: { next?: string } };

export async function callSharingApi<T>(
  path: string,
  session: Session,
  signal?: AbortSignal
): Promise<ApiResult<SharingApiResult<T>>> {
  // Auto-refresh if token expires within 60s
  let s = session;
  if (Date.now() >= s.expiresAt - 60_000) {
    s = await refreshSession(s);
  }

  const url = `${API_BASE}${path}`;
  // htu: strip query+fragment; keep raw = (never %3D)
  const htu = url.split("?")[0].split("#")[0];

  const ath = createHash("sha256")
    .update(s.accessToken)
    .digest("base64url");

  const dpopProof = await buildDpopProof({ htu, htm: "GET", ath });

  const doFetch = async (proof: string) =>
    fetch(url, {
      headers: {
        Authorization: `DPoP ${s.accessToken}`,
        DPoP: proof,
      },
      signal,
    });

  let res = await doFetch(dpopProof);

  // Handle use_dpop_nonce retry
  if (res.status === 400) {
    const errBody = await res.json().catch(() => ({}));
    const nonce = res.headers.get("DPoP-Nonce");
    if (errBody.error === "use_dpop_nonce" && nonce) {
      _dpopNonces.set(htu, nonce);
      const retryProof = await buildDpopProof({ htu, htm: "GET", ath, nonce });
      res = await doFetch(retryProof);
    }
  }

  if (res.ok) {
    const json = (await res.json()) as { version: string; data: T; meta?: unknown; links?: { next?: string } };
    return { ok: true, data: { data: json.data, meta: json.meta, links: json.links } };
  }

  if (res.status === 401) return { ok: false, error: "token_expired" };
  if (res.status === 402) return { ok: false, error: "credit_exhausted" };
  if (res.status === 404) return { ok: false, error: "not_found" };
  if (res.status === 429) return { ok: false, error: "rate_limited" };

  if (res.status === 403) {
    let body: { code?: string } = {};
    try { body = await res.json(); } catch { /* empty body */ }
    if (body.code === "disclosure_grant_required") return { ok: false, error: "grant_revoked" };
    if (body.code === "balance_unavailable") return { ok: false, error: "balance_unavailable" };
    // Empty body = transient enforcement failure
    return { ok: false, error: "enforcement_failure" };
  }

  return { ok: false, error: "enforcement_failure" };
}

// ─── Paginated fetch (follows links.next until absent) ────────────────────────

export async function fetchAllPages<T>(
  path: string,
  session: Session,
  signal?: AbortSignal
): Promise<T[]> {
  const all: T[] = [];
  let nextPath: string | undefined = path;

  while (nextPath) {
    const result: ApiResult<SharingApiResult<T[]>> = await callSharingApi<T[]>(nextPath, session, signal);
    if (!result.ok) {
      if (result.error === "not_found") break;
      throw Object.assign(new Error(result.error), { apiError: result.error });
    }
    const items = result.data.data;
    if (Array.isArray(items)) all.push(...items);

    const nextUrl: string | undefined = result.data.links?.next;
    if (!nextUrl) break;
    // Extract path+query from next URL (strip base)
    try {
      const parsed: URL = new URL(nextUrl);
      nextPath = parsed.pathname + parsed.search;
    } catch {
      break;
    }
  }

  return all;
}
