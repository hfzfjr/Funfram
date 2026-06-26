import { create } from 'zustand';
import { WebSocketService } from '@/services/websocket.service';
import { Participant, FrameSide, AppFsmState, MatchmakingState } from '@/types/participant';
import { GuessDrawingState, CanvasEvent, GuessEvent } from '@/types/game';

// Re-export types for service layer consumption
export type { Participant } from '@/types/participant';

export interface Frame {
    id: string;
    ownerId: string;
    members: Participant[];
}

export interface Session {
    sessionId: string;
    frameA: Frame;
    frameB: Frame;
    createdAt: string;
    state: string;
    currentGame: string | null;
    players: Participant[];
    events: string[];
}

export interface ChatMessage {
    id: string;
    senderId: string;
    senderName: string;
    text: string;
    side: FrameSide;
    timestamp: string;
}

export interface GameInvite {
    senderId: string;
    senderName: string;
    sessionId: string;
    gameType: string;
}

export interface CallStore {
    // FSM States
    fsmState: AppFsmState;
    matchmakingState: MatchmakingState;
    
    // Identifiers
    localUser: Participant | null;
    frameId: string | null;
    inviteToken: string | null;
    sessionId: string | null;
    
    // Participants
    leftParticipants: Participant[]; // Local Frame (Frame A)
    rightParticipants: Participant[]; // Remote Frame (Frame B)
    
    // Chats (Temporary, reset on leave)
    generalChat: ChatMessage[];
    
    // Game state
    gameInvite: GameInvite | null;
    gameState: GuessDrawingState | null;
    
    // Rate Limiting Cooldown (FRAME_NEXT)
    lastNextFrameClick: number;

    // FSM State transitions
    setFsmState: (state: AppFsmState) => void;
    setMatchmakingState: (state: MatchmakingState) => void;
    setLocalUser: (user: Participant | null) => void;
    
    // Frame actions
    createFrame: (username: string) => void;
    joinFrame: (frameId: string, inviteToken: string, username: string) => void;
    leaveFrame: () => void;
    addParticipant: (side: FrameSide, participant: Participant) => void;
    removeParticipant: (side: FrameSide, id: string) => void;
    kickParticipant: (id: string) => void;
    
    // Matchmaking / Session actions
    setSession: (session: Session | null) => void;
    triggerNextFrame: () => boolean; // returns true if action allowed (rate limited)
    
    // Chat Actions
    sendGeneralMessage: (text: string) => void;
    addGeneralMessage: (msg: ChatMessage) => void;
    
    // Game Actions
    sendGameInvite: (gameType: string) => void;
    receiveGameInvite: (invite: GameInvite) => void;
    acceptGameInvite: () => void;
    declineGameInvite: () => void;
    updateGameState: (state: Partial<GuessDrawingState> | ((prev: GuessDrawingState) => Partial<GuessDrawingState>)) => void;
    dispatchCanvasEvent: (event: CanvasEvent) => void;
    receiveCanvasEvent: (event: CanvasEvent) => void;
    submitGuess: (text: string) => void;
    
    // Participant Controls (Moderation / UI status)
    muteParticipant: (id: string, isMuted: boolean) => void;
    toggleCamera: (id: string, isCameraOff: boolean) => void;
    reportUser: (targetUserId: string, reason: string) => void;

    // Reconnection / Session recovery
    resumeSession: (savedState: any) => void;
    setLocalStream: (stream: MediaStream | null) => void;
    
    reset: () => void;
}

const initialGameState = (): GuessDrawingState => ({
    currentRound: 1,
    currentDrawerId: null,
    currentWord: '',
    wordHint: '',
    timeRemaining: 60,
    drawTimer: 10,
    canvasEvents: [],
    guessEvents: [],
    score: {},
    queue: [],
    winner: null,
    status: 'Waiting',
});

export const useCallStore = create<CallStore>((set, get) => ({
    fsmState: 'HOME',
    matchmakingState: 'Waiting',
    localUser: null,
    frameId: null,
    inviteToken: null,
    sessionId: null,
    leftParticipants: [],
    rightParticipants: [],
    generalChat: [],
    gameInvite: null,
    gameState: null,
    lastNextFrameClick: 0,

    setFsmState: (fsmState) => set({ fsmState }),
    setMatchmakingState: (matchmakingState) => set({ matchmakingState }),
    setLocalUser: (localUser) => set({ localUser }),

    createFrame: (username) => {
        // Send create frame request to backend via WebSocket
        WebSocketService.getInstance().sendEvent('FRAME_CREATE', { username });
    },

    joinFrame: (frameId, inviteToken, username) => {
        // Send join frame request to backend via WebSocket
        WebSocketService.getInstance().sendEvent('FRAME_JOIN', { frameId, inviteToken, username });
        // Local state will be updated upon server response

    },

    leaveFrame: () => {
        const { leftParticipants, localUser } = get();
        
        // If local user is leaving
        if (localUser) {
            // Ownership Transfer Algorithm (Join order)
            const remainingMembers = leftParticipants.filter(p => p.id !== localUser.id);
            if (remainingMembers.length > 0) {
                // Transfer owner to the next participant in array order
                remainingMembers[0].isOwner = true;
                remainingMembers[0].presence = 'ONLINE';
            }
        }

        sessionStorage.removeItem('funfram_session');
        get().reset();
    },

    addParticipant: (side, participant) => set((state) => {
        const list = side === 'left' ? state.leftParticipants : state.rightParticipants;
        if (list.some(p => p.id === participant.id)) return {};
        if (list.length >= 4) return {};
        
        const updatedList = [...list, participant].sort((a, b) => a.joinOrder - b.joinOrder);
        
        // Recalculate ownership for local frame
        if (side === 'left' && updatedList.length > 0) {
            updatedList.forEach((p, idx) => {
                p.isOwner = idx === 0;
            });
            // Update localUser state if local user was impacted
            const currentLocalUser = state.localUser;
            if (currentLocalUser) {
                const matching = updatedList.find(p => p.id === currentLocalUser.id);
                if (matching) {
                    state.localUser = matching;
                }
            }
        }

        return {
            [side === 'left' ? 'leftParticipants' : 'rightParticipants']: updatedList,
            localUser: state.localUser,
        };
    }),

    removeParticipant: (side, id) => set((state) => {
        const list = side === 'left' ? state.leftParticipants : state.rightParticipants;
        const updatedList = list.filter(p => p.id !== id);
        
        // Recalculate ownership if left frame
        if (side === 'left' && updatedList.length > 0) {
            updatedList.forEach((p, idx) => {
                p.isOwner = idx === 0;
            });
            const currentLocalUser = state.localUser;
            if (currentLocalUser) {
                const matching = updatedList.find(p => p.id === currentLocalUser.id);
                if (matching) {
                    state.localUser = matching;
                }
            }
        }

        return {
            [side === 'left' ? 'leftParticipants' : 'rightParticipants']: updatedList,
            localUser: state.localUser,
        };
    }),

    kickParticipant: (id) => {
        // Kick participant triggers a removeParticipant event
        get().removeParticipant('left', id);
    },

    setSession: (session) => {
        if (!session) {
            set({
                sessionId: null,
                rightParticipants: [],
                fsmState: get().frameId ? 'FRAME' : 'HOME',
                matchmakingState: 'Waiting',
                gameState: null,
                gameInvite: null,
            });
            return;
        }

        // Set state to MATCHED
        set({
            sessionId: session.sessionId,
            leftParticipants: session.frameA.members,
            rightParticipants: session.frameB.members,
            fsmState: 'MATCHED',
            matchmakingState: 'ActiveMeeting',
        });
    },

    triggerNextFrame: () => {
        const now = Date.now();
        const cooldown = 2000; // 2 seconds rate limiter
        if (now - get().lastNextFrameClick < cooldown) {
            console.warn('Rate limit active on next frame. Please wait.');
            return false;
        }
        // Send next frame request to backend
        WebSocketService.getInstance().sendEvent('FRAME_NEXT', {});
        set({
            lastNextFrameClick: now,
            fsmState: 'SEARCHING',
            matchmakingState: 'Searching',
            rightParticipants: [],
            sessionId: null,
            gameState: null,
            gameInvite: null,
            generalChat: [],
        });
        return true;
    },

    sendGeneralMessage: (text) => {
        const { localUser, generalChat } = get();
        if (!localUser) return;
        
        const newMessage: ChatMessage = {
            id: 'msg-' + Math.random().toString(36).substring(2, 9),
            senderId: localUser.id,
            senderName: localUser.name,
            text: text,
            side: 'left',
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        };

        set({
            generalChat: [...generalChat, newMessage],
        });
    },

    addGeneralMessage: (msg) => set((state) => ({
        generalChat: [...state.generalChat, msg],
    })),

    sendGameInvite: (gameType) => {
        const { localUser, sessionId } = get();
        if (!localUser || !sessionId) return;
        // Send game invite to opponent via backend
        WebSocketService.getInstance().sendEvent('GAME_INVITE', { gameType, sessionId });
    },

    receiveGameInvite: (invite) => {
        set({ gameInvite: invite });
    },

    acceptGameInvite: () => {
        const { sessionId } = get();
        if (!sessionId) return;
        // Accept game invite via backend
        WebSocketService.getInstance().sendEvent('GAME_ACCEPT', { sessionId });
        // Update local state will be handled on server response
        set({
            fsmState: 'PLAYING',
            gameInvite: null,
            gameState: {
                ...initialGameState(),
                status: 'Waiting',
            },
        });
    },

    declineGameInvite: () => {
        const { sessionId } = get();
        if (sessionId) {
            WebSocketService.getInstance().sendEvent('GAME_DECLINE', { sessionId });
        }
        set({ gameInvite: null });
    },

    updateGameState: (updater) => set((state) => {
        const current = state.gameState || initialGameState();
        const partial = typeof updater === 'function' ? updater(current) : updater;
        return {
            gameState: { ...current, ...partial },
        };
    }),

    dispatchCanvasEvent: (event) => set((state) => {
        // Dispatch canvas event to backend
        WebSocketService.getInstance().sendEvent('CANVAS_' + event.type.toUpperCase(), event);
        // Optionally update local state (client-side prediction)
        if (!state.gameState) return {};
        return {
            gameState: {
                ...state.gameState,
                canvasEvents: [...state.gameState.canvasEvents, event],
            },
        };
    }),

    receiveCanvasEvent: (event) => set((state) => {
        if (!state.gameState) return {};
        return {
            gameState: {
                ...state.gameState,
                canvasEvents: [...state.gameState.canvasEvents, event],
            },
        };
    }),

    submitGuess: (text) => {
        const { localUser, gameState } = get();
        if (!localUser || !gameState) return;
        // Send guess to backend for validation
        WebSocketService.getInstance().sendEvent('GUESS_SUBMIT', { guessText: text });
        // Local optimistic update (optional) can be removed; server will echo GUESS_FEEDBACK
        // Here we omit local state mutation and rely on server response
    },

    muteParticipant: (id, isMuted) => set((state) => {
        const mapFunc = (p: Participant) => p.id === id ? { ...p, isMuted } : p;
        const left = state.leftParticipants.map(mapFunc);
        const right = state.rightParticipants.map(mapFunc);
        
        let local = state.localUser;
        if (local && local.id === id) {
            local = { ...local, isMuted };
        }

        return {
            leftParticipants: left,
            rightParticipants: right,
            localUser: local,
        };
    }),

    toggleCamera: (id, isCameraOff) => set((state) => {
        const mapFunc = (p: Participant) => p.id === id ? { ...p, isCameraOff } : p;
        const left = state.leftParticipants.map(mapFunc);
        const right = state.rightParticipants.map(mapFunc);
        
        let local = state.localUser;
        if (local && local.id === id) {
            local = { ...local, isCameraOff };
        }

        return {
            leftParticipants: left,
            rightParticipants: right,
            localUser: local,
        };
    }),

    reportUser: (targetUserId, reason) => {
        console.log(`User ${targetUserId} reported for: ${reason}`);
    },

    resumeSession: (savedState) => {
        if (!savedState) return;
        
        const local: Participant = {
            id: savedState.userId,
            stream: null,
            name: savedState.username,
            isMuted: false,
            isCameraOff: false,
            isOwner: savedState.isOwner,
            presence: 'ONLINE',
            joinOrder: savedState.isOwner ? 1 : 2,
        };

        set({
            fsmState: 'FRAME',
            matchmakingState: 'Waiting',
            localUser: local,
            frameId: savedState.frameId,
            inviteToken: savedState.inviteToken || null,
        });
    },

    setLocalStream: (stream) => set((state) => {
        const local = state.localUser ? { ...state.localUser, stream } : null;
        const left = state.leftParticipants.map(p => p.id === state.localUser?.id ? { ...p, stream } : p);
        return {
            localUser: local,
            leftParticipants: left
        };
    }),

    reset: () => set({
        fsmState: 'HOME',
        matchmakingState: 'Waiting',
        localUser: null,
        frameId: null,
        inviteToken: null,
        sessionId: null,
        leftParticipants: [],
        rightParticipants: [],
        generalChat: [],
        gameInvite: null,
        gameState: null,
    }),
}));
