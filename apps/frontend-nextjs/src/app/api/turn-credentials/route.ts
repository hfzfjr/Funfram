import { NextResponse } from 'next/server';

const RATE_LIMIT_WINDOW_MS = 60_000; // 1 menit
const RATE_LIMIT_MAX_REQUESTS = 15; // Maks 15 request per menit per IP
const ipRateLimitMap = new Map<string, { count: number; resetAt: number }>();

function getClientIp(request: Request): string {
    const forwardedFor = request.headers.get('x-forwarded-for');
    if (forwardedFor) {
        return forwardedFor.split(',')[0].trim();
    }
    return request.headers.get('x-real-ip') || 'unknown';
}

function isRateLimited(ip: string): boolean {
    const now = Date.now();
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

function isAllowedCaller(request: Request): boolean {
    // Tolak akses langsung dari address bar browser (top-level navigation)
    const secFetchDest = request.headers.get('sec-fetch-dest');
    const secFetchMode = request.headers.get('sec-fetch-mode');
    if (secFetchDest === 'document' || secFetchMode === 'navigate') {
        return false;
    }

    // Wajib berasal dari client Funfram
    if (request.headers.get('x-funfram-client') !== '1') {
        return false;
    }

    // Validasi Origin jika dikirim oleh browser
    const origin = request.headers.get('origin');
    if (origin) {
        const appUrl = process.env.NEXT_PUBLIC_APP_URL;
        const host = request.headers.get('host');
        const isLocal = origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1');
        const matchesAppUrl = appUrl ? origin === new URL(appUrl).origin : false;
        const matchesHost = host ? origin === `https://${host}` || origin === `http://${host}` : false;

        if (!isLocal && !matchesAppUrl && !matchesHost) {
            return false;
        }
    }

    return true;
}

async function fetchMeteredIceServers() {
    const meteredDomain = process.env.METERED_DOMAIN;
    const meteredApiKey = process.env.METERED_API_KEY;

    if (!meteredDomain || !meteredApiKey) {
        return null;
    }

    const url = `https://${meteredDomain}/api/v1/turn/credentials?apiKey=${meteredApiKey}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
        console.error(`Metered API Error: ${res.status} ${res.statusText}`);
        return null;
    }

    const meteredServers = await res.json();
    if (Array.isArray(meteredServers)) {
        return { iceServers: meteredServers };
    }

    return null;
}

export async function GET(request: Request) {
    if (!isAllowedCaller(request)) {
        return NextResponse.json(
            { error: 'Forbidden' },
            { status: 403, headers: { 'Cache-Control': 'no-store' } }
        );
    }

    const clientIp = getClientIp(request);
    if (isRateLimited(clientIp)) {
        return NextResponse.json(
            { error: 'Too many requests' },
            { status: 429, headers: { 'Cache-Control': 'no-store' } }
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
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${apiToken}`,
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            ttl: 86400, // 24 hours
                        }),
                        cache: 'no-store'
                    }
                );

                if (response.ok) {
                    const data = await response.json();
                    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
                }

                const errorText = await response.text();
                console.error('Cloudflare API Error:', errorText);
            } catch (cfError) {
                console.error('Cloudflare TURN request failed:', cfError);
            }
        } else {
            console.warn('Cloudflare TURN credentials are not configured, checking Metered fallback');
        }

        // Optional fallback to Metered TURN if configured
        const meteredData = await fetchMeteredIceServers();
        if (meteredData) {
            return NextResponse.json(meteredData, { headers: { 'Cache-Control': 'no-store' } });
        }

        return NextResponse.json(
            { error: 'TURN credentials unavailable' },
            { status: 503, headers: { 'Cache-Control': 'no-store' } }
        );
    } catch (error) {
        console.error('Error in /api/turn-credentials:', error);
        return NextResponse.json(
            { error: 'Internal Server Error' },
            { status: 500, headers: { 'Cache-Control': 'no-store' } }
        );
    }
}
