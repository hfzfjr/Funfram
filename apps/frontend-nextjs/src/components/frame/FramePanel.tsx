import { FrameSide } from '@/types/participant';
import { useCallStore } from '@/store/useCallStore';
import type { CallStore } from '@/store/useCallStore';
import VideoGrid from './VideoGrid';
import PlaceholderTile from './PlaceholderTile';
import styles from './FramePanel.module.css';

interface FramePanelProps {
    side: FrameSide;
}

export default function FramePanel({ side }: FramePanelProps) {
    const phase = useCallStore((state: CallStore) => state.phase);
    const participants = useCallStore((state: CallStore) =>
        side === 'left' ? state.leftParticipants : state.rightParticipants
    );

    const shouldShowPlaceholder = side === 'right' && (phase === 'lobby' || phase === 'matching');

    return (
        <div className={styles.container}>
            <div className={styles.content}>
                {shouldShowPlaceholder ? (
                    <PlaceholderTile />
                ) : (
                    <VideoGrid participants={participants} side={side} />
                )}
            </div>
        </div>
    );
}
