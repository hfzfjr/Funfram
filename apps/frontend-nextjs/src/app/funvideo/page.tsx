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
import { WebRtcService } from '@/services/webrtc.service';
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
    const autoStartHandledRef = useRef(false);

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
            store.setFrameOwnerId(payload.ownerId);
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

            // Connect WebRTC for the Lobby using frameId
            connectWebRTC(payload.frameId);
        };

        // ── FRAME_JOINED: server confirms someone joined ──────────────────────
        const onFrameJoined = (payload: any) => {
            const store = useCallStore.getState();
            
            const members = payload.members.map((m: any) => ({
                id: m.id || m.userId,
                stream: (m.id || m.userId) === payload.joinedUserId ? localStreamRef.current : null,
                name: m.name ?? m.username ?? 'User',
                isMuted: m.isMuted ?? false,
                isCameraOff: m.isCameraOff ?? false,
                isOwner: m.isOwner ?? false,
                presence: m.presence ?? 'ONLINE',
                joinOrder: m.joinOrder ?? 1,
            }));

            const local = members.find((m: any) => m.id === payload.joinedUserId) || {
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
            store.setFrameOwnerId(payload.ownerId);
            useCallStore.setState({ frameId: payload.frameId, inviteToken: null, leftParticipants: members });
            
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
                useCallStore.setState((state) => ({
                    leftParticipants: state.leftParticipants.map(p =>
                        p.id === local.id ? { ...p, stream: localStreamRef.current } : p
                    )
                }));
            }

            // Connect WebRTC for the Lobby using frameId
            connectWebRTC(payload.frameId);
        };

        // ── PLAYER_JOIN: a peer joined our lobby ─────────────────────────────
        const onPlayerJoin = (payload: any) => {
            const p = payload.participant;
            if (!p) return;
            const participantName = p.name ?? p.username ?? 'Seseorang';
            const participant: Participant = {
                id: p.id,
                stream: null,
                name: participantName,
                isMuted: p.isMuted ?? false,
                isCameraOff: p.isCameraOff ?? false,
                isOwner: p.isOwner ?? false,
                presence: 'ONLINE',
                joinOrder: p.joinOrder ?? 2,
            };
            useCallStore.getState().addParticipant('left', participant);
            
            // Add system notification to chat
            useCallStore.setState((state) => ({
                generalChat: [...state.generalChat, {
                    id: Date.now().toString(),
                    senderId: 'system',
                    senderName: 'System',
                    text: `${participantName} bergabung dalam frame`,
                    side: 'left',
                    timestamp: new Date().toISOString()
                }]
            }));
        };

        const connectWebRTC = (roomId: string) => {
            const webrtc = WebRtcService.getInstance();
            const webrtcUrl = process.env.NEXT_PUBLIC_WS_WEBRTC_URL || 'ws://localhost:5002';
            const store = useCallStore.getState();
            
            // Disconnect from previous room if any
            webrtc.disconnectAll();
            
            webrtc.setLocalStream(localStreamRef.current);
            webrtc.onRemoteStream((participantId, stream) => {
                const currentStore = useCallStore.getState();
                const leftIndex = currentStore.leftParticipants.findIndex(p => p.id === participantId);
                if (leftIndex !== -1) {
                    useCallStore.setState({
                        leftParticipants: currentStore.leftParticipants.map(p =>
                            p.id === participantId ? { ...p, stream } : p
                        )
                    });
                    return;
                }

                const rightIndex = currentStore.rightParticipants.findIndex(p => p.id === participantId);
                if (rightIndex !== -1) {
                    useCallStore.setState({
                        rightParticipants: currentStore.rightParticipants.map(p =>
                            p.id === participantId ? { ...p, stream } : p
                        )
                    });
                    return;
                }

                console.warn('[WebRTC] Participant not found in any list, adding to right:', participantId);
                currentStore.addParticipant('right', {
                    id: participantId,
                    stream: stream,
                    name: 'Remote User',
                    isMuted: false,
                    isCameraOff: false,
                    isOwner: false,
                    presence: 'ONLINE',
                    joinOrder: 99,
                });
            });

            webrtc.connectToSignalingServer(webrtcUrl).then(() => {
                webrtc.joinRoom(roomId, store.localUser?.id || '');
            }).catch(err => {
                console.error('WebRTC connection failed:', err);
            });
        };

        // ── MATCH_FOUND: matched with another frame ───────────────────────────
        const onMatchFound = (payload: any) => {
            const store = useCallStore.getState();
            store.setSession(payload);
            useCallStore.setState({ generalChat: [] });
            connectWebRTC(payload.sessionId);

        };

        // ── MATCH_LEFT: opponent frame left ──────────────────────────────────
        const onMatchLeft = () => {
            useCallStore.getState().handleOpponentLeft({});
        };

        const onPlayerLeft = (payload: any) => {
            const store = useCallStore.getState();
            const userId = payload.userId;
            if (!userId) return;

            const isLeft = store.leftParticipants.some(p => p.id === userId);
            const isRight = store.rightParticipants.some(p => p.id === userId);

            if (isLeft) {
                store.removeParticipant('left', userId);
            } else if (isRight) {
                store.removeParticipant('right', userId);
            }

            WebRtcService.getInstance().disconnectPeer(userId);
        };

        const onDeviceStateChange = (payload: any) => {
            const store = useCallStore.getState();
            if (!payload?.userId) return;
            store.setDeviceState(
                payload.userId,
                payload.cameraEnabled ?? true,
                payload.microphoneEnabled ?? true,
            );
        };

        const onMuteUpdate = (payload: any) => {
            const store = useCallStore.getState();
            if (!payload?.userId) return;
            store.muteParticipant(payload.userId, Boolean(payload.isMuted));
        };

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
        ws.on('PLAYER_LEFT', onPlayerLeft);
        ws.on('DEVICE_STATE_CHANGE', onDeviceStateChange);
        ws.on('MUTE_UPDATE', onMuteUpdate);
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
            ws.off('PLAYER_LEFT', onPlayerLeft);
            ws.off('DEVICE_STATE_CHANGE', onDeviceStateChange);
            ws.off('MUTE_UPDATE', onMuteUpdate);
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
            WebRtcService.getInstance().disconnectAll();
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

    useEffect(() => {
        if (isAuthenticated || autoStartHandledRef.current) {
            return;
        }

        const savedUsername = localStorage.getItem('funfram_username');
        const shouldAutoStart = sessionStorage.getItem('funfram_autostart') === '1';
        if (savedUsername && shouldAutoStart) {
            autoStartHandledRef.current = true;
            sessionStorage.removeItem('funfram_autostart');
            void handleAuthConfirm(savedUsername);
        }
    }, [isAuthenticated]);

    // ── Auth confirm handler ─────────────────────────────────────────────────
    const handleAuthConfirm = async (confirmedUsername: string) => {
        setIsAuthenticated(true);
        localStorage.setItem('funfram_username', confirmedUsername);
        sessionStorage.removeItem('funfram_autostart');

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
        const wsUrl = process.env.NEXT_PUBLIC_WS_GAME_URL || 'ws://localhost:5001';
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
        const store = useCallStore.getState();
        WebRtcService.getInstance().disconnectAll();
        if (store.frameId) {
            WebSocketService.getInstance().sendEvent('FRAME_LEAVE', {
                frameId: store.frameId,
                sessionId: store.sessionId,
                userId: store.localUser?.id,
            });
        }

        const newLocalUser = store.localUser ? { ...store.localUser, isOwner: true } : null;

        // Return to lobby (FRAME state) instead of HOME
        useCallStore.setState({
            sessionId: null,
            rightParticipants: [],
            leftParticipants: newLocalUser ? [newLocalUser] : [],
            localUser: newLocalUser,
            fsmState: 'FRAME',
            matchmakingState: 'Waiting',
            gameState: null,
            gameInvite: null,
            generalChat: [],
            frameOwnerId: newLocalUser?.id,
        });

        // Clear query params so refresh doesn't rejoin the old frame
        window.history.replaceState({}, '', '/funvideo');

        // Request a new frame from the backend so we get a valid frameId
        if (newLocalUser) {
            WebSocketService.getInstance().sendEvent('FRAME_CREATE', { username: newLocalUser.name });
        }

        // Don't stop media - keep camera active in lobby
        sessionStorage.removeItem('funfram_autostart');
    };

    const handleMic = () => {
        if (audioTrackRef.current) {
            const nextMicEnabled = !isMicOn;
            audioTrackRef.current.enabled = nextMicEnabled;
            setIsMicOn(nextMicEnabled);

            const store = useCallStore.getState();
            if (store.localUser?.id) {
                store.muteParticipant(store.localUser.id, !nextMicEnabled);
                WebSocketService.getInstance().sendEvent('DEVICE_STATE_CHANGE', {
                    sessionId: store.sessionId,
                    userId: store.localUser.id,
                    cameraEnabled: !store.localUser.isCameraOff,
                    microphoneEnabled: nextMicEnabled,
                });
            }
        }
    };

    const handleCam = async () => {
        if (!videoTrackRef.current) {
            await startCamera();
            const store = useCallStore.getState();
            if (store.localUser?.id) {
                store.toggleCamera(store.localUser.id, false);
                WebSocketService.getInstance().sendEvent('DEVICE_STATE_CHANGE', {
                    sessionId: store.sessionId,
                    userId: store.localUser.id,
                    cameraEnabled: true,
                    microphoneEnabled: !store.localUser.isMuted,
                });
            }
            return;
        }

        if (videoTrackRef.current) {
            const nextCamEnabled = !isCamOn;
            videoTrackRef.current.enabled = nextCamEnabled;
            setIsCamOn(nextCamEnabled);

            const store = useCallStore.getState();
            if (store.localUser?.id) {
                store.toggleCamera(store.localUser.id, !nextCamEnabled);
                WebSocketService.getInstance().sendEvent('DEVICE_STATE_CHANGE', {
                    sessionId: store.sessionId,
                    userId: store.localUser.id,
                    cameraEnabled: nextCamEnabled,
                    microphoneEnabled: !store.localUser.isMuted,
                });
            }
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

