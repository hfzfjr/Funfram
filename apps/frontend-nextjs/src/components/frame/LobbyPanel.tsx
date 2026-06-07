import { useRef, useEffect } from 'react';
import styles from './LobbyPanel.module.css';

interface LobbyPanelProps {
    userName: string;
    participantCount: number;
    localStream: MediaStream | null;
    isCameraOn?: boolean;
}

export default function LobbyPanel({ userName, participantCount, localStream, isCameraOn = true }: LobbyPanelProps) {
    const videoRef = useRef<HTMLVideoElement>(null);

    useEffect(() => {
        if (videoRef.current) {
            if (localStream && isCameraOn) {
                videoRef.current.srcObject = localStream;
            } else {
                videoRef.current.srcObject = null;
            }
        }
    }, [localStream, isCameraOn]);

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
            <div className={styles.videoContainer}>
                {localStream ? (
                    isCameraOn ? (
                        <video
                            ref={videoRef}
                            autoPlay
                            playsInline
                            muted
                            className={styles.video}
                        />
                    ) : (
                        <div className={styles.videoOff}></div>
                    )
                ) : (
                    <div className={styles.placeholder}>
                        <span className={styles.initials}>{getInitials(userName)}</span>
                        <span className={styles.userName}>{userName}</span>
                    </div>
                )}
            </div>
        </div>
    );
}
