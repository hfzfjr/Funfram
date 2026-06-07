import { useCallStore } from '@/store/useCallStore';
import type { CallStore } from '@/store/useCallStore';
import LobbyPanel from './LobbyPanel';
import FramePanel from './FramePanel';
import PlaceholderTile from './PlaceholderTile';
import styles from './CallLayout.module.css';

interface CallLayoutProps {
    localUserName: string;
    localStream: MediaStream | null;
    isCamOn?: boolean;
}

export default function CallLayout({ localUserName, localStream, isCamOn = true }: CallLayoutProps) {
    const phase = useCallStore((state: CallStore) => state.phase);
    const leftParticipants = useCallStore((state: CallStore) => state.leftParticipants);

    return (
        <div className={styles.container}>
            {phase === 'lobby' ? (
                <>
                    <div className={styles.side}>
                        <LobbyPanel userName={localUserName} participantCount={leftParticipants.length} localStream={localStream} isCameraOn={isCamOn} />
                    </div>
                    <div className={styles.side}>
                        <PlaceholderTile />
                    </div>
                </>
            ) : phase === 'matching' ? (
                <>
                    <div className={styles.side}>
                        <LobbyPanel userName={localUserName} participantCount={leftParticipants.length} localStream={localStream} isCameraOn={isCamOn} />
                    </div>
                    <div className={styles.side}>
                        <PlaceholderTile showLogo={false} text="Mencari lawan bicara" />
                    </div>
                </>
            ) : (
                <>
                    <div className={styles.side}>
                        <FramePanel side="left" />
                    </div>
                    <div className={styles.side}>
                        <FramePanel side="right" />
                    </div>
                </>
            )}
        </div>
    );
}
