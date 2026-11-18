'use client';

import { useCallStore } from '@/store/useCallStore';
import FramePanel from './FramePanel';
import PlaceholderTile from './PlaceholderTile';

export default function MeetingScene() {
    const fsmState = useCallStore((state) => state.fsmState);
    const matchmakingState = useCallStore((state) => state.matchmakingState);
    const onlineCount = useCallStore((state) => state.onlineCount);
    const localUserId = useCallStore((state) => state.localUser?.id);
    const effectiveOnlineCount = Math.max(onlineCount, localUserId && localUserId !== 'pending' ? 1 : 0);

    let placeholderText: string | null = null;
    let showLogo = true;

    if (fsmState === 'SEARCHING' || matchmakingState === 'Searching') {
        placeholderText = "Searching for an opponent frame...";
        showLogo = false;
    } else if (matchmakingState === 'Cooldown') {
        placeholderText = "Preparing connection...";
        showLogo = false;
    } else if (fsmState === 'FRAME') {
        placeholderText = "Waiting for match...";
        showLogo = true;
    }

    const showRightFrame = fsmState === 'MATCHED';

    return (
        <div className="relative w-full h-full flex-1 flex flex-col md:flex-row gap-4 md:gap-6 p-4 md:p-6 bg-transparent box-border items-center justify-center">
            {/* Floating Brand + Live Online Counter Pill (zero height impact on video frames) */}
            <div className="absolute top-2.5 md:top-3 left-1/2 -translate-x-1/2 z-20 pointer-events-none flex items-center gap-3 px-4 py-2 rounded-full bg-white/90 backdrop-blur-md border border-slate-200/90 shadow-sm">
                <img
                    src="/logo-utama.png"
                    alt="FunFram"
                    className="h-6 md:h-7 w-auto object-contain select-none"
                />
                <span className="w-px h-4 bg-slate-300/80" />
                <div className="flex items-center gap-1.5 text-xs md:text-sm font-semibold text-slate-700 whitespace-nowrap">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span>{effectiveOnlineCount} Online</span>
                </div>
            </div>
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
