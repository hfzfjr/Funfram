
'use client';
import { useEffect, useRef } from 'react';
import { useCallStore } from '@/store/useCallStore';

const ParticipantAudio = ({ participant }: { participant: any }) => {
    const audioRef = useRef<HTMLAudioElement>(null);

    useEffect(() => {
        const audioEl = audioRef.current;
        if (!audioEl) return;

        audioEl.muted = Boolean(participant.isMuted);
        if (participant.stream) {
            if (audioEl.srcObject !== participant.stream) {
                audioEl.srcObject = participant.stream;
            }
            audioEl.play().catch(() => {
                // Autoplay policy may block hidden audio until user interaction; VideoTile handles unlock UI
            });
        } else {
            audioEl.srcObject = null;
        }
    }, [participant.stream, participant.isMuted]);

    return <audio ref={audioRef} autoPlay playsInline className="hidden" />;
};

export default function HiddenAudioTracks() {
    const rightParticipants = useCallStore(state => state.rightParticipants);
    const leftParticipants = useCallStore(state => state.leftParticipants);
    const localUser = useCallStore(state => state.localUser);

    // We only want to play audio for REMOTE participants
    const allParticipants = [...leftParticipants, ...rightParticipants];
    const remoteParticipants = allParticipants.filter(p => p.id !== localUser?.id && p.stream);

    return (
        <div className="hidden">
            {remoteParticipants.map(p => (
                <ParticipantAudio key={p.id} participant={p} />
            ))}
        </div>
    );
}

