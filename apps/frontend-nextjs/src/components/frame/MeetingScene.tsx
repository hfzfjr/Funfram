'use client';

import { useCallStore } from '@/store/useCallStore';
import FramePanel from './FramePanel';
import PlaceholderTile from './PlaceholderTile';

export default function MeetingScene() {
    const fsmState = useCallStore((state) => state.fsmState);
    const matchmakingState = useCallStore((state) => state.matchmakingState);

    let placeholderText: string | null = null;
    let showLogo = true;

    if (fsmState === 'SEARCHING' || matchmakingState === 'Searching') {
        placeholderText = "Mencari lawan ngobrol...";
        showLogo = false;
    } else if (matchmakingState === 'Cooldown') {
        placeholderText = "Menyiapkan koneksi...";
        showLogo = false;
    } else if (fsmState === 'FRAME') {
        placeholderText = "Siap mencari lawan...";
        showLogo = true;
    }

    const showRightFrame = fsmState === 'MATCHED';

    return (
        <div className="w-full h-full flex-1 flex flex-col md:flex-row gap-4 md:gap-6 p-4 md:p-6 bg-transparent box-border items-center justify-center">
            {/* Right Side: Remote Frame (Frame B) or Placeholder (Top on Mobile) */}
            <div className="order-1 md:order-2 w-full max-w-[calc(50dvh-65px)] md:max-w-none md:w-[min(calc(50vw-36px),calc(100dvh-140px))] h-auto md:h-[min(calc(50vw-36px),calc(100dvh-140px))] aspect-square flex-none flex flex-col rounded-lg bg-slate-50 shadow-[0_8px_32px_rgba(59,130,246,0.15),0_0_0_1px_rgba(59,130,246,0.05)]">
                {showRightFrame ? (
                    <FramePanel side="right" />
                ) : (
                    <PlaceholderTile showLogo={showLogo} text={placeholderText} />
                )}
            </div>

            {/* Left Frame: Local Frame (Frame A) (Bottom on Mobile) */}
            <div className="order-2 md:order-1 w-full max-w-[calc(50dvh-65px)] md:max-w-none md:w-[min(calc(50vw-36px),calc(100dvh-140px))] h-auto md:h-[min(calc(50vw-36px),calc(100dvh-140px))] aspect-square flex-none flex flex-col rounded-lg bg-slate-50 shadow-[0_8px_32px_rgba(59,130,246,0.15),0_0_0_1px_rgba(59,130,246,0.05)]">
                <FramePanel side="left" />
            </div>
        </div>
    );
}
