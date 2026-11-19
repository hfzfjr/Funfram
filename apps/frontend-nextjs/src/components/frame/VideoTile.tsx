import { useRef, useEffect, useState } from 'react';
import { Participant } from '@/types/participant';
import { useCallStore } from '@/store/useCallStore';
import { WebSocketService } from '@/services/websocket.service';
import { useMediaDeviceStore } from '@/hooks/useLocalMedia';

interface VideoTileProps {
    participant: Participant;
}

export default function VideoTile({ participant }: VideoTileProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const localUserId = useCallStore((state) => state.localUser?.id);
    const rightParticipants = useCallStore((state) => state.rightParticipants);
    const sessionId = useCallStore((state) => state.sessionId);
    const showCustomAlert = useCallStore((state) => state.showCustomAlert);

    const facingMode = useMediaDeviceStore((state) => state.facingMode);
    const videoDevices = useMediaDeviceStore((state) => state.videoDevices);
    const audioDevices = useMediaDeviceStore((state) => state.audioDevices);
    const selectedVideoId = useMediaDeviceStore((state) => state.selectedVideoId);
    const selectedAudioId = useMediaDeviceStore((state) => state.selectedAudioId);
    const flipCamera = useMediaDeviceStore((state) => state.flipCamera);
    const selectDevices = useMediaDeviceStore((state) => state.selectDevices);

    const isLocalVideo = participant.id === localUserId;
    const isOpponent = !isLocalVideo && rightParticipants.some((p) => p.id === participant.id);

    const [isAutoplayBlocked, setIsAutoplayBlocked] = useState(false);
    const [showDeviceMenu, setShowDeviceMenu] = useState(false);
    const [showReportMenu, setShowReportMenu] = useState(false);
    const [reportReason, setReportReason] = useState('nsfw');

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
            videoRef.current.muted = Boolean(participant.isMuted);
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

    const handleReportUser = () => {
        WebSocketService.getInstance().sendEvent('REPORT_USER', {
            targetUserId: participant.id,
            sessionId: sessionId || '',
            reason: reportReason,
        });
        setShowReportMenu(false);
        showCustomAlert(`${participant.name} telah dilaporkan & diblokir. Mencari lawan baru...`, 'info');
    };

    return (
        <div
            className={`relative w-full h-full rounded-lg overflow-hidden ${
                isLocalVideo
                    ? 'p-[3px] bg-gradient-to-br from-[#00C6FF] via-blue-500 to-purple-500'
                    : 'bg-slate-50'
            }`}
        >
            {participant.stream && !participant.isCameraOff ? (
                <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted={isLocalVideo || participant.isMuted || isAutoplayBlocked}
                    className={`w-full h-full object-cover object-center bg-slate-900 ${
                        isLocalVideo ? `${facingMode === 'user' ? '-scale-x-100 ' : ''}rounded-[2px]` : ''
                    }`}
                />
            ) : (
                <div className={`relative w-full h-full flex flex-col items-center justify-center gap-4 overflow-hidden bg-gradient-to-br from-slate-100 via-sky-50 to-indigo-100 ${isLocalVideo ? 'rounded-[2px]' : ''}`}>
                    {showLoading && (
                        <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/55 to-transparent animate-[shimmer_1.8s_infinite] pointer-events-none" />
                    )}
                    <div className="relative flex items-center justify-center">
                        {showLoading && (
                            <>
                                <span className="absolute -inset-4 rounded-full bg-sky-400/20 animate-ping" />
                                <span className="absolute -inset-2 rounded-full bg-gradient-to-tr from-[#00C6FF]/40 via-blue-500/40 to-purple-500/40 blur-sm animate-pulse" />
                            </>
                        )}
                        <div className="relative w-20 h-20 rounded-full p-[3px] bg-gradient-to-br from-[#00C6FF] via-blue-500 to-purple-500 shadow-md">
                            <div className="w-full h-full rounded-full bg-white flex items-center justify-center">
                                <span className="text-2xl font-extrabold bg-gradient-to-br from-slate-800 to-slate-600 bg-clip-text text-transparent">
                                    {getInitials(participant.name)}
                                </span>
                            </div>
                        </div>
                    </div>
                    {showLoading && (
                        <div className="relative flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/90 backdrop-blur-md border border-slate-200/90 shadow-sm text-xs font-semibold text-slate-700">
                            <span className="flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-sky-500 animate-bounce [animation-delay:-0.3s]" />
                                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-bounce [animation-delay:-0.15s]" />
                                <span className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-bounce" />
                            </span>
                            <span>{loadingText === 'Menghubungkan...' ? 'Menghubungkan kamera...' : loadingText}</span>
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

            {isOpponent && (
                <button
                    type="button"
                    onClick={() => setShowReportMenu((v) => !v)}
                    title="Laporkan & Blokir"
                    className={`absolute top-4 ${showNetworkQuality ? 'right-16' : 'right-4'} flex items-center gap-1 px-2.5 py-1.5 rounded-full bg-slate-900/65 hover:bg-red-600/90 text-slate-50 text-xs font-medium z-[6] backdrop-blur-md border border-white/10 cursor-pointer transition-colors`}
                >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
                        <line x1="4" y1="22" x2="4" y2="15" />
                    </svg>
                    <span className="hidden sm:inline">Report</span>
                </button>
            )}

            {showReportMenu && isOpponent && (
                <div className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm z-20 flex items-center justify-center p-4">
                    <div className="w-full max-w-[260px] bg-white rounded-2xl p-4 shadow-xl text-slate-900 flex flex-col gap-3">
                        <div className="text-sm font-bold text-slate-900">Laporkan &amp; Blokir {participant.name}?</div>
                        <select
                            value={reportReason}
                            onChange={(e) => setReportReason(e.target.value)}
                            className="w-full px-2.5 py-2 rounded-lg border border-slate-300 bg-white text-xs text-slate-800 outline-none"
                        >
                            <option value="Konten tidak pantas">Konten tidak pantas</option>
                            <option value="Spam / Mengganggu">Spam / Mengganggu</option>
                            <option value="Perilaku kasar">Perilaku kasar</option>
                        </select>
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={() => setShowReportMenu(false)}
                                className="flex-1 py-2 rounded-lg border border-slate-200 bg-slate-100 text-slate-700 text-xs font-semibold cursor-pointer"
                            >
                                Batal
                            </button>
                            <button
                                type="button"
                                onClick={handleReportUser}
                                className="flex-1 py-2 rounded-lg border-none bg-red-600 hover:bg-red-700 text-white text-xs font-semibold cursor-pointer"
                            >
                                Blokir &amp; Skip
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {isLocalVideo && (
                <div className="absolute bottom-4 left-4 flex items-center gap-1.5 z-[6]">
                    <button
                        type="button"
                        onClick={() => void flipCamera()}
                        title="Putar Kamera (Depan/Belakang)"
                        className="flex items-center justify-center w-9 h-9 bg-slate-900/65 hover:bg-slate-900/85 border border-white/10 rounded-full text-slate-50 backdrop-blur-md cursor-pointer transition-colors"
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M11 19H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5" />
                            <path d="M13 5h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-5" />
                            <circle cx="12" cy="12" r="3" />
                            <path d="m18 22-3-3 3-3" />
                            <path d="m6 2 3 3-3 3" />
                        </svg>
                    </button>
                    <button
                        type="button"
                        onClick={() => setShowDeviceMenu((v) => !v)}
                        title="Pilih Kamera & Mikrofon"
                        className="flex items-center justify-center w-9 h-9 bg-slate-900/65 hover:bg-slate-900/85 border border-white/10 rounded-full text-slate-50 backdrop-blur-md cursor-pointer transition-colors"
                    >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="3" />
                            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                        </svg>
                    </button>

                    {showDeviceMenu && (
                        <div className="absolute bottom-11 left-0 w-60 bg-white/95 backdrop-blur-md border border-slate-200 rounded-xl shadow-xl p-3 flex flex-col gap-2 text-slate-900 z-20">
                            <div className="flex items-center justify-between">
                                <span className="text-xs font-bold text-slate-800">Pilih Perangkat</span>
                                <button
                                    type="button"
                                    onClick={() => setShowDeviceMenu(false)}
                                    className="text-xs text-slate-500 hover:text-slate-800 bg-transparent border-none cursor-pointer"
                                >
                                    ✕
                                </button>
                            </div>
                            <label className="flex flex-col gap-1 text-[11px] font-semibold text-slate-600">
                                Kamera
                                <select
                                    value={selectedVideoId}
                                    onChange={(e) => void selectDevices(e.target.value, undefined)}
                                    className="w-full px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-xs text-slate-800 outline-none"
                                >
                                    {videoDevices.map((d, idx) => (
                                        <option key={d.deviceId || idx} value={d.deviceId}>
                                            {d.label || `Kamera ${idx + 1}`}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label className="flex flex-col gap-1 text-[11px] font-semibold text-slate-600">
                                Mikrofon
                                <select
                                    value={selectedAudioId}
                                    onChange={(e) => void selectDevices(undefined, e.target.value)}
                                    className="w-full px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-xs text-slate-800 outline-none"
                                >
                                    {audioDevices.map((d, idx) => (
                                        <option key={d.deviceId || idx} value={d.deviceId}>
                                            {d.label || `Mikrofon ${idx + 1}`}
                                        </option>
                                    ))}
                                </select>
                            </label>
                        </div>
                    )}
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
