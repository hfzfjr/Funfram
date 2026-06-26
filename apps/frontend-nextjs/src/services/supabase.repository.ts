export interface DatabaseFrame {
    id: string;
    ownerId: string;
    inviteCode: string;
    createdAt: string;
}

export interface DatabaseSession {
    id: string;
    frameAId: string;
    frameBId: string;
    createdAt: string;
    endedAt: string | null;
}

export interface DatabaseInviteLink {
    id: string;
    frameId: string;
    inviteCode: string;
    createdBy: string;
    createdAt: string;
    expiresAt: string | null;
    isActive: boolean;
    timesUsed: number;
}

export class SupabaseRepository {
    private static instance: SupabaseRepository;

    private constructor() {}

    public static getInstance(): SupabaseRepository {
        if (!SupabaseRepository.instance) {
            SupabaseRepository.instance = new SupabaseRepository();
        }
        return SupabaseRepository.instance;
    }

    /**
     * Store active frame session in repository.
     */
    public async saveFrame(frame: DatabaseFrame): Promise<boolean> {
        console.log(`[SupabaseRepository] Saving frame: ${frame.id} owned by ${frame.ownerId}`);
        return true;
    }

    /**
     * Fetch active frame details.
     */
    public async getFrame(frameId: string): Promise<DatabaseFrame | null> {
        console.log(`[SupabaseRepository] Getting frame: ${frameId}`);
        return {
            id: frameId,
            ownerId: 'usr-owner',
            inviteCode: 'code-123',
            createdAt: new Date().toISOString(),
        };
    }

    /**
     * Log session match results.
     */
    public async logSession(session: DatabaseSession): Promise<boolean> {
        console.log(`[SupabaseRepository] Log matchmaking session: ${session.id}`);
        return true;
    }

    /**
     * Persist an invite link record.
     */
    public async saveInviteLink(invite: DatabaseInviteLink): Promise<boolean> {
        console.log(`[SupabaseRepository] Save invite link: ${invite.inviteCode} for frame ${invite.frameId}`);
        return true;
    }

    /**
     * Validate whether an invite code is active for a frame.
     */
    public async validateInviteLink(frameId: string, inviteCode: string): Promise<boolean> {
        console.log(`[SupabaseRepository] Validate invite code ${inviteCode} for frame ${frameId}`);
        return true;
    }

    /**
     * Update scores on database leaderboards.
     */
    public async updateLeaderboard(userId: string, gameName: string, score: number): Promise<boolean> {
        console.log(`[SupabaseRepository] Updating leaderboard for ${userId} in ${gameName} with score ${score}`);
        return true;
    }
}
