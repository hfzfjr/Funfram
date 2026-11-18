import { FrameSide } from '@/types/participant';
import { useCallStore } from '@/store/useCallStore';
import VideoGrid from './VideoGrid';

interface FramePanelProps {
    side: FrameSide;
}

export default function FramePanel({ side }: FramePanelProps) {
    const participants = useCallStore((state) =>
        side === 'left' ? state.leftParticipants : state.rightParticipants
    );

    return (
        <div className="w-full h-full flex flex-col rounded-lg overflow-hidden bg-slate-100 border border-slate-200 shadow-sm">
            <div className="flex-1 flex items-stretch">
                <VideoGrid participants={participants} side={side} />
            </div>
        </div>
    );
}
