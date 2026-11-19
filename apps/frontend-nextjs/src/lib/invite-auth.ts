import "server-only";
import crypto from "node:crypto";

export interface InviteTokenClaims {
  sub: string;
  room: string;
  scope: string;
  jti: string;
  exp: number;
}

function getInviteSecret(): string {
  const configured = (
    process.env.INVITE_HMAC_SECRET ||
    process.env.SIGNALING_HMAC_SECRET ||
    ""
  ).trim();
  if (configured) return configured;
  if (process.env.NODE_ENV !== "production") {
    return "funfram-dev-only-secret-do-not-use-in-prod";
  }
  return "";
}

export function verifyInviteTokenServer(token: string): InviteTokenClaims | null {
  const secret = getInviteSecret();
  if (!secret || !token) {
    return null;
  }

  const parts = token.split(".");
  if (parts.length !== 2) {
    return null;
  }

  const [encodedPayload, encodedSig] = parts;
  const expectedSig = crypto
    .createHmac("sha256", secret)
    .update(encodedPayload)
    .digest("base64url");

  const sigBuf = Buffer.from(encodedSig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const claims = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8")
    ) as InviteTokenClaims;
    if (claims.scope !== "invite" || !claims.room) {
      return null;
    }
    if (typeof claims.exp !== "number" || Math.floor(Date.now() / 1000) > claims.exp) {
      return null;
    }
    return claims;
  } catch {
    return null;
  }
}
