/**
 * GET /.well-known/jwks.json
 * Exposes the app's public signing key (app keypair only — NOT the DPoP key).
 * Optional endpoint — only needed for jwksUri-based auto-rotation registration.
 * For inline JWKS registration (recommended for local dev), this is not required.
 */

import { NextResponse } from "next/server";
import { createPrivateKey, createPublicKey } from "crypto";

let _jwks: unknown = null;

export async function GET() {
  if (_jwks) return NextResponse.json(_jwks);

  const pem = process.env.OPENFEED_APP_PRIVATE_KEY;
  if (!pem) {
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  }

  try {
    // Use Node.js native crypto to derive the public JWK without extractability restrictions
    const privKey = createPrivateKey(pem);
    const pubKey = createPublicKey(privKey);
    const jwk = pubKey.export({ format: "jwk" });

    _jwks = {
      keys: [{ ...jwk, alg: "PS256", use: "sig", kid: "app-key-1" }],
    };
    return NextResponse.json(_jwks, {
      headers: {
        "Cache-Control": "public, max-age=3600",
        "Content-Type": "application/json",
      },
    });
  } catch (err) {
    console.error("JWKS route error:", err);
    return NextResponse.json({ error: "Key export failed" }, { status: 500 });
  }
}
