import { create } from 'zustand';
import { Participant, FrameSide, CallPhase } from '@/types/participant';

export interface CallStore {
    phase: CallPhase;
    leftParticipants: Participant[];
    rightParticipants: Participant[];
    setPhase: (phase: CallPhase) => void;
    addParticipant: (side: FrameSide, participant: Participant) => void;
    removeParticipant: (side: FrameSide, id: string) => void;
    reset: () => void;
}

export const useCallStore = create<CallStore>((set: (partial: Partial<CallStore> | ((state: CallStore) => Partial<CallStore>)) => void) => ({
    phase: 'lobby',
    leftParticipants: [],
    rightParticipants: [],
    setPhase: (phase: CallPhase) => set({ phase }),
    addParticipant: (side: FrameSide, participant: Participant) =>
        set((state: CallStore) => {
            const participants = side === 'left' ? state.leftParticipants : state.rightParticipants;
            if (participants.length >= 4) return state;
            return {
                [side === 'left' ? 'leftParticipants' : 'rightParticipants']: [...participants, participant],
            };
        }),
    removeParticipant: (side: FrameSide, id: string) =>
        set((state: CallStore) => ({
            [side === 'left' ? 'leftParticipants' : 'rightParticipants']: (
                side === 'left' ? state.leftParticipants : state.rightParticipants
            ).filter((p) => p.id !== id),
        })),
    reset: () =>
        set({
            phase: 'lobby',
            leftParticipants: [],
            rightParticipants: [],
        }),
}));
