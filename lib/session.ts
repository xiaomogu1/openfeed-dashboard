/**
 * Session management — encrypted httpOnly cookies.
 * Two cookies:
 *   "of_session" — long-lived (7 days): accessToken, refreshToken, expiresAt, grantId
 *   "of_flow"    — short-lived (10 min): codeVerifier, state, nonce
 *
 * Both cookies are JWE-encrypted (dir / A256GCM) keyed on SESSION_SECRET.
 * Decrypt failure ⇒ treated as "no session" (returns null).
 *
 * Use this module in Server Components and Server Actions.
 * Route handlers should use lib/session-internal directly on NextResponse.cookies.
 */

import { cookies } from "next/headers";
import type { Session } from "./openfeed";
import {
  encrypt,
  decrypt,
  COOKIE_SESSION,
  COOKIE_FLOW,
  SESSION_MAX_AGE,
  FLOW_MAX_AGE,
  cookieOptions,
} from "./session-internal";

export type { Session };

export interface FlowState {
  codeVerifier: string;
  state: string;
  nonce: string;
}

// ─── Session cookie (long-lived) ──────────────────────────────────────────────

export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  const raw = jar.get(COOKIE_SESSION)?.value;
  if (!raw) return null;
  return decrypt<Session>(raw);
}

export async function setSession(session: Session): Promise<void> {
  const jar = await cookies();
  const encrypted = await encrypt(session as unknown as Record<string, unknown>);
  jar.set(COOKIE_SESSION, encrypted, cookieOptions(SESSION_MAX_AGE));
}

export async function clearSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE_SESSION);
}

// ─── Flow state cookie (short-lived) ─────────────────────────────────────────

export async function getFlowState(): Promise<FlowState | null> {
  const jar = await cookies();
  const raw = jar.get(COOKIE_FLOW)?.value;
  if (!raw) return null;
  return decrypt<FlowState>(raw);
}

export async function setFlowState(state: FlowState): Promise<void> {
  const jar = await cookies();
  const encrypted = await encrypt(state as unknown as Record<string, unknown>);
  jar.set(COOKIE_FLOW, encrypted, cookieOptions(FLOW_MAX_AGE));
}

export async function clearFlowState(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE_FLOW);
}
