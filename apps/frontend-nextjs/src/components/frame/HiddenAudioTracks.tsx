
'use client';
import { useEffect, useRef } from 'react';
import { useCallStore } from '@/store/useCallStore';

const ParticipantAudio = ({ participant }: { participant: any }) => {
    const audioRef = useRef<HTMLAudioElement>(null);

    useEffect(() => {
        if (audioRef.current && participant.stream) {
            audioRef.current.srcObject = participant.stream;
        }
    }, [participant.stream]);

    return <audio ref={audioRef} autoPlay playsInline style={{ display: 'none' }} />;
};

export default function HiddenAudioTracks() {
    const rightParticipants = useCallStore(state => state.rightParticipants);
    const leftParticipants = useCallStore(state => state.leftParticipants);
    const localUser = useCallStore(state => state.localUser);

    // We only want to play audio for REMOTE participants
    const allParticipants = [...leftParticipants, ...rightParticipants];
    const remoteParticipants = allParticipants.filter(p => p.id !== localUser?.id && p.stream);

    return (
        <div style={{ display: 'none' }}>
            {remoteParticipants.map(p => (
                <ParticipantAudio key={p.id} participant={p} />
            ))}
        </div>
    );
}

