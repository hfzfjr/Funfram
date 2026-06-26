import { InviteParams, generateSimulatedSignature } from './hmac';

export interface CreateFrameResponse {
    frameId: string;
    ownerId: string;
    token: string;
}

export interface VerifyInviteResponse {
    isValid: boolean;
    frameId: string;
    sessionId: string | null;
}

export class ApiService {
    private static instance: ApiService;

    private constructor() { }

    public static getInstance(): ApiService {
        if (!ApiService.instance) {
            ApiService.instance = new ApiService();
        }
        return ApiService.instance;
    }

    /**
     * Creates a new Frame on the server.
     */
    public async createFrame(username: string): Promise<CreateFrameResponse> {
        // Simulate HTTP POST /api/v1/frames
        return new Promise((resolve) => {
            setTimeout(() => {
                const frameId = 'frm-' + Math.random().toString(36).substring(2, 9);
                const ownerId = 'usr-' + Math.random().toString(36).substring(2, 9);
                resolve({
                    frameId,
                    ownerId,
                    token: 'mock-jwt-token',
                });
            }, 300);
        });
    }

    /**
     * Generates a temporary invite link.
     */
    public async generateInviteLink(frameId: string, sessionId: string): Promise<string> {
        // In the future, this makes a POST /api/v1/invites which signs the token server-side.
        // For now, we sign it on the client.
        const expire = Date.now() + 5 * 60 * 1000; // 5 minutes validity
        const nonce = Math.random().toString(36).substring(2, 9);
        const params: InviteParams = { frameId, sessionId: sessionId || 'no-session', expire, nonce };
        const signature = await generateSimulatedSignature(params);

        const origin = typeof window !== 'undefined' ? window.location.origin : process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
        return `${origin}/funvideo?invite=${signature}&frameId=${frameId}&sessionId=${sessionId || 'no-session'}&expire=${expire}&nonce=${nonce}`;
    }

    /**
     * Checks if an invite link query is valid.
     */
    public async verifyInviteLink(
        frameId: string,
        sessionId: string,
        expireStr: string,
        nonce: string,
        signature: string
    ): Promise<VerifyInviteResponse> {
        const expire = parseInt(expireStr, 10);

        // Simulating GET /api/v1/invites/verify
        const now = Date.now();
        if (now > expire) {
            return { isValid: false, frameId, sessionId: null };
        }

        // Simulating DB active frame verification
        return {
            isValid: true,
            frameId,
            sessionId: sessionId === 'no-session' ? null : sessionId,
        };
    }
}
