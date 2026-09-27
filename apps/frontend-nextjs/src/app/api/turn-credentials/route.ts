import { NextResponse } from 'next/server';

export async function GET(request: Request) {
    try {
        const turnKeyId = process.env.CLOUDFLARE_TURN_KEY_ID;
        const apiToken = process.env.CLOUDFLARE_TURN_API_TOKEN;

        if (!turnKeyId || !apiToken) {
            return NextResponse.json(
                { error: 'Cloudflare TURN credentials are not configured in environment variables' },
                { status: 500 }
            );
        }

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
                // Optionally disable cache if Next.js caches this aggressively
                cache: 'no-store'
            }
        );

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Cloudflare API Error:', errorText);
            return NextResponse.json(
                { error: 'Failed to generate ICE servers from Cloudflare' },
                { status: response.status }
            );
        }

        const data = await response.json();
        return NextResponse.json(data);
    } catch (error) {
        console.error('Error in /api/turn-credentials:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
