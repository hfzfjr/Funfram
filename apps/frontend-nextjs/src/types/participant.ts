export interface Participant {
    id: string;
    stream: MediaStream | null;
    name: string;
    isMuted: boolean;
}

export type FrameSide = "left" | "right";

export type CallPhase = "lobby" | "matching" | "connected";
