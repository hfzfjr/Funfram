export type PresenceState = 
    | "ONLINE"
    | "MATCHING"
    | "PLAYING"
    | "DRAWING"
    | "GUESSING"
    | "IDLE"
    | "OFFLINE";

export interface Participant {
    id: string;
    stream: MediaStream | null;
    name: string;
    isMuted: boolean;
    isCameraOff: boolean;
    isOwner: boolean;
    presence: PresenceState;
    joinOrder: number; // Used for Ownership Transfer Algorithm
}

export type FrameSide = "left" | "right";

// Global Application FSM
export type AppFsmState = 
    | "HOME"
    | "FRAME"
    | "SEARCHING"
    | "MATCHED"
    | "PLAYING"
    | "RESULT";

// Matchmaking Engine FSM
export type MatchmakingState =
    | "Waiting"
    | "Searching"
    | "Matched"
    | "Cooldown"
    | "ActiveMeeting"
    | "Next"
    | "Leaving"
    | "Destroyed";
