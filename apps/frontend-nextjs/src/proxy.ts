import { NextRequest, NextResponse } from "next/server";

function buildConnectSrc(): string {
  const sources = new Set<string>([
    "'self'",
    "https://rtc.live.cloudflare.com",
    "wss:",
    "https:",
  ]);

  if (process.env.NODE_ENV !== "production") {
    sources.add("ws:");
    sources.add("http://localhost:*");
    sources.add("ws://localhost:*");
  }

  for (const raw of [
    process.env.NEXT_PUBLIC_WS_URL,
    process.env.NEXT_PUBLIC_WEBRTC_URL,
    process.env.NEXT_PUBLIC_SIGNALING_URL,
  ]) {
    if (!raw) continue;
    try {
      const parsed = new URL(raw);
      sources.add(parsed.origin);
    } catch {
      // Ignore malformed env URL at proxy layer
    }
  }

  return Array.from(sources).join(" ");
}

function buildCsp(): string {
  const isProd = process.env.NODE_ENV === "production";
  const scriptSrc = isProd
    ? "'self' 'unsafe-inline' 'wasm-unsafe-eval' https://static.cloudflareinsights.com"
    : "'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' https://static.cloudflareinsights.com";

  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "media-src 'self' blob:",
    `connect-src ${buildConnectSrc()}`,
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

export function proxy(_request: NextRequest) {
  const response = NextResponse.next();
  response.headers.set("Content-Security-Policy", buildCsp());
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Permissions-Policy",
    "camera=(self), microphone=(self), geolocation=()"
  );
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
