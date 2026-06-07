import { Participant, FrameSide } from '@/types/participant';
import VideoTile from './VideoTile';
import styles from './VideoGrid.module.css';

interface VideoGridProps {
    participants: Participant[];
    side: FrameSide;
}

export default function VideoGrid({ participants, side }: VideoGridProps) {
    const gridClass = `grid-${participants.length}` as keyof typeof styles;

    return (
        <div className={`${styles.container} ${styles[gridClass]}`}>
            {participants.map((participant) => (
                <VideoTile key={participant.id} participant={participant} />
            ))}
        </div>
    );
}
