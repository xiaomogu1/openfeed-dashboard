/**
 * Internal session crypto helpers — encrypt/decrypt JWE.
 * Imported by session.ts and route handlers that set cookies on NextResponse.
 */

import * as jose from "jose";

let _sessionKey: Uint8Array | null = null;

export function getSessionKey(): Uint8Array {
  if (_sessionKey) return _sessionKey;
  const raw = process.env.SESSION_SECRET;
  if (!raw) throw new Error("SESSION_SECRET not set");
  _sessionKey = Buffer.from(raw, "base64url");
  if (_sessionKey.length < 32)
    throw new Error("SESSION_SECRET must be at least 32 bytes");
  return _sessionKey;
}

export async function encrypt(
  payload: Record<string, unknown>
): Promise<string> {
  const key = getSessionKey();
  return new jose.CompactEncrypt(
    new TextEncoder().encode(JSON.stringify(payload))
  )
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .encrypt(key);
}

export async function decrypt<T>(token: string): Promise<T | null> {
  try {
    const key = getSessionKey();
    const { plaintext } = await jose.compactDecrypt(token, key);
    return JSON.parse(new TextDecoder().decode(plaintext)) as T;
  } catch {
    return null;
  }
}

export const COOKIE_SESSION = "of_session";
export const COOKIE_FLOW = "of_flow";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days
export const FLOW_MAX_AGE = 60 * 10; // 10 minutes

export function cookieOptions(
  maxAge: number,
  isProd = process.env.NODE_ENV === "production"
) {
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}
