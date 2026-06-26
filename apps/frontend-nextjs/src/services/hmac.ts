/**
 * Cryptographic HMAC Invite Token Generator (Client-side simulation).
 * 
 * NOTE FOR PRODUCTION (GO BACKEND DEPLOYMENT):
 * SecretKey must NEVER be embedded inside the frontend package. 
 * Once the Golang backend is online, the frontend client will make an HTTP request 
 * (e.g. POST /invite) to request a signed link from the server.
 */

// Simulated key used purely for mock validation in the client.
const SIMULATED_SECRET_KEY = "funfram_local_secret_key";

export interface InviteParams {
    frameId: string;
    sessionId: string;
    expire: number;
    nonce: string;
}

/**
 * Simulates generating an HMAC-SHA256 signature for the invite token parameters.
 */
export async function generateSimulatedSignature(params: InviteParams): Promise<string> {
    const dataString = `${params.frameId}:${params.sessionId}:${params.expire}:${params.nonce}`;
    
    try {
        if (typeof window !== 'undefined' && window.crypto && window.crypto.subtle) {
            const encoder = new TextEncoder();
            const keyData = encoder.encode(SIMULATED_SECRET_KEY);
            const messageData = encoder.encode(dataString);
            
            const cryptoKey = await window.crypto.subtle.importKey(
                "raw",
                keyData,
                { name: "HMAC", hash: { name: "SHA-256" } },
                false,
                ["sign"]
            );
            
            const signatureBuffer = await window.crypto.subtle.sign(
                "HMAC",
                cryptoKey,
                messageData
            );
            
            const hashArray = Array.from(new Uint8Array(signatureBuffer));
            return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        }
    } catch (e) {
        console.error("Web Crypto API failed, falling back to mock signature:", e);
    }
    
    // Fallback basic hashing string
    let hash = 0;
    for (let i = 0; i < dataString.length; i++) {
        hash = (hash << 5) - hash + dataString.charCodeAt(i);
        hash |= 0;
    }
    return `mock-sig-${Math.abs(hash)}`;
}

/**
 * Validates a simulated signature
 */
export async function verifySimulatedToken(
    frameId: string,
    sessionId: string,
    expire: number,
    nonce: string,
    signature: string
): Promise<boolean> {
    // Check expiry
    const now = Date.now();
    if (now > expire) {
        console.warn("Invite link expired.");
        return false;
    }

    const expectedSig = await generateSimulatedSignature({ frameId, sessionId, expire, nonce });
    return expectedSig === signature;
}
