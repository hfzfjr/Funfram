'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Navbar from '@/components/layout/navbar';
import Navigation from '@/components/layout/Navigation';
import AuthOverlay from '@/components/auth/auth';
import MeetingScene from '@/components/frame/MeetingScene';
import GameScene from '@/components/frame/GameScene';
import GameInviteNotification from '@/components/ui/overlay/GameInviteNotification';
import { useCallStore } from '@/store/useCallStore';
import { WebSocketService } from '@/services/websocket.service';
import { ApiService } from '@/services/api.service';
import { Participant } from '@/types/participant';
import { CanvasEvent } from '@/types/game';
import styles from './page.module.css';

function FunVideoContent() {
    const searchParams = useSearchParams();
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [isMicOn, setIsMicOn] = useState(true);
    const [isCamOn, setIsCamOn] = useState(true);

    const videoTrackRef = useRef<MediaStreamTrack | null>(null);
    const audioTrackRef = useRef<MediaStreamTrack | null>(null);
    const localStreamRef = useRef<MediaStream | null>(null);
    const cameraRequestRef = useRef<Promise<MediaStream | null> | null>(null);

    const fsmState = useCallStore((state) => state.fsmState);
    const localUser = useCallStore((state) => state.localUser);
    const setLocalStreamInStore = useCallStore((state) => state.setLocalStream);
    const reset = useCallStore((state) => state.reset);

    const stopLocalMedia = () => {
        if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach((track) => track.stop());
        }
        localStreamRef.current = null;
        videoTrackRef.current = null;
        audioTrackRef.current = null;
        setLocalStreamInStore(null);
    };

    const requestUserMedia = async () => {
        const attempts: MediaStreamConstraints[] = [
            {
                video: {
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                    facingMode: { ideal: 'user' },
                },
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                },
            },
            { video: true, audio: true },
            { video: true, audio: false },
        ];

        let lastError: unknown = null;
        for (const constraints of attempts) {
            try {
                return await navigator.mediaDevices.getUserMedia(constraints);
            } catch (error) {
                lastError = error;
            }
        }

        throw lastError;
    };

    // Start camera after auth/user action. Guarding prevents overlapping getUserMedia calls.
    const startCamera = async (): Promise<MediaStream | null> => {
        if (localStreamRef.current?.active) return localStreamRef.current;
        if (cameraRequestRef.current) return cameraRequestRef.current;

        cameraRequestRef.current = (async () => {
            try {
                stopLocalMedia();

                console.log('🎥 Requesting camera/mic...');
                const stream = await requestUserMedia();
                console.log('✅ Camera/mic stream obtained:', stream);
                localStreamRef.current = stream;
                setLocalStreamInStore(stream);
                videoTrackRef.current = stream.getVideoTracks()[0] ?? null;
                audioTrackRef.current = stream.getAudioTracks()[0] ?? null;
                setIsCamOn(Boolean(videoTrackRef.current));
                setIsMicOn(Boolean(audioTrackRef.current));
                console.log('📹 Video track:', videoTrackRef.current);
                console.log('🎤 Audio track:', audioTrackRef.current);

                // Update local user stream in store after camera is ready
                const store = useCallStore.getState();
                console.log('👤 Local user before update:', store.localUser);
                if (store.localUser) {
                    store.setLocalUser({
                        ...store.localUser,
                        stream: stream,
                    });
                    console.log('✅ Local user stream updated');
                }

                return stream;
            } catch (error) {
                console.error('❌ Camera not available:', error);
                setIsCamOn(false);
                setIsMicOn(false);
                setLocalStreamInStore(null);
                return null;
            } finally {
                cameraRequestRef.current = null;
            }
        })();

        return cameraRequestRef.current;
    };

    // Register server-event handlers once. The socket is opened only after username confirmation.
    useEffect(() => {
        const ws = WebSocketService.getInstance();
        sessionStorage.removeItem('funfram_session');
        useCallStore.getState().reset();

        // Sync stream to local user participant when stream changes
        const syncStreamToParticipant = () => {
            const store = useCallStore.getState();
            if (localStreamRef.current && store.localUser) {
                store.setLocalUser({
                    ...store.localUser,
                    stream: localStreamRef.current,
                });
                // Also update in leftParticipants array
                if (store.leftParticipants.length > 0) {
                    useCallStore.setState({
                        leftParticipants: store.leftParticipants.map(p =>
                            p.id === store.localUser?.id ? { ...p, stream: localStreamRef.current } : p
                        )
                    });
                }
            }
        };

        // Watch for stream changes
        const streamInterval = setInterval(() => {
            if (localStreamRef.current) {
                syncStreamToParticipant();
                clearInterval(streamInterval);
            }
        }, 100);

        // ── FRAME_CREATED: server confirms lobby was created ──────────────────
        const onFrameCreated = (payload: any) => {
            const store = useCallStore.getState();
            const local: Participant = {
                id: payload.ownerId,
                stream: localStreamRef.current,
                name: store.localUser?.name ?? 'You',
                isMuted: false,
                isCameraOff: false,
                isOwner: true,
                presence: 'ONLINE',
                joinOrder: 1,
            };
            store.setLocalUser(local);
            store.setFsmState('FRAME');
            // Persist frameId in store
            useCallStore.setState({ frameId: payload.frameId, inviteToken: null });
            // Bootstrap the left participant list with ourselves
            if (store.leftParticipants.length === 0) {
                useCallStore.setState({ leftParticipants: [local] });
            }
            // Save session for reconnect
            sessionStorage.setItem('funfram_session', JSON.stringify({
                userId: payload.ownerId,
                username: local.name,
                frameId: payload.frameId,
                isOwner: true,
            }));

            // If stream is ready now, update participant
            if (localStreamRef.current) {
                store.setLocalUser({
                    ...local,
                    stream: localStreamRef.current,
                });
                if (store.leftParticipants.length > 0) {
                    useCallStore.setState({
                        leftParticipants: store.leftParticipants.map(p =>
                            p.id === local.id ? { ...p, stream: localStreamRef.current } : p
                        )
                    });
                }
            }
        };

        // ── FRAME_JOINED: server confirms someone joined ──────────────────────
        const onFrameJoined = (payload: any) => {
            const store = useCallStore.getState();
            const local: Participant = {
                id: payload.joinedUserId,
                stream: localStreamRef.current,
                name: store.localUser?.name ?? 'You',
                isMuted: false,
                isCameraOff: false,
                isOwner: false,
                presence: 'ONLINE',
                joinOrder: 2,
            };
            store.setLocalUser(local);
            store.setFsmState('FRAME');
            useCallStore.setState({ frameId: payload.frameId, inviteToken: null });
            if (store.leftParticipants.length === 0) {
                useCallStore.setState({ leftParticipants: [local] });
            }
            sessionStorage.setItem('funfram_session', JSON.stringify({
                userId: payload.joinedUserId,
                username: local.name,
                frameId: payload.frameId,
                isOwner: false,
            }));

            // If stream is ready now, update participant
            if (localStreamRef.current) {
                store.setLocalUser({
                    ...local,
                    stream: localStreamRef.current,
                });
                if (store.leftParticipants.length > 0) {
                    useCallStore.setState({
                        leftParticipants: store.leftParticipants.map(p =>
                            p.id === local.id ? { ...p, stream: localStreamRef.current } : p
                        )
                    });
                }
            }
        };

        // ── PLAYER_JOIN: a peer joined our lobby ─────────────────────────────
        const onPlayerJoin = (payload: any) => {
            const p = payload.participant;
            if (!p) return;
            const participant: Participant = {
                id: p.id,
                stream: null,
                name: p.name ?? p.username ?? 'Friend',
                isMuted: p.isMuted ?? false,
                isCameraOff: p.isCameraOff ?? false,
                isOwner: p.isOwner ?? false,
                presence: 'ONLINE',
                joinOrder: p.joinOrder ?? 2,
            };
            useCallStore.getState().addParticipant('left', participant);
        };

        // ── MATCH_FOUND: matched with another frame ───────────────────────────
        const onMatchFound = (payload: any) => {
            const store = useCallStore.getState();
            store.setSession(payload);
            useCallStore.setState({ generalChat: [] });
        };

        // ── MATCH_LEFT: opponent frame left ──────────────────────────────────
        const onMatchLeft = () => {
            useCallStore.getState().setSession(null);
            useCallStore.setState({ generalChat: [] });
        };

        // ── GAME_INVITE_RECEIVED ──────────────────────────────────────────────
        const onGameInviteReceived = (payload: any) => {
            useCallStore.getState().receiveGameInvite(payload);
        };

        // ── GAME_START ────────────────────────────────────────────────────────
        const onGameStart = () => {
            const store = useCallStore.getState();
            store.setFsmState('PLAYING');
            store.updateGameState({ status: 'Waiting' });
        };

        const onDrawStart = (payload: any) => {
            const store = useCallStore.getState();
            store.updateGameState({
                currentDrawerId: payload.drawerId,
                currentWord: payload.secretWord || '',
                wordHint: payload.wordHint || '',
                status: 'Countdown',
                drawTimer: 10,
                timeRemaining: payload.timeLimit || 60,
                canvasEvents: [],
                guessEvents: [],
            });
        };

        const onGameStateUpdate = (payload: any) => {
            const safePayload = { ...payload };
            delete safePayload.canvasEvents;
            delete safePayload.guessEvents;
            useCallStore.getState().updateGameState(safePayload);
        };

        const onRoundEnd = (payload: any) => {
            useCallStore.getState().updateGameState({
                status: 'Reveal',
                currentWord: payload.answer || '',
                winner: payload.winnerId || null,
            });
        };

        const onScoreUpdate = (payload: any) => {
            useCallStore.getState().updateGameState({ score: payload.scores || {} });
        };

        const onChatMessage = (payload: any) => {
            useCallStore.getState().addGeneralMessage({
                id: payload.id || `msg-${Date.now()}`,
                senderId: payload.senderId,
                senderName: payload.senderName || 'User',
                text: payload.text || '',
                side: payload.side || 'left',
                timestamp: payload.timestamp || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            });
        };

        const onGameEnd = () => {
            const store = useCallStore.getState();
            store.updateGameState({ status: 'Finished' });
            store.setFsmState('MATCHED');
        };

        const onCanvasEvent = (payload: CanvasEvent) => {
            useCallStore.getState().receiveCanvasEvent(payload);
        };

        ws.on('FRAME_CREATED', onFrameCreated);
        ws.on('FRAME_JOINED', onFrameJoined);
        ws.on('PLAYER_JOIN', onPlayerJoin);
        ws.on('MATCH_FOUND', onMatchFound);
        ws.on('MATCH_LEFT', onMatchLeft);
        ws.on('GAME_INVITE_RECEIVED', onGameInviteReceived);
        ws.on('GAME_START', onGameStart);
        ws.on('DRAW_START', onDrawStart);
        ws.on('GAME_STATE_UPDATE', onGameStateUpdate);
        ws.on('ROUND_END', onRoundEnd);
        ws.on('SCORE_UPDATE', onScoreUpdate);
        ws.on('CHAT_MESSAGE', onChatMessage);
        ws.on('GAME_END', onGameEnd);
        ws.on('CANVAS_START', onCanvasEvent);
        ws.on('CANVAS_MOVE', onCanvasEvent);
        ws.on('CANVAS_END', onCanvasEvent);

        return () => {
            ws.off('FRAME_CREATED', onFrameCreated);
            ws.off('FRAME_JOINED', onFrameJoined);
            ws.off('PLAYER_JOIN', onPlayerJoin);
            ws.off('MATCH_FOUND', onMatchFound);
            ws.off('MATCH_LEFT', onMatchLeft);
            ws.off('GAME_INVITE_RECEIVED', onGameInviteReceived);
            ws.off('GAME_START', onGameStart);
            ws.off('DRAW_START', onDrawStart);
            ws.off('GAME_STATE_UPDATE', onGameStateUpdate);
            ws.off('ROUND_END', onRoundEnd);
            ws.off('SCORE_UPDATE', onScoreUpdate);
            ws.off('CHAT_MESSAGE', onChatMessage);
            ws.off('GAME_END', onGameEnd);
            ws.off('CANVAS_START', onCanvasEvent);
            ws.off('CANVAS_MOVE', onCanvasEvent);
            ws.off('CANVAS_END', onCanvasEvent);
            stopLocalMedia();
            ws.disconnect();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Effect to sync stream to participant whenever stream changes
    useEffect(() => {
        console.log('🔄 Stream sync effect triggered, isCamOn:', isCamOn, 'isMicOn:', isMicOn);
        if (localStreamRef.current) {
            const store = useCallStore.getState();
            console.log('👤 Syncing stream to local user:', store.localUser?.id);
            if (store.localUser) {
                store.setLocalUser({
                    ...store.localUser,
                    stream: localStreamRef.current,
                });
                console.log('✅ Local user stream synced');
                // Update in leftParticipants array
                if (store.leftParticipants.length > 0) {
                    useCallStore.setState({
                        leftParticipants: store.leftParticipants.map(p =>
                            p.id === store.localUser?.id ? { ...p, stream: localStreamRef.current } : p
                        )
                    });
                    console.log('✅ LeftParticipants array updated');
                }
            }
        } else {
            console.log('⚠️ No stream to sync');
        }
    }, [isCamOn, isMicOn]); // Re-run when camera/mic state changes

    // ── Auth confirm handler ─────────────────────────────────────────────────
    const handleAuthConfirm = async (confirmedUsername: string) => {
        setIsAuthenticated(true);

        // Store username early so FRAME_CREATED handler can read it
        useCallStore.setState({
            localUser: {
                id: 'pending',
                stream: null,
                name: confirmedUsername,
                isMuted: false,
                isCameraOff: false,
                isOwner: false,
                presence: 'ONLINE',
                joinOrder: 1,
            },
        });

        const ws = WebSocketService.getInstance();
        const wsUrl = process.env.NEXT_PUBLIC_WS_GAME_URL || 'ws://localhost:5001/socket';
        ws.connect(wsUrl);

        // Start camera right after auth (user gesture satisfies browser policy)
        await startCamera();

        const invite = searchParams.get('invite');
        const frameId = searchParams.get('frameId');
        const sessionId = searchParams.get('sessionId');
        const expire = searchParams.get('expire');
        const nonce = searchParams.get('nonce');

        if (invite && frameId && sessionId && expire && nonce) {
            const api = ApiService.getInstance();
            const verification = await api.verifyInviteLink(frameId, sessionId, expire, nonce, invite);
            if (verification.isValid) {
                ws.sendWhenOpen('FRAME_JOIN', { frameId, inviteToken: invite, username: confirmedUsername });
                ws.sendWhenOpen('PLAYER_JOIN', { frameId, username: confirmedUsername });
            } else {
                alert('Invitation link is invalid or has expired. Creating a new frame lobby instead.');
                ws.sendWhenOpen('FRAME_CREATE', { username: confirmedUsername });
            }
        } else {
            // Normal create-frame flow; backend responds with FRAME_CREATED
            ws.sendWhenOpen('FRAME_CREATE', { username: confirmedUsername });
        }
    };

    const handleLeave = () => {
        useCallStore.getState().leaveFrame();
        stopLocalMedia();
        reset();
        setIsAuthenticated(false);
        sessionStorage.removeItem('funfram_session');
    };

    const handleMic = () => {
        if (audioTrackRef.current) {
            audioTrackRef.current.enabled = !isMicOn;
            setIsMicOn((v) => !v);
            useCallStore.getState().muteParticipant(localUser?.id ?? '', isMicOn);
        }
    };

    const handleCam = async () => {
        if (!videoTrackRef.current) {
            await startCamera();
            return;
        }

        if (videoTrackRef.current) {
            videoTrackRef.current.enabled = !isCamOn;
            setIsCamOn((v) => !v);
            useCallStore.getState().toggleCamera(localUser?.id ?? '', isCamOn);
        }
    };

    return (
        <>
            {!isAuthenticated && <AuthOverlay onConfirm={handleAuthConfirm} />}

            <div className={styles.container}>
                <Navbar />

                <div className={styles.content}>
                    {fsmState === 'PLAYING' || fsmState === 'RESULT' ? (
                        <GameScene />
                    ) : (
                        <MeetingScene />
                    )}
                </div>

                {isAuthenticated && (
                    <Navigation
                        onLeave={handleLeave}
                        onMic={handleMic}
                        onCam={handleCam}
                        isMicOn={isMicOn}
                        isCamOn={isCamOn}
                    />
                )}
            </div>

            <GameInviteNotification />
        </>
    );
}

export default function FunVideoPage() {
    return (
        <Suspense fallback={<div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#1F2028', color: 'white', fontFamily: 'Inter, sans-serif' }}>Loading FunFram...</div>}>
            <FunVideoContent />
        </Suspense>
    );
}
