import { WebSocketService } from './websocket.service';

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
     * Requests a server-signed HMAC invite token from Go WebSocket hub.
     */
    public async generateInviteLink(frameId: string, _sessionId?: string): Promise<string> {
        const origin =
            typeof window !== 'undefined'
                ? window.location.origin
                : process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

        const ws = WebSocketService.getInstance();
        return new Promise<string>((resolve) => {
            const timeout = setTimeout(() => {
                ws.off('INVITE_CREATED', onCreated);
                resolve(`${origin}/join-frame?frameId=${encodeURIComponent(frameId)}`);
            }, 3000);

            const onCreated = (payload: any) => {
                if (payload?.frameId === frameId && payload?.inviteToken) {
                    clearTimeout(timeout);
                    ws.off('INVITE_CREATED', onCreated);
                    const params = new URLSearchParams({
                        frameId: payload.frameId,
                        token: payload.inviteToken,
                    });
                    resolve(`${origin}/join-frame?${params.toString()}`);
                }
            };

            ws.on('INVITE_CREATED', onCreated);
            ws.sendEvent('INVITE_CREATE', {});
        });
    }
}
