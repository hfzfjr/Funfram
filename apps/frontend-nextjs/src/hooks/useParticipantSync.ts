import { useEffect } from 'react';
import { useCallStore } from '@/store/useCallStore';
import { Participant, FrameSide, AppFsmState } from '@/types/participant';

interface ParticipantJoinEvent {
    type: 'participant:join';
    data: {
        side: FrameSide;
        participant: Participant;
    };
}

interface ParticipantLeaveEvent {
    type: 'participant:leave';
    data: {
        side: FrameSide;
        id: string;
    };
}

interface PhaseChangeEvent {
    type: 'phase:change';
    data: {
        fsmState: AppFsmState;
    };
}

type WebSocketEvent = ParticipantJoinEvent | ParticipantLeaveEvent | PhaseChangeEvent;

export function useParticipantSync(socket: WebSocket | null) {
    const addParticipant = useCallStore((state) => state.addParticipant);
    const removeParticipant = useCallStore((state) => state.removeParticipant);
    const setFsmState = useCallStore((state) => state.setFsmState);

    useEffect(() => {
        if (!socket) return;

        const handleMessage = (event: MessageEvent) => {
            try {
                const message: WebSocketEvent = JSON.parse(event.data);

                switch (message.type) {
                    case 'participant:join':
                        addParticipant(message.data.side, message.data.participant);
                        break;
                    case 'participant:leave':
                        removeParticipant(message.data.side, message.data.id);
                        break;
                    case 'phase:change':
                        setFsmState(message.data.fsmState);
                        break;
                }
            } catch (error) {
                console.error('Error parsing WebSocket message:', error);
            }
        };

        socket.addEventListener('message', handleMessage);

        return () => {
            socket.removeEventListener('message', handleMessage);
        };
    }, [socket, addParticipant, removeParticipant, setFsmState]);
}
