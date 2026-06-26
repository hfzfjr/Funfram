import { FrameSide } from '@/types/participant';
import { useCallStore } from '@/store/useCallStore';
import VideoGrid from './VideoGrid';
import styles from './FramePanel.module.css';

interface FramePanelProps {
    side: FrameSide;
}

export default function FramePanel({ side }: FramePanelProps) {
    const participants = useCallStore((state) =>
        side === 'left' ? state.leftParticipants : state.rightParticipants
    );

    return (
        <div className={styles.container}>
            <div className={styles.content}>
                <VideoGrid participants={participants} side={side} />
            </div>
        </div>
    );
}
