import { useRef, useEffect, useState } from 'react';
import { Participant } from '@/types/participant';
import { useCallStore } from '@/store/useCallStore';

interface VideoTileProps {
    participant: Participant;
}

export default function VideoTile({ participant }: VideoTileProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const localUserId = useCallStore((state) => state.localUser?.id);
    const isLocalVideo = participant.id === localUserId;
    const [isAutoplayBlocked, setIsAutoplayBlocked] = useState(false);

    useEffect(() => {
        if (videoRef.current) {
            const shouldBeMuted = isLocalVideo || participant.isMuted || isAutoplayBlocked;
            if (videoRef.current.muted !== shouldBeMuted) {
                videoRef.current.muted = shouldBeMuted;
            }
            if (!shouldBeMuted && videoRef.current.paused && participant.stream) {
                videoRef.current.play().catch(() => {});
            }
        }
    }, [participant.isMuted, isLocalVideo, isAutoplayBlocked, participant.stream]);

    useEffect(() => {
        const videoEl = videoRef.current;
        if (!videoEl) return;

        if (!participant.stream) {
            videoEl.srcObject = null;
            return;
        }

        // Avoid resetting srcObject or re-playing if the exact same stream is already playing smoothly
        if (videoEl.srcObject === participant.stream && !videoEl.paused) {
            return;
        }

        // Force re-attach for iOS Safari audio bug when remote tracks are updated
        if (videoEl.srcObject !== participant.stream) {
            if (!isLocalVideo) {
                videoEl.srcObject = null;
            }
            videoEl.srcObject = participant.stream;
        }

        const attemptPlay = () => {
            const playPromise = videoEl.play();
            if (playPromise !== undefined) {
                playPromise.then(() => {
                    console.log(`[VideoTile] Autoplay succeeded for ${participant.id}. Tracks:`, participant.stream?.getTracks().length);
                    const state = useCallStore.getState();
                    const latestParticipant =
                        state.leftParticipants.find(p => p.id === participant.id) ||
                        state.rightParticipants.find(p => p.id === participant.id);
                    const isCurrentlyMuted = latestParticipant ? latestParticipant.isMuted : participant.isMuted;
                    if (!isLocalVideo && !isCurrentlyMuted && !isAutoplayBlocked) {
                        videoEl.muted = false;
                    }
                }).catch((error) => {
                    console.warn('[VideoTile] Autoplay failed:', error.name, error.message);
                    if (!isLocalVideo && error.name === 'NotAllowedError') {
                        console.log('[VideoTile] Falling back to muted autoplay to ensure video frames render.');
                        setIsAutoplayBlocked(true);
                        videoEl.muted = true;
                        videoEl.play().catch(e => console.error('[VideoTile] Muted fallback also failed:', e));
                    }
                });
            }
        };

        attemptPlay();
    }, [participant.stream, isLocalVideo, participant.id]);

    const handleUnmute = () => {
        if (videoRef.current) {
            videoRef.current.muted = false;
            setIsAutoplayBlocked(false);
        }
    };

    // Auto-unmute on any user interaction with the document (good UX for bypassed autoplay)
    useEffect(() => {
        if (!isAutoplayBlocked) return;

        const unlockAudio = () => {
            handleUnmute();
            // Remove listeners once unlocked
            document.removeEventListener('click', unlockAudio);
            document.removeEventListener('touchstart', unlockAudio);
            document.removeEventListener('keydown', unlockAudio);
        };

        document.addEventListener('click', unlockAudio);
        document.addEventListener('touchstart', unlockAudio);
        document.addEventListener('keydown', unlockAudio);

        return () => {
            document.removeEventListener('click', unlockAudio);
            document.removeEventListener('touchstart', unlockAudio);
            document.removeEventListener('keydown', unlockAudio);
        };
    }, [isAutoplayBlocked]);

    const getInitials = (name: string) => {
        return name
            .split(' ')
            .map((n) => n[0])
            .join('')
            .toUpperCase()
            .slice(0, 2);
    };

    // Determine loading/connection state
    const isConnecting = participant.connectionState === 'new' || participant.connectionState === 'checking';
    const isReconnecting = participant.connectionState === 'reconnecting';
    const isIceRestarting = participant.connectionState === 'ice-restarting';
    const isFailed = participant.connectionState === 'disconnected' || participant.connectionState === 'failed';
    const showLoading = !isLocalVideo && (
        isReconnecting ||
        isIceRestarting ||
        isFailed ||
        (!participant.isCameraOff && !participant.stream) ||
        (isConnecting && !participant.stream)
    );

    let loadingText = 'Menghubungkan...';
    if (isReconnecting) loadingText = 'Jaringan berubah, menyambungkan ulang...';
    if (isIceRestarting) loadingText = 'Mencoba menyambungkan kembali...';
    if (isFailed) loadingText = 'Jaringan kurang bagus, menyambungkan kembali...';

    // Network quality indicator
    const showNetworkQuality = participant.networkQuality && participant.networkQuality !== 'good';
    const networkQuality = participant.networkQuality || 'good';

    return (
        <div
            className={`relative w-full h-full rounded-lg overflow-hidden ${
                isLocalVideo
                    ? 'p-[3px] bg-gradient-to-br from-[#00C6FF] via-blue-500 to-purple-500'
                    : 'bg-slate-50'
            }`}
        >
            {participant.stream ? (
                <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted={isLocalVideo || participant.isMuted || isAutoplayBlocked}
                    className={`w-full h-full object-cover object-center ${
                        isLocalVideo ? '-scale-x-100 rounded-[2px]' : ''
                    }`}
                />
            ) : (
                <div className={`w-full h-full flex flex-col items-center justify-center gap-3 bg-gradient-to-br from-slate-100 via-sky-50 to-indigo-100 ${isLocalVideo ? 'rounded-[2px]' : ''}`}>
                    <div className="relative flex items-center justify-center">
                        {showLoading && (
                            <span className="absolute -inset-2 rounded-full border-2 border-sky-400/50 animate-ping" />
                        )}
                        <div className="w-16 h-16 rounded-full bg-white/90 border border-slate-200 shadow-sm flex items-center justify-center">
                            <span className="text-xl font-bold text-slate-800">{getInitials(participant.name)}</span>
                        </div>
                    </div>
                    {showLoading && (
                        <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/85 border border-slate-200/80 shadow-xs text-xs font-medium text-slate-600">
                            <span className="w-2 h-2 rounded-full bg-sky-500 animate-pulse" />
                            <span>{loadingText}</span>
                        </div>
                    )}
                </div>
            )}

            {showLoading && participant.stream && (
                <div className="absolute bottom-4 left-4 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-900/75 backdrop-blur-md text-slate-50 text-xs font-medium z-10">
                    <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                    <span>{loadingText}</span>
                </div>
            )}

            {showNetworkQuality && (
                <div
                    className="absolute top-4 right-4 flex items-end gap-[3px] px-2.5 py-2 bg-slate-900/65 rounded-full z-[5] backdrop-blur-md border border-white/5 h-8"
                    title={`Kualitas jaringan: ${networkQuality === 'medium' ? 'Sedang' : 'Buruk'}`}
                >
                    <div className={`w-1 h-[6px] rounded-[2px] transition-colors ${networkQuality === 'medium' ? 'bg-amber-500' : 'bg-red-500'}`}></div>
                    <div className={`w-1 h-[10px] rounded-[2px] transition-colors ${networkQuality === 'medium' ? 'bg-amber-500' : 'bg-white/20'}`}></div>
                    <div className={`w-1 h-[14px] rounded-[2px] transition-colors ${networkQuality === 'medium' ? 'bg-amber-500' : 'bg-white/20'}`}></div>
                </div>
            )}

            <div className="absolute top-4 left-4 flex items-center gap-2 bg-slate-900/65 px-3.5 py-1.5 rounded-full z-[5] backdrop-blur-md border border-white/5">
                <div className="w-2 h-2 bg-emerald-500 rounded-full"></div>
                <span className="text-slate-50 text-sm font-medium leading-none">{participant.name}</span>
            </div>
            <div className="absolute bottom-4 right-4 flex items-center gap-2 z-[5]">
                    {participant.isMuted && (
                        <div className="flex items-center justify-center w-9 h-9 bg-white/85 border border-black/10 rounded-full text-slate-800 backdrop-blur-md" title="Microphone off">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                                <line x1="12" y1="19" x2="12" y2="23" />
                                <line x1="8" y1="23" x2="16" y2="23" />
                            </svg>
                        </div>
                    )}
                    {participant.isCameraOff && (
                        <div className="flex items-center justify-center w-9 h-9 bg-white/85 border border-black/10 rounded-full text-slate-800 backdrop-blur-md" title="Camera off">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M15 10l4.553-2.276A1 1 0 0 1 21 8.618V15.382a1 1 0 0 1-1.447.894L15 14" />
                                <rect x="3" y="7" width="12" height="10" rx="2" />
                                <line x1="3" y1="3" x2="21" y2="21" />
                            </svg>
                        </div>
                    )}
                </div>
        </div>
    );
}
