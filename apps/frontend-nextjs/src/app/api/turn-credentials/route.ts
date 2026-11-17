import { NextResponse } from 'next/server';

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
                    return NextResponse.json(data);
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
            return NextResponse.json(meteredData);
        }

        return NextResponse.json(
            { error: 'Failed to generate TURN credentials from Cloudflare or Metered' },
            { status: 500 }
        );
    } catch (error) {
        console.error('Error in /api/turn-credentials:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
