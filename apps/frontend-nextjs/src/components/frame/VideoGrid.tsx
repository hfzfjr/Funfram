import { Participant, FrameSide } from '@/types/participant';
import { useCallStore } from '@/store/useCallStore';
import VideoTile from './VideoTile';

interface VideoGridProps {
    participants: Participant[];
    side: FrameSide;
}

export default function VideoGrid({ participants }: VideoGridProps) {
    const localUserId = useCallStore((state) => state.localUser?.id);
    const count = participants.length;
    const gridLayoutClass =
        count <= 1
            ? 'grid-cols-1 grid-rows-1'
            : count === 2
            ? 'grid-cols-2 grid-rows-1'
            : count === 3
            ? 'grid-cols-2 grid-rows-2 [&>*:nth-child(1)]:row-span-2 [&>*:nth-child(1)]:col-start-1 [&>*:nth-child(2)]:row-start-1 [&>*:nth-child(2)]:col-start-2 [&>*:nth-child(3)]:row-start-2 [&>*:nth-child(3)]:col-start-2'
            : 'grid-cols-2 grid-rows-2';

    return (
        <div className={`w-full h-full grid gap-1 md:gap-2 transition-all duration-300 ${gridLayoutClass}`}>
            {participants.map((participant) => (
                <VideoTile
                    key={participant.id === localUserId ? 'local-user' : participant.id}
                    participant={participant}
                />
            ))}
        </div>
    );
}
