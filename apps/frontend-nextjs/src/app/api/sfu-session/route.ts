import { NextResponse } from "next/server";
import { verifyTurnToken } from "@/lib/turn-auth";

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const claims = verifyTurnToken(token);
  if (!claims) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  }

  const appId = process.env.CLOUDFLARE_SFU_APP_ID;
  const apiToken = process.env.CLOUDFLARE_SFU_API_TOKEN;
  if (!appId || !apiToken) {
    return NextResponse.json(
      { error: "Cloudflare SFU not configured; using P2P/TURN fallback", fallback: "p2p" },
      { status: 503, headers: NO_STORE }
    );
  }

  try {
    const res = await fetch(
      `https://rtc.live.cloudflare.com/v1/apps/${appId}/sessions/new`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      }
    );

    if (!res.ok) {
      return NextResponse.json(
        { error: "Failed to create SFU session", fallback: "p2p" },
        { status: 502, headers: NO_STORE }
      );
    }

    const data = await res.json();
    return NextResponse.json(
      { ...data, roomId: claims.room, userId: claims.sub },
      { headers: NO_STORE }
    );
  } catch {
    return NextResponse.json(
      { error: "SFU request failed", fallback: "p2p" },
      { status: 504, headers: NO_STORE }
    );
  }
}
