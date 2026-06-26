export interface CanvasEvent {
    type: 'start' | 'move' | 'end';
    x: number;
    y: number;
    color?: string;
    brushSize?: number;
}

export interface GuessEvent {
    id: string;
    playerId: string;
    playerName: string;
    text: string;
    isCorrect: boolean;
    timestamp: string;
}

export type GameFsmState =
    | "Waiting"
    | "Countdown"
    | "Drawing"
    | "Guessing"
    | "Reveal"
    | "NextRound"
    | "Finished";

export interface GuessDrawingState {
    currentRound: number;
    currentDrawerId: string | null;
    currentWord: string;
    wordHint: string;
    timeRemaining: number;
    drawTimer: number; // 10s countdown for drawer start
    canvasEvents: CanvasEvent[];
    guessEvents: GuessEvent[];
    score: Record<string, number>; // Participant ID -> Points
    queue: string[]; // Order of drawer IDs
    winner: string | null;
    status: GameFsmState;
}
