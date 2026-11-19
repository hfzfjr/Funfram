import { NextResponse } from "next/server";
import { verifyTurnToken } from "@/lib/turn-auth";

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 15;
const MAX_RATE_LIMIT_ENTRIES = 10_000;
const ipRateLimitMap = new Map<string, { count: number; resetAt: number }>();

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

function getClientIp(request: Request): string {
  const cfIp = request.headers.get("cf-connecting-ip")?.trim();
  if (cfIp) return cfIp;

  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;

  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const parts = forwardedFor
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length > 0) {
      return parts[parts.length - 1];
    }
  }
  return "unknown";
}

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  if (ipRateLimitMap.size >= MAX_RATE_LIMIT_ENTRIES) {
    for (const [k, v] of ipRateLimitMap.entries()) {
      if (now > v.resetAt) {
        ipRateLimitMap.delete(k);
      }
    }
    if (ipRateLimitMap.size >= MAX_RATE_LIMIT_ENTRIES) {
      ipRateLimitMap.clear();
    }
  }

  const record = ipRateLimitMap.get(ip);
  if (!record || now > record.resetAt) {
    ipRateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }

  if (record.count >= RATE_LIMIT_MAX_REQUESTS) {
    return true;
  }

  record.count += 1;
  return false;
}

function isAllowedOrigin(request: Request): boolean {
  const secFetchDest = request.headers.get("sec-fetch-dest");
  const secFetchMode = request.headers.get("sec-fetch-mode");
  if (secFetchDest === "document" || secFetchMode === "navigate") {
    return false;
  }

  const origin = request.headers.get("origin");
  if (!origin) {
    return process.env.NODE_ENV !== "production";
  }

  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    return false;
  }

  if (
    process.env.NODE_ENV === "development" &&
    (parsedOrigin.hostname === "localhost" || parsedOrigin.hostname === "127.0.0.1")
  ) {
    return true;
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (appUrl) {
    try {
      if (parsedOrigin.origin === new URL(appUrl).origin) {
        return true;
      }
    } catch {
      // ignore invalid NEXT_PUBLIC_APP_URL
    }
  }

  const host = request.headers.get("host");
  if (host && (parsedOrigin.origin === `https://${host}` || parsedOrigin.origin === `http://${host}`)) {
    return true;
  }

  return false;
}

async function fetchMeteredIceServers() {
  const meteredDomain = process.env.METERED_DOMAIN;
  const meteredApiKey = process.env.METERED_API_KEY;
  if (!meteredDomain || !meteredApiKey) {
    return null;
  }

  const url = `https://${meteredDomain}/api/v1/turn/credentials?apiKey=${encodeURIComponent(meteredApiKey)}`;
  const res = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) {
    console.error(`Metered API returned HTTP ${res.status}`);
    return null;
  }

  const meteredServers = await res.json();
  if (Array.isArray(meteredServers)) {
    return { iceServers: meteredServers };
  }
  return null;
}

export async function GET(request: Request) {
  if (!isAllowedOrigin(request)) {
    return NextResponse.json(
      { error: "Forbidden" },
      { status: 403, headers: NO_STORE_HEADERS }
    );
  }

  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const claims = verifyTurnToken(token);
  if (!claims) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: NO_STORE_HEADERS }
    );
  }

  const clientIp = getClientIp(request);
  if (isRateLimited(clientIp)) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: NO_STORE_HEADERS }
    );
  }

  try {
    const turnKeyId = process.env.CLOUDFLARE_TURN_KEY_ID;
    const apiToken = process.env.CLOUDFLARE_TURN_API_TOKEN;

    if (turnKeyId && apiToken) {
      try {
        const response = await fetch(
          `https://rtc.live.cloudflare.com/v1/turn/keys/${turnKeyId}/credentials/generate-ice-servers`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ ttl: 900 }), // 15 minutes
            cache: "no-store",
            signal: AbortSignal.timeout(5000),
          }
        );

        if (response.ok) {
          const data = await response.json();
          return NextResponse.json(data, { headers: NO_STORE_HEADERS });
        }
        console.error(`Cloudflare TURN API returned HTTP ${response.status}`);
      } catch (cfError) {
        console.error("Cloudflare TURN request failed:", cfError instanceof Error ? cfError.name : "error");
      }
    }

    const meteredData = await fetchMeteredIceServers();
    if (meteredData) {
      return NextResponse.json(meteredData, { headers: NO_STORE_HEADERS });
    }

    return NextResponse.json(
      { error: "TURN credentials unavailable" },
      { status: 503, headers: NO_STORE_HEADERS }
    );
  } catch {
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
