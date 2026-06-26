import { useRef, useEffect } from 'react';
import { Participant } from '@/types/participant';
import { useCallStore } from '@/store/useCallStore';
import styles from './VideoTile.module.css';

interface VideoTileProps {
    participant: Participant;
}

export default function VideoTile({ participant }: VideoTileProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const localUserId = useCallStore((state) => state.localUser?.id);
    const isLocalVideo = participant.id === localUserId;

    useEffect(() => {
        if (videoRef.current && participant.stream) {
            videoRef.current.srcObject = participant.stream;
            videoRef.current.play().catch(() => {
                // The browser may still wait for the user gesture; controls can retry camera.
            });
        }
    }, [participant.stream]);

    const getInitials = (name: string) => {
        return name
            .split(' ')
            .map((n) => n[0])
            .join('')
            .toUpperCase()
            .slice(0, 2);
    };

    return (
        <div className={styles.container}>
            {participant.stream ? (
                <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted={isLocalVideo || participant.isMuted}
                    className={styles.video}
                />
            ) : (
                <div className={styles.placeholder}>
                    <span className={styles.initials}>{getInitials(participant.name)}</span>
                </div>
            )}
            <div className={styles.overlay}>
                <span className={styles.name}>{participant.name}</span>
                {participant.isMuted && (
                    <div className={styles.mutedIcon}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                            <line x1="12" y1="19" x2="12" y2="23" />
                            <line x1="8" y1="23" x2="16" y2="23" />
                        </svg>
                    </div>
                )}
            </div>
        </div>
    );
}
