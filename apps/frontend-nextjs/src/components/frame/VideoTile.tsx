import { useRef, useEffect, useState } from 'react';
import { Participant } from '@/types/participant';
import { useCallStore } from '@/store/useCallStore';
import styles from './VideoTile.module.css';

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
        }
    }, [participant.isMuted, isLocalVideo, isAutoplayBlocked]);

    useEffect(() => {
        if (videoRef.current && participant.stream) {
            const videoEl = videoRef.current;
            // Force re-attach for iOS Safari audio bug when tracks are updated
            if (videoEl.srcObject !== participant.stream) {
                videoEl.srcObject = null;
                videoEl.srcObject = participant.stream;
            }
            
            const attemptPlay = () => {
                const playPromise = videoEl.play();
                if (playPromise !== undefined) {
                    playPromise.then(() => {
                        console.log(`[VideoTile] Autoplay succeeded for ${participant.id}. Tracks:`, participant.stream?.getTracks().length);
                        // If it played successfully but it's supposed to be unmuted, ensure it's not silently muted by the browser
                        if (!isLocalVideo && !participant.isMuted && !isAutoplayBlocked) {
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
        }
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
        <div className={`${styles.container} ${isLocalVideo ? styles.localContainer : ''}`}>
            {participant.stream ? (
                <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted={isLocalVideo || participant.isMuted || isAutoplayBlocked}
                    className={`${styles.video} ${isLocalVideo ? styles.mirrored : ''} ${showLoading ? styles.blurred : ''}`}
                />
            ) : (
                <div className={styles.placeholder}>
                    <span className={styles.initials}>{getInitials(participant.name)}</span>
                </div>
            )}

            {showLoading && (
                <div className={styles.loadingOverlay}>
                    <div className={styles.loadingSpinner}></div>
                    <div className={styles.loadingText}>{loadingText}</div>
                </div>
            )}

            {showNetworkQuality && (
                <div className={styles.networkQuality} title={`Kualitas jaringan: ${networkQuality === 'medium' ? 'Sedang' : 'Buruk'}`}>
                    <div className={`${styles.networkBar} ${networkQuality === 'medium' ? styles.medium : styles.poor}`}></div>
                    <div className={`${styles.networkBar} ${networkQuality === 'medium' ? styles.medium : ''}`}></div>
                    <div className={`${styles.networkBar} ${networkQuality === 'medium' ? styles.medium : ''}`}></div>
                </div>
            )}

            {/* Overlay Tap to Unmute dihapus demi UX. Audio akan otomatis aktif saat user menyentuh/klik layar */}

            <div className={styles.overlay}>
                <div className={styles.liveIndicator}></div>
                <span className={styles.name}>{participant.name}</span>
            </div>
            <div className={styles.statusIcons}>
                    {participant.isMuted && (
                        <div className={styles.statusIcon} title="Microphone off">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                                <line x1="12" y1="19" x2="12" y2="23" />
                                <line x1="8" y1="23" x2="16" y2="23" />
                            </svg>
                        </div>
                    )}
                    {participant.isCameraOff && (
                        <div className={styles.statusIcon} title="Camera off">
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
